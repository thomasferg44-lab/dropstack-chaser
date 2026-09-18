-- DropStack Invoice Chaser — schema
-- Run in the Supabase SQL editor. Idempotent: safe to re-run.
--
-- Every table is prefixed chaser_ (shared dropstack-dev project during build).
-- Money is integer minor units (cents) in bigint. Never float, never numeric.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists chaser_customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  email       text,
  created_at  timestamptz not null default now()
);

create table if not exists chaser_invoices (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references chaser_customers(id) on delete cascade,
  reference         text,                          -- client's own invoice number
  description       text,
  amount_cents      bigint not null,               -- integer minor units. never float.
  amount_paid_cents bigint not null default 0,
  currency          text not null default 'ZAR',
  issued_on         date not null,
  due_on            date not null,
  status            text not null default 'unpaid',
     -- 'unpaid' | 'partial' | 'paid' | 'written_off'
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint chaser_invoices_amount_nonneg      check (amount_cents >= 0),
  constraint chaser_invoices_paid_nonneg        check (amount_paid_cents >= 0),
  constraint chaser_invoices_status_valid       check (status in ('unpaid','partial','paid','written_off')),
  constraint chaser_invoices_due_after_issued   check (due_on >= issued_on)
);

create table if not exists chaser_nudges (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references chaser_invoices(id) on delete cascade,
  channel     text not null,                       -- 'whatsapp' | 'email'
  tone        text not null,                       -- 'gentle' | 'firm' | 'final'
  sent_at     timestamptz not null default now(),

  constraint chaser_nudges_channel_valid check (channel in ('whatsapp','email')),
  constraint chaser_nudges_tone_valid    check (tone in ('gentle','firm','final'))
);

create index if not exists chaser_invoices_customer_idx on chaser_invoices (customer_id);
create index if not exists chaser_invoices_status_due_idx on chaser_invoices (status, due_on);
create index if not exists chaser_nudges_invoice_idx on chaser_nudges (invoice_id, sent_at desc);
-- Importer matches existing customers by phone / email.
create index if not exists chaser_customers_phone_idx on chaser_customers (phone);
create index if not exists chaser_customers_email_idx on chaser_customers (lower(email));

-- ---------------------------------------------------------------------------
-- Status trigger: status is derived from the amounts on every write so it
-- can never drift. 'written_off' is the one manual status and is preserved.
-- ---------------------------------------------------------------------------

create or replace function chaser_derive_invoice_status()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'written_off' then
    -- manual override; keep it
    null;
  elsif new.amount_paid_cents <= 0 then
    new.status := 'unpaid';
  elsif new.amount_paid_cents < new.amount_cents then
    new.status := 'partial';
  else
    new.status := 'paid';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists chaser_invoices_derive_status on chaser_invoices;
create trigger chaser_invoices_derive_status
  before insert or update on chaser_invoices
  for each row execute function chaser_derive_invoice_status();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Owner-only tool. No anonymous surface in v1.
--   authenticated : full access to all three tables
--   anon          : nothing
--
-- Policies are keyed on the Postgres role (`to authenticated`). We deliberately
-- do NOT use auth.role() — it returns null outside an API request, which makes
-- a guard like `auth.role() = 'authenticated'` silently false/no-op when you
-- test from the SQL editor, and hides bugs. verify-rls.sql checks the real role.
-- ---------------------------------------------------------------------------

alter table chaser_customers enable row level security;
alter table chaser_invoices  enable row level security;
alter table chaser_nudges    enable row level security;

-- Belt and braces: even if a policy were ever added for anon by mistake,
-- anon has no table privileges at all.
revoke all on chaser_customers, chaser_invoices, chaser_nudges from anon;
revoke all on chaser_customers, chaser_invoices, chaser_nudges from public;
grant select, insert, update, delete on chaser_customers, chaser_invoices, chaser_nudges to authenticated;

drop policy if exists chaser_customers_owner_all on chaser_customers;
create policy chaser_customers_owner_all on chaser_customers
  for all to authenticated
  using (true) with check (true);

drop policy if exists chaser_invoices_owner_all on chaser_invoices;
create policy chaser_invoices_owner_all on chaser_invoices
  for all to authenticated
  using (true) with check (true);

drop policy if exists chaser_nudges_owner_all on chaser_nudges;
create policy chaser_nudges_owner_all on chaser_nudges
  for all to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- CSV import: one atomic call. Either every row lands or none do — a partial
-- import is exactly the "silently dropped rows" failure the importer must
-- never produce.
--
-- payload = {
--   "customers": [{ "key", "id" (uuid|null), "name", "phone", "email" }],
--   "invoices":  [{ "customer_key", "reference", "description", "amount_cents",
--                   "amount_paid_cents", "currency", "issued_on", "due_on", "notes" }]
-- }
-- Customers with id = null are created; the rest are referenced as-is.
-- SECURITY INVOKER (the default): runs as the caller, so RLS still applies
-- and anon cannot use it (it has no privilege on the tables or this function).
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
begin
  for c in select * from jsonb_array_elements(coalesce(payload->'customers', '[]'::jsonb)) loop
    if c->>'id' is null then
      insert into chaser_customers (name, phone, email)
      values (c->>'name', nullif(c->>'phone', ''), nullif(c->>'email', ''))
      returning id into new_id;
      created_c := created_c + 1;
    else
      new_id := (c->>'id')::uuid;
    end if;
    key_to_id := key_to_id || jsonb_build_object(c->>'key', new_id::text);
  end loop;

  for i in select * from jsonb_array_elements(coalesce(payload->'invoices', '[]'::jsonb)) loop
    if key_to_id->>(i->>'customer_key') is null then
      raise exception 'Unknown customer key %', i->>'customer_key';
    end if;
    insert into chaser_invoices
      (customer_id, reference, description, amount_cents, amount_paid_cents,
       currency, issued_on, due_on, notes)
    values
      ((key_to_id->>(i->>'customer_key'))::uuid,
       nullif(i->>'reference', ''),
       nullif(i->>'description', ''),
       (i->>'amount_cents')::bigint,
       coalesce((i->>'amount_paid_cents')::bigint, 0),
       coalesce(nullif(i->>'currency', ''), 'ZAR'),
       (i->>'issued_on')::date,
       (i->>'due_on')::date,
       nullif(i->>'notes', ''));
    created_i := created_i + 1;
  end loop;

  return jsonb_build_object('customers_created', created_c, 'invoices_created', created_i);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges.
-- Supabase's default privileges grant EXECUTE on every new function in
-- `public` to anon AND authenticated directly (not just via PUBLIC), so
-- revoking from PUBLIC alone leaves those grants in place. Revoke from all
-- three explicitly, then grant back only what the app needs.
-- verify-rls.sql enumerates every chaser_% function and fails if anon or
-- PUBLIC can execute anything outside its allow-list.
-- ---------------------------------------------------------------------------

revoke all on function public.chaser_derive_invoice_status() from public, anon, authenticated;
revoke all on function public.chaser_import_invoices(jsonb)  from public, anon, authenticated;
grant execute on function public.chaser_import_invoices(jsonb) to authenticated;
