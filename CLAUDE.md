# CLAUDE.md — DropStack Invoice Chaser

Read automatically by Claude Code at session start. Source of truth for this repo. Follow it over any conflicting default behavior.

## Project

**Name:** DropStack Invoice Chaser
**Owner:** Thomas — DropStack
**Purpose:** Show a service business exactly how much money it is owed, by whom, and for how long — and make chasing it one tap instead of an awkward evening. One deploy per client.

**What this is not:** an invoicing system. It does not create invoices, calculate tax, or integrate with accounting software. The client already invoices somehow — on paper, in Word, in Xero, from the DropStack quote tool. This tracks what's **outstanding** and drives the follow-up. Keeping that scope tight is what makes it buildable and sellable.

**Why it sells:** ask any small service business owner how much they're currently owed and they won't know. That's the demo. The headline number on the dashboard is the entire pitch.

This is one of four tools sold as a package. It is standalone — no cross-tool dependencies.

## Tech stack — do not introduce others without asking

- React + Vite, Tailwind CSS
- Supabase (Postgres + Auth)
- Resend via Netlify Functions (server-side only)
- Netlify hosting

## Supabase arrangement — read carefully

During development this tool shares a Supabase project (`dropstack-dev`) with two siblings. **Every table here is prefixed `chaser_`.** Never touch a table without that prefix. At client deploy time it gets its own project; the prefix stays.

## Non-negotiable workflow rules

- **Never push directly to main.** Branch + PR every time.
- **Do not deploy.** Thomas handles that.
- **Never send real messages during development.** `+27000000000`, `test@example.com`.
- **No secrets in committed code.**
- **Ask before adding a dependency.**

## Money handling — non-negotiable

- Store amounts as **integer minor units** (cents), never floats. `1999` is R19.99. Floating-point money bugs are silent and destroy trust in the whole product.
- Currency code lives in `companyConfig.js` (`ZAR`, `USD`, etc). Format for display only, at the edge.
- Every derived total (outstanding, aging bucket sums) must be computed from stored values, never cached in a column that can drift.
- Rounding: round only at display time, never in stored data.

If the client ever sees a total that doesn't match their own arithmetic, they stop using the tool that day.

## Design tokens — shared across all DropStack tools

**Superseded Nov 2026.** The dark navy / cyan-to-violet palette that used to be here is retired and must not come back. The tools now use the outreach console's light design system, as specified in `~/dropstack-four-tools/dropstack-tools-DESIGN.md` §1: `#f5f5f7` canvas, white 18px-radius cards, `#1c1c1e` glass chrome, semantic pill pairs (good `#1a7a37`/`#e6f6ea`, warn `#a35200`/`#fff4e0`, bad `#c7001a`/`#ffeaec`, info `#0062cc`/`#e7f1ff`), action blue `#0071e3`. Invoice Chaser's aura leans blue/teal, kept to the header band, hero and empty states. The tokens live in `src/index.css`. Zero emojis.

## Data model

```sql
create table chaser_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create table chaser_invoices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references chaser_customers(id) on delete cascade,
  reference text,                      -- client's own invoice number
  description text,
  amount_cents bigint not null,        -- integer minor units. never float.
  amount_paid_cents bigint not null default 0,
  currency text not null default 'ZAR',
  issued_on date not null,
  due_on date not null,
  status text not null default 'unpaid',
     -- 'unpaid' | 'partial' | 'paid' | 'written_off'
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table chaser_nudges (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references chaser_invoices(id) on delete cascade,
  channel text not null,               -- 'whatsapp' | 'email'
  tone text not null,                  -- 'gentle' | 'firm' | 'final'
  sent_at timestamptz not null default now()
);
```

`status` should be derived-and-stored on write: `amount_paid_cents = 0` → unpaid, `0 < paid < amount` → partial, `>= amount` → paid. Enforce with a trigger so it can't drift from the amounts.

### RLS

Everything in this tool is owner-only. There is no anonymous surface in v1.

- authenticated owner: full access to all three tables
- anon: **no access to anything**

That's simpler than the sibling tools, so get it exactly right and don't over-engineer it. Still write `supabase/verify-rls.sql` proving anon cannot select, insert, update or delete on any of the three tables, and that authenticated can.

