-- DropStack Invoice Chaser — RLS verification
-- Run in the Supabase SQL editor AFTER schema.sql. Every row must say PASS.
--
-- It switches role to `anon` and `authenticated` with `set local role` and
-- attempts every operation on every chaser_ table. It checks `current_user`,
-- NOT auth.role(): auth.role() reads the JWT claim and is null in the SQL
-- editor, so a guard written against it would silently no-op here and you'd
-- learn nothing. current_user is the real Postgres role RLS is enforced on.
--
-- Seed rows and probe writes are cleaned up at the end — nothing is left behind.

drop table if exists chaser_rls_results;
create temp table chaser_rls_results (
  ord     serial,
  role_   text,
  tbl     text,
  op      text,
  expect  text,
  outcome text,
  result  text
);

do $$
declare
  r         text;
  t         text;
  op        text;
  expect_ok boolean;
  ok        boolean;
  detail    text;
  cust_id   uuid;
  inv_id    uuid;
  n         int;
begin
  -- Seed one row of each as the superuser so anon has something to try to read.
  insert into chaser_customers (name, phone, email)
    values ('RLS Test Customer', '+27000000000', 'test@example.com')
    returning id into cust_id;
  insert into chaser_invoices (customer_id, reference, amount_cents, issued_on, due_on)
    values (cust_id, 'RLS-TEST', 1999, current_date, current_date)
    returning id into inv_id;
  insert into chaser_nudges (invoice_id, channel, tone)
    values (inv_id, 'whatsapp', 'gentle');

  foreach r in array array['anon', 'authenticated'] loop
    expect_ok := (r = 'authenticated');

    execute format('set role %I', r);

    -- Sanity: the role switch actually happened. This is the current_user check.
    insert into chaser_rls_results (role_, tbl, op, expect, outcome, result)
    values (r, '-', 'current_user = ' || r, 'true',
            current_user::text,
            case when current_user::text = r then 'PASS' else 'FAIL' end);

    foreach t in array array['chaser_customers', 'chaser_invoices', 'chaser_nudges'] loop
      foreach op in array array['select', 'insert', 'update', 'delete'] loop
        ok := null; detail := null;
        begin
          if op = 'select' then
            execute format('select count(*) from %I', t) into n;
            -- anon should get 0 rows (RLS filter) or an error (revoked privilege). Either is a pass.
            ok := (n > 0);
            detail := n || ' rows';
          elsif op = 'insert' then
            if t = 'chaser_customers' then
              execute 'insert into chaser_customers (name) values (''rls-probe'')';
            elsif t = 'chaser_invoices' then
              execute format('insert into chaser_invoices (customer_id, amount_cents, issued_on, due_on) values (%L, 1, current_date, current_date)', cust_id);
            else
              execute format('insert into chaser_nudges (invoice_id, channel, tone) values (%L, ''email'', ''firm'')', inv_id);
            end if;
            ok := true; detail := 'inserted';
          elsif op = 'update' then
            if t = 'chaser_customers' then
              execute format('update chaser_customers set name = name where id = %L', cust_id);
            elsif t = 'chaser_invoices' then
              execute format('update chaser_invoices set notes = ''probe'' where id = %L', inv_id);
            else
              execute format('update chaser_nudges set tone = tone where invoice_id = %L', inv_id);
            end if;
            get diagnostics n = row_count;
            ok := (n > 0); detail := n || ' rows affected';
          else -- delete
            if t = 'chaser_nudges' then
              execute format('delete from chaser_nudges where invoice_id = %L', inv_id);
            elsif t = 'chaser_invoices' then
              execute format('delete from chaser_invoices where id = %L', inv_id);
            else
              execute format('delete from chaser_customers where id = %L', cust_id);
            end if;
            get diagnostics n = row_count;
            ok := (n > 0); detail := n || ' rows affected';
          end if;
        exception when others then
          ok := false;
          detail := 'error: ' || sqlerrm;
        end;

        insert into chaser_rls_results (role_, tbl, op, expect, outcome, result)
        values (r, t, op,
                case when expect_ok then 'allowed' else 'denied' end,
                detail,
                case when ok = expect_ok then 'PASS' else 'FAIL' end);
      end loop;
    end loop;

    reset role;
  end loop;

  -- Cleanup (as the editor's own role). Cascades remove invoices + nudges.
  delete from chaser_customers where name in ('RLS Test Customer', 'rls-probe');
end $$;

select
  result,
  role_   as role,
  tbl     as "table",
  op      as operation,
  expect  as expected,
  outcome
from chaser_rls_results
order by ord;
