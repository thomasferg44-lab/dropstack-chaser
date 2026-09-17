# Paste this into Claude Code

Open this folder in VS Code, start Claude Code, switch to Fable with `/model fable`, then paste everything below the line.

---

Read CLAUDE.md in this repo before doing anything else.

Build in stages per the "Build order" section of CLAUDE.md. Do not skip ahead to later stages.

**Stage 1 only:** Scaffold the project (Vite + React + Tailwind + supabase-js), write `supabase/schema.sql` with the `chaser_*` tables, the status trigger, and RLS as specified, then build manual invoice/customer entry and the CSV import.

Two things in CLAUDE.md matter more than they look:

**Money handling.** Amounts are stored as integer minor units (cents) in a bigint. No floats anywhere, ever. Round only at display time. If a client sees a total that doesn't match their own arithmetic, they stop trusting the product that day.

**CSV import.** This decides whether the tool gets adopted. A new client arrives with a pile of unpaid invoices — if onboarding means typing 40 rows by hand, nobody uses it. Make the importer forgiving about column names, date formats (including South African DD/MM/YYYY), currency symbols and thousands separators. Show a preview table before committing, flag problem rows, and never silently drop a row.

Also write `supabase/verify-rls.sql` printing PASS/FAIL per check. Note the `auth.role()` vs `current_user` warning in CLAUDE.md.

Before you write any code:
1. Confirm you have read the money handling and design tokens sections.
2. Propose the file structure you intend to create.

Then build Stage 1 only and stop. Show me what you've built before moving to Stage 2.

---

## Notes for you (Thomas) — not part of the prompt

**Test this first when Stage 1 comes back:** Import a deliberately messy CSV — mixed date formats, an R symbol, a blank row, a duplicate customer. Then check the outstanding total by hand against a calculator. If the arithmetic is off by a cent, everything else is worthless.

**Rules that apply the whole way through:**
- Branch + PR. Never let it push to main.
- It does not deploy. You do.
- No real messages or emails sent during development — test data only.
- Review each stage before saying "continue to Stage 2". Redirecting after Stage 1 is cheap; after Stage 5 it isn't.
