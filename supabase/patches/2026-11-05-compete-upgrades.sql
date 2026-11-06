-- Invoice Chaser: compete pass, 2026-11-05
--
-- ADDITIVE ONLY. Paste into the Supabase SQL editor of a project that already
-- ran schema.sql. Idempotent: safe to run twice. One transaction: it either
-- lands completely or not at all. Already folded into schema.sql, so a fresh
-- project only needs schema.sql.
--
-- What it adds
--   chaser_customers.is_demo, chaser_invoices.is_demo, chaser_nudges.is_demo
--       demo rows are marked so "Remove demo data" deletes exactly them
--   chaser_invoices.paid_at, paid_by
--       auto-stop audit: when the invoice became paid, and by which login
--   chaser_invoices.source_quote_id (+ unique partial index)
--       the Quote & Invoice quote an invoice was pulled from; re-pulling
--       can never duplicate it
--   chaser_nudges.stage
--       which escalation-ladder stage a nudge was sent as
--   chaser_promises (new table, same owner-only RLS as the others)
--       promise-to-pay log: promised date + optional note
--   chaser_derive_invoice_status()  now also stamps / clears paid_at, paid_by
--   chaser_inherit_demo()           nudges/promises on a demo invoice are demo
--   chaser_import_invoices(jsonb)   same signature; accepts source_quote_id and
--                                   skips quotes already imported
--   chaser_load_demo(jsonb)         seeds demo rows atomically, all is_demo
--   chaser_remove_demo()            deletes exactly the is_demo rows
--
-- RLS model unchanged: authenticated full access, anon nothing. Every new
-- function is revoked from public/anon/authenticated and granted back to
-- authenticated only where the app calls it. verify-rls.sql and
-- verify-compete-upgrades.sql must both read PASS on every row afterwards.

begin;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table chaser_customers add column if not exists is_demo boolean not null default false;
alter table chaser_invoices  add column if not exists is_demo boolean not null default false;
alter table chaser_nudges    add column if not exists is_demo boolean not null default false;

alter table chaser_invoices add column if not exists paid_at timestamptz;
alter table chaser_invoices add column if not exists paid_by text;
alter table chaser_invoices add column if not exists source_quote_id uuid;
alter table chaser_nudges   add column if not exists stage text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chaser_nudges_stage_len') then
    alter table chaser_nudges add constraint chaser_nudges_stage_len
      check (stage is null or length(stage) between 1 and 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chaser_invoices_paid_by_len') then
    alter table chaser_invoices add constraint chaser_invoices_paid_by_len
      check (paid_by is null or length(paid_by) <= 320);
  end if;
end $$;

create unique index if not exists chaser_invoices_source_quote_uq
  on chaser_invoices (source_quote_id) where source_quote_id is not null;
create index if not exists chaser_customers_demo_idx on chaser_customers (is_demo) where is_demo;
create index if not exists chaser_invoices_demo_idx  on chaser_invoices (is_demo) where is_demo;

-- ---------------------------------------------------------------------------
-- chaser_promises
-- ---------------------------------------------------------------------------
create table if not exists chaser_promises (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references chaser_invoices(id) on delete cascade,
  promised_on  date not null,
  note         text,
  created_at   timestamptz not null default now(),
  created_by   text,
  is_demo      boolean not null default false,

  constraint chaser_promises_note_len check (note is null or length(note) <= 500)
);
create index if not exists chaser_promises_invoice_idx on chaser_promises (invoice_id, created_at desc);

alter table chaser_promises enable row level security;
revoke all on chaser_promises from anon;
revoke all on chaser_promises from public;
grant select, insert, update, delete on chaser_promises to authenticated;

drop policy if exists chaser_promises_owner_all on chaser_promises;
create policy chaser_promises_owner_all on chaser_promises
  for all to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Status trigger: unchanged derivation, plus the auto-stop audit stamp.
-- paid_by is the signed-in login's email from the PostgREST JWT claims when
-- the app didn't send one. current_setting(..., true) is null-safe in the
-- SQL editor.
-- ---------------------------------------------------------------------------
create or replace function chaser_derive_invoice_status()
returns trigger
language plpgsql
as $$
declare
  was_paid boolean := (tg_op = 'UPDATE' and old.status = 'paid');
begin
  if new.status = 'written_off' then
    null; -- manual override; keep it
  elsif new.amount_paid_cents <= 0 then
    new.status := 'unpaid';
  elsif new.amount_paid_cents < new.amount_cents then
    new.status := 'partial';
  else
    new.status := 'paid';
  end if;

  if new.status = 'paid' then
    if not was_paid or new.paid_at is null then
      new.paid_at := coalesce(new.paid_at, now());
      new.paid_by := coalesce(
        nullif(new.paid_by, ''),
        nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'email', ''));
    end if;
  else
    new.paid_at := null;
    new.paid_by := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- A nudge or promise logged against a demo invoice is demo data too, so
