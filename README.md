# DropStack Invoice Chaser

Shows a service business exactly how much it is owed, by whom, and for how long — and makes chasing it one tap instead of an awkward evening. Not an invoicing system; it tracks what's outstanding.

Part of the DropStack service-business package: Mini-site, Lead Capture, Review Engine, Invoice Chaser. Sold together as one offer — build fee plus monthly. Each tool is its own repo and its own deploy.

## Stack

React + Vite, Tailwind CSS, Supabase (Postgres + Auth), Resend via Netlify Functions, Netlify.

Secrets live in `.env` (copy from `.env.example`). Never commit it.

## Local setup

1. `npm install`
2. Create a Supabase project (or use the shared `dropstack-dev` project during the build phase)
3. Paste `supabase/schema.sql` into the Supabase SQL editor and run it
4. Run `supabase/verify-rls.sql` — every row must return PASS
5. Create your owner login: Supabase dashboard → Authentication → Users → Add user
6. `cp .env.example .env` and fill in the values
7. Set `currency` in `companyConfig.js` (ZAR, USD, etc)
8. `npm run dev`

## White-labelling for a client

All client-specific values live in `companyConfig.js`. A new client deploy is: fork/copy this repo, swap `companyConfig.js`, create a fresh Supabase project and run `schema.sql`, connect a new Netlify site, point the domain. No code changes.

## Running the tests

`npm test` runs the money, date and CSV parsing tests with Node's built-in test runner (no extra dependency). Add a case there before changing any parsing rule.

## Money

Amounts are stored as **integer cents** in `bigint` columns. In the app an amount is a string until `parseAmountToCents` turns it into an integer, and stays an integer until `formatCents` renders it. No float ever represents money. Totals are summed from stored values on every render, never cached.

Parsing rules (same for manual entry and CSV import):

- Currency symbols, codes and spaces are ignored: `R1 500`, `ZAR 1,500.00`, `$1,500` all work.
- If both `,` and `.` appear, the last one is the decimal separator (`1,500.00` and `1.500,00` both → 1500.00).
- A lone `.` is always a decimal point.
- A lone `,` is a decimal comma if followed by 1–2 digits (`450,00`), a thousands separator if followed by exactly 3 (`1,500`).
- More than two decimal places is rejected rather than rounded.

## CSV import

Every row in the file ends up in the preview. Blank rows are counted and reported, not silently skipped. Rows that can't be parsed are flagged in red and can be edited inline; the import button stays disabled until every ticked row is clean. The import itself is one atomic database call (`chaser_import_invoices`), so a file either lands completely or not at all.

- **Columns** are matched by name, loosely (`Amount`, `Total`, `Amount Due`, `value` → amount). Any header can be re-mapped in the preview.
- **Dates**: `DD/MM/YYYY` (South African default), ISO, `17 Sep 2026`, `17-Sep-26`, Excel serial numbers. `x/y/z` where `x ≤ 12 < y` is read as US month-first. Missing due date → issued + 30 days (warned). Missing issued date → the due date (warned).
- **Customers** are matched to existing ones by phone, then email, then exact name. Rows with the same customer + reference as an existing invoice are flagged and unticked by default.
- **Delimiters**: comma, semicolon (Excel in some locales), tab and pipe are auto-detected.

`samples/messy-invoices.csv` is a deliberately awkward file for testing. Hand-checked outstanding after importing the six clean rows: 1500 + 450 + 1000 + 0 + 1500 + 7345.67 = **R 11 795,67**.

## RLS

`supabase/verify-rls.sql` switches to the `anon` and `authenticated` roles in turn and tries select/insert/update/delete on all three tables. It checks `current_user`, not `auth.role()` — the latter is null in the SQL editor and would make every guard silently pass. Run it after `schema.sql`; every row must read PASS.

## Build status

**v1 in progress — Stage 1 (schema, auth, manual entry, CSV import) built.** See `CLAUDE.md` for the full spec, build order and definition of done. See `PROMPT.md` for the Claude Code starting prompt.

## Scope discipline

`CLAUDE.md` has a "What NOT to do" section. It's there because scope creep is what kills solo builds. Anything listed there is deliberately v2 or later — including anything needing paid SMS/WhatsApp messaging or scheduled cron jobs, neither of which is in the budget yet.
