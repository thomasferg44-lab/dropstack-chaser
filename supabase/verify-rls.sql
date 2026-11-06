-- DropStack Invoice Chaser — RLS verification
-- Run in the Supabase SQL editor AFTER schema.sql. Every row must say PASS.
--
-- It switches role to `anon` and `authenticated` with `set role` and
-- attempts every operation on every chaser_ table (customers, invoices,
-- nudges and, since 2026-11-05, promises). While switched, results
-- are buffered in a plpgsql variable (anon can't write to the temp table)
-- and inserted after `reset role`. It checks `current_user`,
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
  step      int;
  buf       jsonb := '[]'::jsonb;   -- results collected while switched to a restricted role
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
  insert into chaser_promises (invoice_id, promised_on, note)
    values (inv_id, current_date, 'RLS test promise');

  foreach r in array array['anon', 'authenticated'] loop
    expect_ok := (r = 'authenticated');

    execute format('set role %I', r);

    -- Sanity: the role switch actually happened. This is the current_user check.
    buf := buf || jsonb_build_object(
      'role', r, 'tbl', '-', 'op', 'current_user = ' || r, 'expect', 'true',
      'outcome', current_user::text,
      'result', case when current_user::text = r then 'PASS' else 'FAIL' end);

    -- select / insert / update on every table first, then deletes child-first.
    -- Deleting the customer earlier would cascade away the seeded invoice and
    -- nudge and make every later check on those tables fail for the wrong reason.
    for step in 1..20 loop
      if step <= 16 then
        t  := (array['chaser_customers', 'chaser_invoices', 'chaser_nudges', 'chaser_promises'])[((step - 1) / 4) + 1];
        op := (array['select', 'insert', 'update', 'delete'])[((step - 1) % 4) + 1];
        continue when op = 'delete';
      else
        t  := (array['chaser_promises', 'chaser_nudges', 'chaser_invoices', 'chaser_customers'])[step - 16];
        op := 'delete';
      end if;

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
          elsif t = 'chaser_nudges' then
            execute format('insert into chaser_nudges (invoice_id, channel, tone) values (%L, ''email'', ''firm'')', inv_id);
          else
            execute format('insert into chaser_promises (invoice_id, promised_on) values (%L, current_date)', inv_id);
          end if;
          ok := true; detail := 'inserted';
        elsif op = 'update' then
          if t = 'chaser_customers' then
            execute format('update chaser_customers set name = name where id = %L', cust_id);
          elsif t = 'chaser_invoices' then
            execute format('update chaser_invoices set notes = ''probe'' where id = %L', inv_id);
          elsif t = 'chaser_nudges' then
            execute format('update chaser_nudges set tone = tone where invoice_id = %L', inv_id);
          else
            execute format('update chaser_promises set note = note where invoice_id = %L', inv_id);
          end if;
          get diagnostics n = row_count;
          ok := (n > 0); detail := n || ' rows affected';
        else -- delete, child-first: promises → nudges → invoices → customers
          if t = 'chaser_promises' then
            execute format('delete from chaser_promises where invoice_id = %L', inv_id);
          elsif t = 'chaser_nudges' then
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

      buf := buf || jsonb_build_object(
        'role', r, 'tbl', t, 'op', op,
        'expect', case when expect_ok then 'allowed' else 'denied' end,
        'outcome', detail,
        'result', case when ok = expect_ok then 'PASS' else 'FAIL' end);
    end loop;

    reset role;
  end loop;

  -- Back as the editor's own role: flush the buffered results, in order.
  insert into chaser_rls_results (role_, tbl, op, expect, outcome, result)
  select x->>'role', x->>'tbl', x->>'op', x->>'expect', x->>'outcome', x->>'result'
  from jsonb_array_elements(buf) with ordinality as e(x, i)
  order by i;

  -- Cleanup (as the editor's own role). Cascades remove invoices + nudges.
  delete from chaser_customers where name in ('RLS Test Customer', 'rls-probe');
end $$;

-- ---------------------------------------------------------------------------
-- Catalog checks. These don't depend on seed data or role switching: they
-- read pg_catalog directly so a newly added table or function that slipped
-- past the grants in schema.sql shows up as a FAIL here.
-- ---------------------------------------------------------------------------

do $$
declare
  -- Functions anon / PUBLIC are ALLOWED to execute. Empty in v1: there is no
  -- anonymous surface. Add a signature here only when a deliberately public
  -- function is introduced, e.g. 'chaser_public_thing(uuid)'.
  anon_allow  text[] := array[]::text[];
  -- Functions authenticated MUST be able to execute (the app calls these).
  auth_must   text[] := array['chaser_import_invoices(jsonb)', 'chaser_load_demo(jsonb)', 'chaser_remove_demo()'];

  f           record;
  t           record;
  sig         text;
  anon_exec   boolean;
  public_exec boolean;
  auth_exec   boolean;
  allowed     boolean;
  n_funcs     int := 0;
begin
  -- Every chaser_% table must have RLS enabled and anon must hold no privilege.
  for t in
    select c.oid, c.relname, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'chaser\_%'
    order by c.relname
  loop
    insert into chaser_rls_results (role_, tbl, op, expect, outcome, result)
    values ('catalog', t.relname, 'rls enabled', 'true', t.relrowsecurity::text,
            case when t.relrowsecurity then 'PASS' else 'FAIL' end);

    anon_exec := has_table_privilege('anon', t.oid, 'SELECT, INSERT, UPDATE, DELETE');
    insert into chaser_rls_results (role_, tbl, op, expect, outcome, result)
    values ('catalog', t.relname, 'anon table privileges', 'none',
            case when anon_exec then 'anon holds a privilege' else 'none' end,
            case when anon_exec then 'FAIL' else 'PASS' end);
  end loop;

  -- Every chaser_% function: anon and PUBLIC must not hold EXECUTE unless
  -- allow-listed. Listed by full signature so overloads can't hide.
  for f in
    select p.oid, p.oid::regprocedure::text as sig, p.proacl, p.proowner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'chaser\_%'
    order by 2
  loop
    n_funcs := n_funcs + 1;
    sig := regexp_replace(f.sig, '^public\.', '');
    allowed := sig = any (anon_allow);

    -- PUBLIC (grantee oid 0) — an explicit grant to PUBLIC, or the default
    -- ACL when proacl is null (Postgres grants EXECUTE to PUBLIC by default).
    select exists (
      select 1 from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) into public_exec;

    -- anon — direct grant or via PUBLIC (has_function_privilege covers both).
    anon_exec := has_function_privilege('anon', f.oid, 'EXECUTE');
    auth_exec := has_function_privilege('authenticated', f.oid, 'EXECUTE');

    insert into chaser_rls_results (role_, tbl, op, expect, outcome, result)
    values ('catalog', sig, 'PUBLIC execute',
            case when allowed then 'allowed' else 'denied' end,
            case when public_exec then 'PUBLIC can execute' else 'denied' end,
            case when public_exec = allowed then 'PASS' else 'FAIL' end);

    insert into chaser_rls_results (role_, tbl, op, expect, outcome, result)
    values ('catalog', sig, 'anon execute',
            case when allowed then 'allowed' else 'denied' end,
            case when anon_exec then 'anon can execute' else 'denied' end,
            case when anon_exec = allowed then 'PASS' else 'FAIL' end);

    -- authenticated: must be able to call the app's RPCs, and nothing else
    -- (the trigger function is fired by the trigger, never called directly).
    insert into chaser_rls_results (role_, tbl, op, expect, outcome, result)
    values ('catalog', sig, 'authenticated execute',
            case when sig = any (auth_must) then 'allowed' else 'denied' end,
            case when auth_exec then 'authenticated can execute' else 'denied' end,
            case when auth_exec = (sig = any (auth_must)) then 'PASS' else 'FAIL' end);
  end loop;

  -- Guard against the loop silently checking nothing (e.g. wrong schema).
  insert into chaser_rls_results (role_, tbl, op, expect, outcome, result)
  values ('catalog', '-', 'chaser_% functions found', '>= ' || array_length(auth_must, 1),
          n_funcs::text,
          case when n_funcs >= array_length(auth_must, 1) then 'PASS' else 'FAIL' end);

  -- Every function authenticated must be able to call actually exists.
  foreach sig in array auth_must loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and regexp_replace(p.oid::regprocedure::text, '^public\.', '') = sig
    ) then
      insert into chaser_rls_results (role_, tbl, op, expect, outcome, result)
      values ('catalog', sig, 'exists', 'true', 'missing', 'FAIL');
    end if;
  end loop;
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