Check `current_user` as the primary role condition — `auth.role()` is null outside API calls and silently no-ops guards. This bug shipped undetected on a previous project.

## Product spec

### Dashboard (`/`, auth required) — the headline

Top of the page, largest element on screen: **total outstanding**, in the client's currency. Beneath it, the count of unpaid invoices and the oldest one's age in days.

This number is the product. Make it unmissable.

Below that, **aging buckets** as four cards: Current / 1–30 / 31–60 / 60+, each with a total and a count, each tappable to filter the list. Use the status colors above.

Then the **invoice list**, sorted by most overdue first. Each row: customer, reference, amount, days overdue with color coding, last-nudged indicator (e.g. "nudged 2× · last 5 days ago"), and a **Nudge** button.

Filters: status, customer, aging bucket. Search by customer or reference.

### Nudging

Tapping **Nudge** opens a small sheet:
1. Pick tone: **Gentle** / **Firm** / **Final**
2. Preview the rendered message with real values filled in
3. Choose channel: **WhatsApp** (opens `wa.me` pre-filled — owner sends from their own number, zero cost) or **Email** (Netlify Function → Resend)
4. Sending records a `chaser_nudges` row

Tone escalation should be genuinely different in register, not the same text with harsher adjectives:
- **Gentle** — assumes it was overlooked, friendly, no pressure
- **Firm** — states the amount and how overdue, asks for a payment date
- **Final** — clear, professional, states next steps; still not abusive or threatening

Templates in `companyConfig.js` with placeholders: `{customerName}`, `{businessName}`, `{amount}`, `{reference}`, `{daysOverdue}`, `{dueDate}`. Ship sensible defaults for all three tones, in both channels.

**Guard against over-nudging:** warn (don't block) if the same invoice was nudged within the last 3 days. Hounding a customer costs the client the relationship.

### Data entry — this decides adoption

**CSV import is a first-class feature, not an afterthought.** If onboarding a client means typing 40 invoices by hand, the tool dies in week one.

The importer must:
- Accept flexible column names (`amount`, `total`, `Amount Due`, `value` → all map to amount)
- Parse common date formats including South African `DD/MM/YYYY`
- Handle currency symbols, thousands separators, and spaces in amount fields
- Match existing customers by phone/email, create new ones otherwise
- Show a **preview table before committing**, with any problem rows flagged and editable
- Never silently drop a row — if it can't be parsed, say so and let the user fix it inline

Also support manual add/edit for one-offs.

### Recording payment
Mark paid in full, or enter a partial amount. Status recalculates automatically. Paid invoices drop out of the default view but stay searchable.

### Auth
Supabase Auth, email + password, no public signup. Owner created manually in the dashboard. Document in README.

## Build order

1. Schema + RLS + status trigger + `verify-rls.sql`
2. Auth + shell + manual invoice/customer entry
3. CSV import with preview and error handling
4. Dashboard: outstanding headline, aging buckets, invoice list with sorting and color coding
5. Filters + search
6. Nudge sheet: tones, template rendering, preview, wa.me deep links
7. Email channel via Netlify Function + Resend
8. Nudge history + over-nudge warning
9. Payment recording (full + partial)

## Definition of done

- `verify-rls.sql` returns PASS on every row
- Totals are arithmetically correct — verify by hand against a known set of invoices, including a partial payment
- Aging buckets place invoices in the correct band relative to `due_on` and today
- CSV import handles a deliberately messy file: mixed date formats, currency symbols, a blank row, a duplicate customer
- wa.me nudge links open with correct pre-filled text and correct amounts formatted properly
- All three tones render correctly with real values
- No floats anywhere in money handling

## What NOT to do

- Do not build invoice creation, line items, tax, or PDF generation. That's the quote tool's job; this tracks what's owed.
- No accounting software integrations in v1.
- No paid SMS/WhatsApp API — `wa.me` links and Resend email only.
- No cron or automated scheduled chasing in v1 — the owner opens the dashboard and taps. Flag scheduled chasing as v2 (it needs cron).
- No payment collection in v1.
- Don't deploy, and don't claim something is live.
