-- Invoice Chaser: verify the 2026-11-05 compete upgrades.
-- Run in the Supabase SQL editor AFTER schema.sql (or the patch). Every row
-- must say PASS. Run verify-rls.sql as well: it covers chaser_promises' RLS.
--
-- Everything below runs inside a sub-transaction that is deliberately rolled
-- back at the end, so the script leaves NO rows behind and does not disturb
-- any demo or real data already in the project. Results survive the rollback
-- because they are held in a plpgsql variable, not a table.

drop table if exists chaser_upgrade_results;
create temp table chaser_upgrade_results (ord serial, test text, result text, detail text);

do $$
declare
  buf      jsonb := '[]'::jsonb;
  cust     uuid;
  inv      uuid;
  dcust    uuid;
  dinv     uuid;
  r        jsonb;
  rec      record;
  n        int;
  n2       int;
  real_inv_before int;
  real_cust_before int;
  qid      uuid := gen_random_uuid();

  procedure_ok boolean;
begin
  -- helper as a local closure isn't possible in plpgsql; each check appends to buf.
  begin
    -- 1. Columns and table
    for rec in
      select * from (values
        ('chaser_customers', 'is_demo'), ('chaser_invoices', 'is_demo'), ('chaser_nudges', 'is_demo'),
        ('chaser_invoices', 'paid_at'), ('chaser_invoices', 'paid_by'), ('chaser_invoices', 'source_quote_id'),
        ('chaser_nudges', 'stage'), ('chaser_promises', 'promised_on'), ('chaser_promises', 'note')
      ) as v(t, c)
    loop
      select count(*) into n from information_schema.columns
      where table_schema = 'public' and table_name = rec.t and column_name = rec.c;
      buf := buf || jsonb_build_object('t', format('column %s.%s exists', rec.t, rec.c),
        'r', case when n = 1 then 'PASS' else 'FAIL' end, 'd', n::text);
    end loop;

    select relrowsecurity into procedure_ok from pg_class where oid = 'public.chaser_promises'::regclass;
    buf := buf || jsonb_build_object('t', 'chaser_promises has RLS enabled', 'r', case when procedure_ok then 'PASS' else 'FAIL' end, 'd', procedure_ok::text);

    -- 2. Auto-stop audit stamp
    perform set_config('request.jwt.claims', '{"email":"verify-owner@example.com","role":"authenticated"}', true);
    insert into chaser_customers (name, phone) values ('VERIFY Real Customer', '+27000000000') returning id into cust;
    insert into chaser_invoices (customer_id, reference, amount_cents, issued_on, due_on)
      values (cust, 'VERIFY-1', 100000, current_date - 40, current_date - 10) returning id into inv;
    select count(*) into n from chaser_invoices where id = inv and paid_at is null and paid_by is null and status = 'unpaid';
    buf := buf || jsonb_build_object('t', 'unpaid invoice has no paid stamp', 'r', case when n = 1 then 'PASS' else 'FAIL' end, 'd', n::text);

    update chaser_invoices set amount_paid_cents = 40000 where id = inv;
    select count(*) into n from chaser_invoices where id = inv and status = 'partial' and paid_at is null;
    buf := buf || jsonb_build_object('t', 'partial payment: still no paid stamp', 'r', case when n = 1 then 'PASS' else 'FAIL' end, 'd', n::text);

    update chaser_invoices set amount_paid_cents = 100000 where id = inv;
    select count(*) into n from chaser_invoices
      where id = inv and status = 'paid' and paid_at is not null and paid_by = 'verify-owner@example.com';
    buf := buf || jsonb_build_object('t', 'final payment: status paid, paid_at stamped, paid_by = login email from JWT', 'r', case when n = 1 then 'PASS' else 'FAIL' end, 'd', n::text);

    update chaser_invoices set notes = 'touch' where id = inv;
    select count(*) into n from chaser_invoices where id = inv and paid_by = 'verify-owner@example.com' and paid_at is not null;
    buf := buf || jsonb_build_object('t', 'editing a paid invoice keeps who/when', 'r', case when n = 1 then 'PASS' else 'FAIL' end, 'd', n::text);

    update chaser_invoices set amount_paid_cents = 50000 where id = inv;
    select count(*) into n from chaser_invoices where id = inv and status = 'partial' and paid_at is null and paid_by is null;
    buf := buf || jsonb_build_object('t', 'correcting back to partial clears paid_at/paid_by', 'r', case when n = 1 then 'PASS' else 'FAIL' end, 'd', n::text);

    update chaser_invoices set paid_by = 'app-sent@example.com', amount_paid_cents = 100000 where id = inv;
    select count(*) into n from chaser_invoices where id = inv and paid_by = 'app-sent@example.com';
    buf := buf || jsonb_build_object('t', 'paid_by sent by the app wins over the JWT claim', 'r', case when n = 1 then 'PASS' else 'FAIL' end, 'd', n::text);

    update chaser_invoices set status = 'written_off', amount_paid_cents = 0 where id = inv;
    select count(*) into n from chaser_invoices where id = inv and status = 'written_off' and paid_at is null;
    buf := buf || jsonb_build_object('t', 'written off: no paid stamp', 'r', case when n = 1 then 'PASS' else 'FAIL' end, 'd', n::text);

    -- 3. Import: source_quote_id dedupe, legacy payload unchanged
    select count(*) into n2 from chaser_customers;
    r := chaser_import_invoices(jsonb_build_object(
      'customers', jsonb_build_array(jsonb_build_object('key', 'q', 'id', null, 'name', 'VERIFY Quote Customer', 'phone', '+27000000009')),
      'invoices', jsonb_build_array(jsonb_build_object('customer_key', 'q', 'reference', 'Q-VERIFY', 'amount_cents', 250050,
        'issued_on', current_date - 20, 'due_on', current_date - 13, 'source_quote_id', qid))));
    buf := buf || jsonb_build_object('t', 'pull from quote: first import creates 1 invoice', 'r',
      case when (r->>'invoices_created')::int = 1 and (r->>'invoices_skipped')::int = 0 then 'PASS' else 'FAIL' end, 'd', r::text);

    r := chaser_import_invoices(jsonb_build_object(
      'customers', jsonb_build_array(jsonb_build_object('key', 'q', 'id', null, 'name', 'VERIFY Quote Customer', 'phone', '+27000000009')),
      'invoices', jsonb_build_array(jsonb_build_object('customer_key', 'q', 'reference', 'Q-VERIFY', 'amount_cents', 250050,
        'issued_on', current_date - 20, 'due_on', current_date - 13, 'source_quote_id', qid))));
    select count(*) into n from chaser_invoices where source_quote_id = qid;
    buf := buf || jsonb_build_object('t', 're-running the pull never duplicates (skipped, 1 row total)', 'r',
      case when n = 1 and (r->>'invoices_skipped')::int = 1 and (r->>'invoices_created')::int = 0 then 'PASS' else 'FAIL' end, 'd', r::text);
    select count(*) into n from chaser_customers;
    buf := buf || jsonb_build_object('t', 'a skipped re-pull leaves no empty customer behind', 'r',
      case when n = n2 + 1 and (r->>'customers_created')::int = 0 then 'PASS' else 'FAIL' end, 'd', (n - n2)::text || ' new customer(s)');

    begin
      insert into chaser_invoices (customer_id, amount_cents, issued_on, due_on, source_quote_id)
        values (cust, 1, current_date, current_date, qid);
      buf := buf || jsonb_build_object('t', 'unique index rejects a second row for the same quote', 'r', 'FAIL', 'd', 'inserted');
    exception when unique_violation then
      buf := buf || jsonb_build_object('t', 'unique index rejects a second row for the same quote', 'r', 'PASS', 'd', 'unique_violation');
    end;

    r := chaser_import_invoices(jsonb_build_object(
      'customers', jsonb_build_array(jsonb_build_object('key', 'k', 'id', cust)),
      'invoices', jsonb_build_array(
        jsonb_build_object('customer_key', 'k', 'reference', 'VERIFY-CSV', 'amount_cents', 1000, 'issued_on', current_date, 'due_on', current_date),
        jsonb_build_object('customer_key', 'k', 'reference', 'VERIFY-CSV', 'amount_cents', 1000, 'issued_on', current_date, 'due_on', current_date))));
    buf := buf || jsonb_build_object('t', 'v1 CSV payload (no source_quote_id) behaves as before', 'r',
      case when (r->>'invoices_created')::int = 2 then 'PASS' else 'FAIL' end, 'd', r::text);
    select count(*) into n from chaser_invoices where reference in ('VERIFY-CSV', 'Q-VERIFY') and is_demo;
    buf := buf || jsonb_build_object('t', 'imported rows are never demo rows', 'r', case when n = 0 then 'PASS' else 'FAIL' end, 'd', n::text);

    -- 4. Demo mode
    select count(*) into real_inv_before from chaser_invoices where not is_demo;
    select count(*) into real_cust_before from chaser_customers where not is_demo;
    r := chaser_load_demo(jsonb_build_object(
      'customers', jsonb_build_array(
        jsonb_build_object('key', 'a', 'name', 'VERIFY Demo A', 'phone', '+27000000001', 'is_demo', false),
        jsonb_build_object('key', 'b', 'name', 'VERIFY Demo B', 'phone', '+27000000002')),
      'invoices', jsonb_build_array(
        jsonb_build_object('key', 'i1', 'customer_key', 'a', 'reference', 'DEMO-1', 'amount_cents', 345000, 'issued_on', current_date - 30, 'due_on', current_date - 16, 'is_demo', false),
        jsonb_build_object('key', 'i2', 'customer_key', 'b', 'reference', 'DEMO-2', 'amount_cents', 120000, 'amount_paid_cents', 120000, 'issued_on', current_date - 30, 'due_on', current_date - 20)),
      'nudges', jsonb_build_array(jsonb_build_object('invoice_key', 'i1', 'channel', 'whatsapp', 'tone', 'gentle', 'stage', 'friendly', 'sent_at', now() - interval '14 days')),
      'promises', jsonb_build_array(jsonb_build_object('invoice_key', 'i1', 'promised_on', current_date - 3, 'note', 'Said Friday')),
      'paid_at', jsonb_build_object('i2', (now() - interval '5 days')::text)));
    buf := buf || jsonb_build_object('t', 'load demo: counts', 'r',
      case when r = '{"customers_created":2,"invoices_created":2,"nudges_created":1,"promises_created":1}'::jsonb then 'PASS' else 'FAIL' end, 'd', r::text);
    select count(*) into n from chaser_customers where name like 'VERIFY Demo%' and not is_demo;
    select n + count(*) into n from chaser_invoices where reference like 'DEMO-%' and not is_demo;
    buf := buf || jsonb_build_object('t', 'load demo: every seeded row is_demo even when the payload says false', 'r', case when n = 0 then 'PASS' else 'FAIL' end, 'd', n::text);
    select count(*) into n from chaser_invoices where reference = 'DEMO-2' and status = 'paid' and paid_at::date = (now() - interval '5 days')::date;
    buf := buf || jsonb_build_object('t', 'load demo: seeded payment date is backdated', 'r', case when n = 1 then 'PASS' else 'FAIL' end, 'd', n::text);

    select id into dinv from chaser_invoices where reference = 'DEMO-1';
    select customer_id into dcust from chaser_invoices where id = dinv;
    insert into chaser_nudges (invoice_id, channel, tone) values (dinv, 'email', 'firm');
    insert into chaser_promises (invoice_id, promised_on) values (dinv, current_date + 2);
    select count(*) into n from chaser_nudges where invoice_id = dinv and not is_demo;
    select n + count(*) into n from chaser_promises where invoice_id = dinv and not is_demo;
    buf := buf || jsonb_build_object('t', 'nudge/promise logged on a demo invoice inherits is_demo', 'r', case when n = 0 then 'PASS' else 'FAIL' end, 'd', n::text);

    -- a real invoice added to a demo customer must survive removal
    insert into chaser_invoices (customer_id, reference, amount_cents, issued_on, due_on)
      values (dcust, 'VERIFY-REAL-ON-DEMO-CUSTOMER', 5000, current_date, current_date);
    r := chaser_remove_demo();
    select count(*) into n from chaser_invoices where is_demo;
    select n + count(*) into n from chaser_customers where is_demo;
    select n + count(*) into n from chaser_nudges where is_demo;
    select n + count(*) into n from chaser_promises where is_demo;
    buf := buf || jsonb_build_object('t', 'remove demo: no is_demo rows remain', 'r', case when n = 0 then 'PASS' else 'FAIL' end, 'd', r::text);
    select count(*) into n from chaser_invoices where not is_demo;
    select count(*) into n2 from chaser_customers where not is_demo;
    buf := buf || jsonb_build_object('t', 'remove demo: every real row kept (+1 real invoice, +1 un-marked customer)', 'r',
      case when n = real_inv_before + 1 and n2 = real_cust_before + 1 and (r->>'customers_kept')::int = 1 then 'PASS' else 'FAIL' end,
      'd', format('invoices %s->%s, customers %s->%s', real_inv_before, n, real_cust_before, n2));

    -- 5. Privileges on the new functions
    buf := buf || jsonb_build_object('t', 'anon cannot execute chaser_load_demo', 'r',
      case when has_function_privilege('anon', 'public.chaser_load_demo(jsonb)', 'EXECUTE') then 'FAIL' else 'PASS' end, 'd', '');
    buf := buf || jsonb_build_object('t', 'anon cannot execute chaser_remove_demo', 'r',
      case when has_function_privilege('anon', 'public.chaser_remove_demo()', 'EXECUTE') then 'FAIL' else 'PASS' end, 'd', '');
    buf := buf || jsonb_build_object('t', 'authenticated can execute chaser_load_demo / chaser_remove_demo', 'r',
      case when has_function_privilege('authenticated', 'public.chaser_load_demo(jsonb)', 'EXECUTE')
            and has_function_privilege('authenticated', 'public.chaser_remove_demo()', 'EXECUTE') then 'PASS' else 'FAIL' end, 'd', '');

    -- 6. As the real roles
    set local role authenticated;
    begin
      r := chaser_load_demo(jsonb_build_object('customers', jsonb_build_array(jsonb_build_object('key', 'x', 'name', 'VERIFY Auth Demo')),
        'invoices', jsonb_build_array(jsonb_build_object('key', 'y', 'customer_key', 'x', 'amount_cents', 100, 'issued_on', current_date, 'due_on', current_date))));
      r := chaser_remove_demo();
      buf := buf || jsonb_build_object('t', 'as authenticated: load + remove demo work through RLS', 'r',
        case when (r->>'invoices_removed')::int = 1 and current_user = 'authenticated' then 'PASS' else 'FAIL' end, 'd', r::text);
    exception when others then
      buf := buf || jsonb_build_object('t', 'as authenticated: load + remove demo work through RLS', 'r', 'FAIL', 'd', sqlerrm);
    end;
    reset role;

    set local role anon;
    begin
      r := chaser_remove_demo();
      buf := buf || jsonb_build_object('t', 'as anon: chaser_remove_demo is refused', 'r', 'FAIL', 'd', 'executed');
    exception when others then
      buf := buf || jsonb_build_object('t', 'as anon: chaser_remove_demo is refused', 'r', 'PASS', 'd', sqlerrm);
    end;
    begin
      perform count(*) from chaser_promises;
      buf := buf || jsonb_build_object('t', 'as anon: chaser_promises is refused', 'r', 'FAIL', 'd', 'selected');
    exception when others then
      buf := buf || jsonb_build_object('t', 'as anon: chaser_promises is refused', 'r', 'PASS', 'd', sqlerrm);
    end;
    reset role;

    raise exception 'chaser_verify_rollback';
  exception when raise_exception then
    if sqlerrm <> 'chaser_verify_rollback' then raise; end if;
  end;

  insert into chaser_upgrade_results (test, result, detail)
  select x->>'t', x->>'r', x->>'d' from jsonb_array_elements(buf) with ordinality as e(x, i) order by i;
end $$;

select result, test, detail from chaser_upgrade_results order by ord;