-- "Remove demo data" can't leave orphans and never has to guess.
-- ---------------------------------------------------------------------------
create or replace function chaser_inherit_demo()
returns trigger
language plpgsql
as $$
begin
  new.is_demo := coalesce(new.is_demo, false)
    or coalesce((select i.is_demo from chaser_invoices i where i.id = new.invoice_id), false);
  return new;
end;
$$;

drop trigger if exists chaser_nudges_inherit_demo on chaser_nudges;
create trigger chaser_nudges_inherit_demo
  before insert on chaser_nudges
  for each row execute function chaser_inherit_demo();

drop trigger if exists chaser_promises_inherit_demo on chaser_promises;
create trigger chaser_promises_inherit_demo
  before insert on chaser_promises
  for each row execute function chaser_inherit_demo();

-- ---------------------------------------------------------------------------
-- CSV / Quote import: same signature and behaviour as before, plus:
--   invoices[].source_quote_id  stored; a quote already imported is skipped
--                               (counted in invoices_skipped), never duplicated
-- Imported rows are never demo rows.
-- ---------------------------------------------------------------------------
create or replace function chaser_import_invoices(payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  c            jsonb;
  i            jsonb;
  key_to_id    jsonb := '{}'::jsonb;
  new_id       uuid;
  created_c    int := 0;
  created_i    int := 0;
  skipped_i    int := 0;
  removed_c    int := 0;
  created_ids  uuid[] := array[]::uuid[];
  quote_id     uuid;
begin
  for c in select * from jsonb_array_elements(coalesce(payload->'customers', '[]'::jsonb)) loop
    if c->>'id' is null then
      insert into chaser_customers (name, phone, email)
      values (c->>'name', nullif(c->>'phone', ''), nullif(c->>'email', ''))
      returning id into new_id;
      created_c := created_c + 1;
      created_ids := created_ids || new_id;
    else
      new_id := (c->>'id')::uuid;
    end if;
    key_to_id := key_to_id || jsonb_build_object(c->>'key', new_id::text);
  end loop;

  for i in select * from jsonb_array_elements(coalesce(payload->'invoices', '[]'::jsonb)) loop
    if key_to_id->>(i->>'customer_key') is null then
      raise exception 'Unknown customer key %', i->>'customer_key';
    end if;
    quote_id := nullif(i->>'source_quote_id', '')::uuid;
    insert into chaser_invoices
      (customer_id, reference, description, amount_cents, amount_paid_cents,
       currency, issued_on, due_on, notes, source_quote_id)
    values
      ((key_to_id->>(i->>'customer_key'))::uuid,
       nullif(i->>'reference', ''),
       nullif(i->>'description', ''),
       (i->>'amount_cents')::bigint,
       coalesce((i->>'amount_paid_cents')::bigint, 0),
       coalesce(nullif(i->>'currency', ''), 'ZAR'),
       (i->>'issued_on')::date,
       (i->>'due_on')::date,
       nullif(i->>'notes', ''),
       quote_id)
    on conflict (source_quote_id) where source_quote_id is not null do nothing;
    if found then created_i := created_i + 1; else skipped_i := skipped_i + 1; end if;
  end loop;

  -- A customer created in this call only for skipped invoices would be an
  -- empty shell: remove it again.
  delete from chaser_customers cu
  where cu.id = any (created_ids)
    and not exists (select 1 from chaser_invoices x where x.customer_id = cu.id);
  get diagnostics removed_c = row_count;

  return jsonb_build_object('customers_created', created_c - removed_c, 'invoices_created', created_i,
                            'invoices_skipped', skipped_i);
end;
$$;

-- ---------------------------------------------------------------------------
-- Demo mode. Every row this writes is is_demo = true, whatever the payload
-- says, so it can never mark or touch a real row.
-- payload = {
--   customers: [{ key, name, phone, email }],
--   invoices:  [{ key, customer_key, reference, description, amount_cents,
--                 amount_paid_cents, currency, issued_on, due_on, notes }],
--   nudges:    [{ invoice_key, channel, tone, stage, sent_at }],
--   promises:  [{ invoice_key, promised_on, note, created_at }],
--   paid_at:   { invoice_key: timestamptz }   -- backdates a seeded payment
-- }
-- ---------------------------------------------------------------------------
create or replace function chaser_load_demo(payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  c          jsonb;
  i          jsonb;
  n          jsonb;
  p          jsonb;
  ckeys      jsonb := '{}'::jsonb;
  ikeys      jsonb := '{}'::jsonb;
  new_id     uuid;
  k          text;
  v          text;
  counts     int[] := array[0, 0, 0, 0];
begin
  for c in select * from jsonb_array_elements(coalesce(payload->'customers', '[]'::jsonb)) loop
    insert into chaser_customers (name, phone, email, is_demo)
    values (c->>'name', nullif(c->>'phone', ''), nullif(c->>'email', ''), true)
    returning id into new_id;
    ckeys := ckeys || jsonb_build_object(c->>'key', new_id::text);
    counts[1] := counts[1] + 1;
  end loop;

  for i in select * from jsonb_array_elements(coalesce(payload->'invoices', '[]'::jsonb)) loop
    if ckeys->>(i->>'customer_key') is null then
      raise exception 'Unknown demo customer key %', i->>'customer_key';
    end if;
    insert into chaser_invoices
      (customer_id, reference, description, amount_cents, amount_paid_cents,
       currency, issued_on, due_on, notes, is_demo)
    values
      ((ckeys->>(i->>'customer_key'))::uuid,
       nullif(i->>'reference', ''), nullif(i->>'description', ''),
       (i->>'amount_cents')::bigint, coalesce((i->>'amount_paid_cents')::bigint, 0),
       coalesce(nullif(i->>'currency', ''), 'ZAR'),
       (i->>'issued_on')::date, (i->>'due_on')::date, nullif(i->>'notes', ''), true)
    returning id into new_id;
    ikeys := ikeys || jsonb_build_object(i->>'key', new_id::text);
    counts[2] := counts[2] + 1;
  end loop;

  for n in select * from jsonb_array_elements(coalesce(payload->'nudges', '[]'::jsonb)) loop
    if ikeys->>(n->>'invoice_key') is null then
      raise exception 'Unknown demo invoice key %', n->>'invoice_key';
    end if;
    insert into chaser_nudges (invoice_id, channel, tone, stage, sent_at, is_demo)
    values ((ikeys->>(n->>'invoice_key'))::uuid, n->>'channel', n->>'tone', nullif(n->>'stage', ''),
            coalesce((n->>'sent_at')::timestamptz, now()), true);
    counts[3] := counts[3] + 1;
  end loop;

  for p in select * from jsonb_array_elements(coalesce(payload->'promises', '[]'::jsonb)) loop
    if ikeys->>(p->>'invoice_key') is null then
      raise exception 'Unknown demo invoice key %', p->>'invoice_key';
    end if;
    insert into chaser_promises (invoice_id, promised_on, note, created_at, is_demo)
    values ((ikeys->>(p->>'invoice_key'))::uuid, (p->>'promised_on')::date, nullif(p->>'note', ''),
            coalesce((p->>'created_at')::timestamptz, now()), true);
    counts[4] := counts[4] + 1;
  end loop;

  for k, v in select * from jsonb_each_text(coalesce(payload->'paid_at', '{}'::jsonb)) loop
    update chaser_invoices set paid_at = v::timestamptz
    where id = (ikeys->>k)::uuid and is_demo and status = 'paid';
  end loop;

  return jsonb_build_object('customers_created', counts[1], 'invoices_created', counts[2],
                            'nudges_created', counts[3], 'promises_created', counts[4]);
end;
$$;

-- Deletes exactly the is_demo rows. A demo customer that the owner has since
-- given a real invoice is kept (and un-marked) rather than cascading that
-- real invoice away.
create or replace function chaser_remove_demo()
returns jsonb
language plpgsql
as $$
declare
  n_nudges   int;
  n_promises int;
  n_invoices int;
  n_customers int;
  n_kept     int;
begin
  delete from chaser_nudges   where is_demo;  get diagnostics n_nudges = row_count;
  delete from chaser_promises where is_demo;  get diagnostics n_promises = row_count;
  delete from chaser_invoices where is_demo;  get diagnostics n_invoices = row_count;

  update chaser_customers cu set is_demo = false
  where cu.is_demo and exists (select 1 from chaser_invoices x where x.customer_id = cu.id);
  get diagnostics n_kept = row_count;

  delete from chaser_customers where is_demo; get diagnostics n_customers = row_count;

  return jsonb_build_object('nudges_removed', n_nudges, 'promises_removed', n_promises,
                            'invoices_removed', n_invoices, 'customers_removed', n_customers,
                            'customers_kept', n_kept);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges (same pattern as schema.sql: revoke from all three,
-- grant back only what the app calls).
-- ---------------------------------------------------------------------------
revoke all on function public.chaser_derive_invoice_status() from public, anon, authenticated;
revoke all on function public.chaser_inherit_demo()          from public, anon, authenticated;
revoke all on function public.chaser_import_invoices(jsonb)  from public, anon, authenticated;
revoke all on function public.chaser_load_demo(jsonb)        from public, anon, authenticated;
revoke all on function public.chaser_remove_demo()           from public, anon, authenticated;
grant execute on function public.chaser_import_invoices(jsonb) to authenticated;
grant execute on function public.chaser_load_demo(jsonb)       to authenticated;
grant execute on function public.chaser_remove_demo()          to authenticated;

commit;
