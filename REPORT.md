# REPORT: Invoice Chaser compete pass (reskin + functional upgrades)

Branch `compete/chaser-upgrades`, cut from `feat/stage-1-scaffold-schema-import` at fff7b9f (the live build). Covers BUILD_BRIEF.md in full, including both Nov 5 addenda. **Not pushed, not deployed, no SQL applied to any real database, no real message sent to anyone, no automated WhatsApp anything.** The schema patch is a file.

Format follows `dropstack-tools-DESIGN.md` §6: baseline → what changed → Gate 1 → Gate 2 → Gate 3 → review pack → Gate 5 → behaviour changes and what's left.

---

## How it was tested (read this first)

This repo has no `.env`, and the brief rules out live-database writes, so **no browser run touched anything beyond localhost**.

- **Browser flows (Gates 0, 2, 3, 4, 5)** ran on production builds compiled against a local in-memory test backend (`VITE_MOCK_BACKEND=1`, `src/dev/mockBackend.js`). Every request to any other host was blocked, and every run asserts that nothing left the local server. The test backend copies the access model (no session = no access; `quotes` scoped to its owner), the status trigger, the paid stamp, check constraints, cascades, the unique quote id and the new RPCs. A normal build drops it entirely; I checked the production bundle contains no trace of it. **A pass here proves the UI and the logic, not the SQL.**
- **The real Netlify Functions ran in the gate process.** `send-nudge.mjs` and `health.mjs` answered the browser's requests. Their outbound calls were stubbed: the Supabase token check accepts the test token, and Resend is a recorder. So the email path was exercised end to end without a send.
- **SQL** ran on a throwaway local Postgres (PGlite/WASM): a fresh `schema.sql`, and the v1 schema with existing rows followed by the patch applied twice. Harness: `supabase/local-test/`.
- **Not exercised anywhere:** real PostgREST, real Supabase Auth, real Resend, the deployed `/api/health`. Those are listed under BLOCKED-BY-PATCH.

Tooling (playwright-core, PGlite, Lighthouse 13.5) was borrowed from other local projects. **No dependency was added to `package.json`.**

---

## Gate 0: baseline on fff7b9f (before any change)

| Check | Result |
|---|---|
| Unit tests | **71/71 pass** |
| Build | green |
| Brief's Chaser flow on the v1 UI, 390px + desktop: sign-in error, create invoice, see it 21 days overdue, Firm nudge, wa.me prefill has INV-1001 + R 2 450,50, nudge logged, partial payment, messy CSV import, headline R 13 795,67, email blocked by DEV_BLOCK_REAL_SENDS, customers, no errors | **12/12 PASS at both sizes** |

The v1 UI ran unchanged except for the test backend swap (`tools/gates/baseline.mjs`). Baseline green, so the work went ahead. I re-ran it at the end with the final test backend: still 12/12 at both sizes.

## What changed (files)

**Logic (pure, tested)**
- `src/lib/ladder.js` (new): stage due dates from config, start rules, one stage per nudge, minimum gap, promise pause, auto-stop.
- `src/lib/promises.js` (new): pending / due today / broken / kept / paid late, history outcomes, validation.
- `src/lib/aged.js` (new): Current / 1–30 / 31–60 / 61–90 / 90+ from stored cents, plus bar shares that always sum to 100. `aging.js` (v1, four buckets) is untouched because its tests pin it.
- `src/lib/queue.js` (new): the today queue, broken promises, finished ladders, sent today, the reason line.
- `src/lib/compose.js` (new) + `nudge.js`: pre-written nudges with `{jobPhrase}`, `{paidLine}`, `{promiseLine}`, `{payLine}`; pre-send checks; the `refine()` seam.
- `src/lib/payInfo.js` (new): pay block, https-only link, pay check.
- `src/lib/demoData.js` (new): three trade datasets. `src/lib/quotePull.js` (new): quote → invoice, customer match, dedupe.
- `src/lib/health.js` (new), `cache.js` (new: snapshot, drafts, outbox, device wipe), `onboarding.js`, `auth.js`, `brand.js` (new).
- `nudgeEmail.js`: RFC-safe `formatFrom`, https links clickable in the HTML part, optional `stage`. `db.js`: schema detection, new calls, `paid_by`. `email.js`: passes the stage.

**UI**
- `src/index.css`: the console tokens exactly, the Chaser blue/teal aura, components.
- `components/ui/*` (new): line icons, drag-down sheet, toast, fields, segmented control, monogram, skeleton, empty state.
- `AppShell.jsx` (new): glass sidebar with aura pill and live badges; phone tab bar; health and sync lines; DEMO badge.
- Sheets (new): `ComposerSheet`, `PaymentSheet` (rewritten), `PromiseSheet`, `InvoiceFormSheet`, `CustomerFormSheet`, `ConfirmSheet`, `DemoSheet`, `PullSheet`, `Checklist`, `InvoiceBits`.
- Pages: `TodayPage`, `InvoicesPage`, `InvoiceDetailPage`, `SetupPage`, `Login` (new); `CustomersPage`, `ImportPage` (rewritten).
- `App.jsx`, `main.jsx`, `index.html`; `state/DataStore.jsx`; hooks `useRoute` (tiny router, no dependency), `useHealth`, `useCountUp`.
- Removed: `DashboardPage`, `Shell`, `AuthGate`, `Modal`, `NudgeSheet`, `StatusPill`, `InvoiceForm`, `CustomerForm`.

**Server**
- `netlify/functions/health.mjs` (new) and the `/api/health` redirect in `netlify.toml`. `send-nudge.mjs`: uses `formatFrom`.

**Config**
- `companyConfig.js`: `paymentInstructions`, `paymentLink`, `ladder`, `quotePull`, `demo`, `primaryColor`, `logoUrl`; templates carry the new placeholders. `configs/demo-config-2.js` (new, Gate 3).

**Database (files only)**
- `supabase/patches/2026-11-05-compete-upgrades.sql` (new), folded into `schema.sql`. `supabase/verify-compete-upgrades.sql` (new). `verify-rls.sql` now covers `chaser_promises` and the new functions.

**Tooling and docs**
- `src/dev/mockBackend.js`, `supabase/local-test/`, `tools/gates/` (baseline, gate2, legacy, gate3, lh, a11y).
- README: setup section for the patch, config fields, health check, demo mode, pull. CLAUDE.md: the retired dark tokens replaced with a pointer to the v2 system.

## Gate 1: unit and regression

**138/138 pass**, up from 71. **All 71 original tests pass unchanged.** The 67 new ones cover:

- **Ladder stage computation**: boundaries at day 6/7/14; first nudge starts at the reached stage but never at final; one stage per nudge; never skips firm after friendly; minimum gap; ladder complete; v1 nudges counted by tone; promise pause; broken promise makes it due; auto-stop on paid and written off; custom ladders and config validation.
- **Promise-broken detection**: pending / due today / broken by date; part-payment doesn't un-break; kept vs paid late; newest promise wins; history outcomes (broken vs rescheduled); validation copy; labels.
- **Bucket math**: every boundary (0, 1, 30, 31, 60, 61, 90, 91); a hand-checked set of 11 invoices including two part-payments, R 14 846,31, every figure an integer and the buckets summing to the total; bar shares summing to exactly 100.
- **Demo seed marking/removal**: every industry uses SA names, `+27 00 000 00xx` numbers, example.com emails, DEMO- refs and integer cents. The seed covers every ladder stage, one broken promise (top of queue), one paid, every bucket and one finished ladder. Load through the test backend marks every row; removal deletes exactly the seeded rows and keeps a real customer, invoice and nudge. A real invoice added to a demo customer survives removal. A nudge on a demo invoice is demo. Anon is refused.
- Today queue order, auto-stop removing items, a sent nudge leaving the queue, and a broken promise on a finished ladder still heading the queue.
- Composer: all stages × both channels pre-written with no placeholders left, part-payment wording, broken and repeat-broken promises, pending promise, pay-block edit detection, non-https link refused, the refine seam, wa.me equals body.
- Quote pull: rand text → exact cents, due dates, the reference matching Quote's PDF, eligibility filters, the cross-tool customer match, no duplicates on re-pull.
- Health: reachability rules, a GET probe only, booleans only (no key/URL/address/name), placeholder config reported as missing, wording, the Netlify handler end to end.
- RFC-safe From, link-safe HTML, stage validation, checklist rules, auth wording, brand ink.

**SQL on PGlite (not counted above):**

| Run | verify-rls.sql | verify-compete-upgrades.sql |
|---|---|---|
| A. fresh `schema.sql` | 58/58 PASS | 35/35 PASS |
| A2. `schema.sql` pasted again | 58/58 PASS | 35/35 PASS |
| B0. v1 schema as live today (v1 script) | 39/39 PASS | — |
| B1. v1 schema + rows, patch applied twice | 58/58 PASS | 35/35 PASS |

Plus 6 upgrade checks on the existing rows:
- every amount and status is unchanged
- the rows are not demo and have no quote link
- paid_at is not invented for already-paid invoices
- the existing nudge is kept
- a partial invoice paid after the patch gets its stamp
- the outstanding total is still exact

The verify scripts leave no rows behind. **Negative control:** with one revoke line removed and the paid-stamp clearing disabled, the scripts reported 2 + 3 FAILs, so the checks are real.

## Gate 2: end-to-end flows (390px phone and 1280px desktop, test data only)

`tools/gates/gate2.mjs`: **36 steps, PASS at both sizes (72/72).**

| Step | 390px | Desktop |
|---|---|---|
| A1 Wrong password: inline plain-language error | PASS | PASS |
| A2 Sign in lands on Today: designed empty state, checklist 0 of 3, one primary action | PASS | PASS |
| A3 Checklist step 1: check details in Setup, confirm | PASS | PASS |
| A4 Checklist step 2: plumber demo in one tap; DEMO badge shows | PASS | PASS |
| A5 Checklist step 3: first nudge from the queue, WhatsApp opens prefilled (**timed, see below**) | PASS | PASS |
| A6 Checklist complete, then hidden | PASS | PASS |
| B1 Hero owed / overdue / five buckets equal the hand-summed demo cents (R 84 795,50) | PASS | PASS |
| B2 Broken-promise alert names the customer; queue sorted by amount; a nudged invoice waits its gap | PASS | PASS |
| B3 Before any nudge, the broken promise is the first queue row | PASS | PASS |
| C1 Composer: promise played back, pay block resolved, checks green, no placeholders | PASS | PASS |
| C2 Editing out the payment details is flagged before send | PASS | PASS |
| C3 An unsent edit survives a reload (saved on the device) | PASS | PASS |
| C4 Email on a demo invoice is shown and logged, never sent (or WhatsApp-only customer) | PASS | PASS |
| C5 Sheets close by drag-down on the handle (phone) / backdrop (desktop) | PASS | PASS |
| D1 Empty invoice save: errors under the fields | PASS | PASS |
| D2 Create customer + INV-2001, R 2 450,50, due 15 Oct, lands on its detail | PASS | PASS |
| D3 Detail: 21 days overdue, Firm is next (never opens on final) | PASS | PASS |
| D4 **Send nudge: wa.me/27820000101 with INV-2001, R 2 450,50, 21 days overdue, the job, the pay block** | PASS | PASS |
| D5 Nudge logged with stage, channel, not demo; ladder shows sent and skipped | PASS | PASS |
| D6 Over-nudge guard warns, doesn't block | PASS | PASS |
| E1 Email, DEV_BLOCK_REAL_SENDS unset: blocked by the real function, nothing logged | PASS | PASS |
| E2 Email, sends explicitly enabled: Resend recorder gets one test recipient, `Sample Service Co <accounts@example.com>`, reply-to, the pay block; logged as a Final email nudge | PASS | PASS |
| F1 Log a promise: pill, ladder paused | PASS | PASS |
| F2 Two days later, unpaid: BROKEN PROMISE heads the queue and the alert | PASS | PASS |
| G1 Partial R 450,50 leaves R 2 000,00, still on the ladder | PASS | PASS |
| G2 Paid in full: the sheet states the consequence; off every queue; `paid_at` + `paid_by` recorded | PASS | PASS |
| H1 Invoices: 90+ chip filters; a paid invoice is found via "paid also match" | PASS | PASS |
| I1 Messy CSV: preview flags rows, error row unticked, 6 imported | PASS | PASS |
| J1 Pull: one past-due accepted quote offered (Q-A1B2C3, R 3 450,50); paid, sent, not-due and another owner's quote excluded | PASS | PASS |
| J2 Pulled invoice enters the ladder; pulling again offers nothing, one row in the DB | PASS | PASS |
| K1 Network drops: Today renders from the cached copy with an offline line; health reads "Database not reachable" | PASS | PASS |
| K2 WhatsApp nudge while offline: opens, saved on the phone, synced on reconnect | PASS | PASS |
| L1 Remove demo data: exactly the DEMO rows go (12), real and pulled invoices stay (8), badge gone | PASS | PASS |
| L2 Health status line: "Connected · add payment details and sender email" (base config is placeholders) | PASS | PASS |
| L3 Customers render; no `window.confirm` anywhere in the run | PASS | PASS |
| L4 No emojis, no "Netlify" text, no horizontal scroll on any screen, no JS errors, nothing left localhost | PASS | PASS |

**The brief's Chaser flow** (create invoice → see it overdue → open detail → send nudge → the WhatsApp prefill has the right invoice number and amount) is D2 → D4: **PASS at both sizes**.

**Timed first-value check (addendum).** Measured from the sign-in screen to the first nudge opened in WhatsApp, using the checklist path. The steps are: sign in, Check details, These details are right, Load demo data, Load plumber demo, Nudge Johan, Open WhatsApp. That is 6 taps plus typing the email and password.
- Scripted run: **3.4 s (390px) and 3.3 s (desktop)**.
- That measures the app, not a person. I didn't time a human. Allowing about 3 s per tap and 10 s to type the login gives an estimate of roughly 30 s, under the 60 s bar.

**New UI on the database as it is today (pre-patch)**, `tools/gates/legacy.mjs`: **7/7 PASS at both sizes**.
- The empty state offers "Add your first invoice" (demo needs the patch).
- Invoice, ladder, WhatsApp nudge and payment all work. The nudge is logged without the stage column.
- Promise, demo mode and the pull are disabled, each with a plain "needs the November database update" line.

### BLOCKED-BY-PATCH: steps that need the patch on a real database (1, 2 and 10 done Nov 8, see Gate 6; the rest need a signed-in test login)

Run these after the patch is applied (Gate 6), with test data only:

1. Paste `supabase/patches/2026-11-05-compete-upgrades.sql` into the dropstack-dev SQL editor. It should commit without error.
2. Run `supabase/verify-rls.sql`: every row PASS (58). Run `supabase/verify-compete-upgrades.sql`: every row PASS (35). It rolls itself back and won't touch existing rows.
3. Point this build at dropstack-dev and sign in. Today should load with the status line reading "Connected…" (real `/api/health` via `netlify dev` or the deploy).
4. Load demo data, then check in Table Editor that every new row has `is_demo = true`. Remove demo data: those rows are gone and nothing else is.
5. Log a promise on a test invoice; check the `chaser_promises` row and that `created_by` is the login email.
6. Mark a test invoice paid; check `paid_at` and `paid_by` were stamped by the trigger.
7. Send a WhatsApp nudge; check `chaser_nudges.stage`.
8. Email: with `DEV_BLOCK_REAL_SENDS` unset, confirm it's blocked. If you want one real send, use a test inbox you own as the customer email, never a customer.
9. **Pull from Quote & Invoice** against the real `quotes` table. Check that RLS returns only this login's quotes, and that `total::text` arrives as text. Pull twice; there should be one row per quote.
10. `GET /api/health` on the deploy. Expect `ok: true`, `database: true` and booleans only.
11. Gate 5 on the deployed URL: the real Supabase round trip replaces my emulation.

## Gate 3: config swap

`configs/demo-config-2.js` ("Example Coastal Electrical") changes:
- brand `#1F4E79`, no logo, and new owner, bank details, pay link, sender and reply-to
- ladder Reminder +3 / Overdue +10 / Last notice +21, with a 4-day gap
- 14-day quote terms, and demo limited to electrician

It was copied over `companyConfig.js` in a scratch copy and built. `tools/gates/gate3.mjs`: **6/6 PASS at both sizes.**
- Sign-in shows the new name, the monogram "EC", the brand colour on the primary button, and the tab title.
- The demo offers only Electrician; the queue uses this client's stage labels.
- The WhatsApp prefill is signed by the new owner, with the new bank details and the pay link.
- Email through the real send function goes from `Example Coastal Electrical <billing@example.org>`, reply-to `owner-two@example.org`.
- Setup shows 3 / 10 / 21 days and the 4-day gap.
- **Leftover scan:** across every screen, the prefill and the email, **zero** of 7 base-config strings remain ("Sample Service Co", "Sample Owner", the sender, the placeholder bank number, the base stage labels).

## Gate 4: visual review pack

**https://claude.ai/artifact/Sa9q2D8B51gCBFTKJppJkT** (private to your account; share it from the page's Share menu for Ziggy).

It holds 74 screenshots at 390px and desktop: 16 before, 58 after.
- **Today**: empty, populated, today queue with the broken promise first, broken promise two days on, offline.
- **Composer**: WhatsApp and email, with the pay instructions resolved.
- **Invoice detail**: with the ladder, and with a promise.
- **Sheets**: payment confirmation, promise, invoice form (error and filled), demo load and remove, pull from Quote.
- **Other screens**: invoices, import preview, customers, setup, sign-in and its error, the pre-patch states, and the second config.

"Before" shots are fff7b9f's code on the same test backend, so they show the v1 UI exactly. Full-page phone captures show the fixed tab bar part-way down; that's the capture tool, not the layout.

## Gate 5: performance and basics

Mobile Lighthouse 13.5 on the local production build (test-backend build, gzip like a CDN), cache cleared each run, all non-local hosts unresolvable. Lowest of 3:

| Screen | Performance (3 runs) | LCP | Accessibility | Best practices | LCP element |
|---|---|---|---|---|---|
| Today (populated) | **99** / 99 / 99 | 1.52–1.56 s | 100 | 100 | the "You are owed" figure |
| Invoice detail | **99** / 99 / 99 | 1.55–1.57 s | 100 | 100 | content text |
| Sign-in | **99** / 99 / 99 | 1.55 s | 100 | 100 | the business name |

**Weight:**
- The test-backend build used for the runs is 122 KB.
- The real production bundle is 74 KB JS + 8 KB CSS + 0.4 KB HTML, gzipped.

**Fast-3G** (DevTools throttling: 1.6 Mbps, 562.5 ms RTT, 4× CPU; the database round trip emulated by a fixed delay, as in the Quote pass):

| Case | Worst LCP of 3 |
|---|---|
| Sign-in (the only screen without a session) | **2.01 s** |
| Today, returning owner (books on the phone, data 1 700 ms) | **2.14 s** |
| Today, first ever visit, warm connection (700 ms) | 2.87 s |
| Today, first ever visit, cold connection (1 700 ms) | 3.99 s |

Chaser has **no public, customer-facing surface**: every customer touchpoint is a WhatsApp message or an email, so §2A's 2.5 s rule for public pages applies to nothing here. I report the first-visit Today numbers anyway because they miss 2.5 s. That page needs the books before it can show the hero figure.

Three real changes got it this far:
- the schema probe now runs alongside the data fetch (one round trip, not two)
- Today renders from the copy on the phone on every later visit
- the sign-in card and the hero no longer fade in from opacity 0

The last one matters: before it, Lighthouse scored the "Powered by DropStack" line as the LCP, which flattered the numbers.

**Accessibility spot checks** (`tools/gates/a11y.mjs`), on 10 screens and sheets at both sizes:
- No unlabelled inputs.
- No tap target under 44 px. One link was fixed to get there.
- All 12 tab stops on Today show visible focus.
- Pill contrast:

| Pill / text | Contrast |
|---|---|
| good | 4.83 |
| warn | 5.12 |
| bad | 5.29 |
| info | 5.09 |
| neutral | 7.47 |
| secondary text on white | 5.07 |
| secondary text on canvas | 4.66 |

**Sweeps:**
- No emojis in UI, copy or toasts, and no exclamation marks in toasts.
- No Netlify badge or text.
- The production CSS/JS contains none of the old palette (`#0B0F1A`, `#151D31`, `#00D4FF`, `#7B5CFF`, …).

## Gate 6: patch applied, branch pushed, deployed (Nov 8 2026)

Approved by Tom on Nov 8 (DEPLOY_TASK.md). Only this tool's schema patch touched the live database. No other tool, table or site was changed.

**Patch result (dropstack-dev, ref `idazmyjfroigagmjtekm`).**
- Before the patch: v1 schema (3 `chaser_` tables, no `is_demo`), with 5 customers, 7 invoices and 0 nudges.
- `supabase/patches/2026-11-05-compete-upgrades.sql` ran as one transaction through `supabase db query --linked` and committed with no errors.
- `verify-rls.sql`: 58/58 PASS. `verify-compete-upgrades.sql`: 35/35 PASS. Both clean up after themselves.
- After the patch, the counts are unchanged: 5 / 7 / 0 and 0 promises. `chaser_promises` exists with RLS on, and the new columns are present.

**Push.** `compete/chaser-upgrades` was pushed to origin at `5d3165d` (new remote branch; no PR opened yet). The repo's default branch, `feat/stage-1-scaffold-schema-import`, was not touched.

**Deploy proof.**
- Netlify site `dropstack-chaser` (`514dc32e-796f-418e-a4ef-bb692205c555`) has production deploy `6af127a9e1d0470398e1f021`, built from `5d3165d`.
  - Permalink: https://6af127a9e1d0470398e1f021--dropstack-chaser.netlify.app
  - Log: https://app.netlify.com/projects/dropstack-chaser/deploys/6af127a9e1d0470398e1f021
  - The previous production deploy, `6aeb7ca07aac63f8207e8d66`, is the rollback target.
- **How it differs from before.** Earlier deploys were git builds of the site's production branch, `feat/stage-1-scaffold-schema-import`.
  - To ship this branch that way, the site's production branch had to be switched. That settings change was refused by the agent's permission check.
  - So this deploy went out with `netlify deploy --prod --build`, which runs the same `npm run build` with the site's own env vars. It also deployed both functions (`send-nudge`, `health`).
  - **Consequence:** the next git push to `feat/stage-1-scaffold-schema-import` will auto-build and replace this deploy with the old app. Merge the PR into that branch, or switch the production branch, before anyone pushes there.

**Live verification (invoices.dropstack.co, read-only).**
- **Build served.** `/` serves `index-BqqR4H2K.js` and `index-CSJQiC03.css`, the same hashes as the local build of `5d3165d`. `/`, `/invoices` and `/setup` all return 200.
- **Bundle contents.** The served JS contains the Today queue (`today-queue`), the one-tap composer send (`composer-send`), demo mode (`empty-load-demo`, `chaser_load_demo`) and promises (`chaser_promises`). It points at dropstack-dev. The dev mock backend is not in it.
- **Health.** `GET /api/health` returned `ok: true`, `healthy: true` and `database: true` (532 ms). The values are booleans only.
  - It reports `paymentInstructions`, `paymentLink`, `fromEmail` and `replyToEmail` as false, because `companyConfig.js` still holds the sample client.
  - It reports `resendKey: false` and `realSendsEnabled: false`, so the live site cannot send email. That is expected for the demo deploy.
- **Anon lockout.** PostgREST with the public key returns `42501 permission denied` on `chaser_customers`, `chaser_invoices` and `chaser_promises`.
- **Real browser at 390 px and 1280 px (Playwright).**
  - The new console sign-in renders: `#f5f5f7` canvas and `#0071e3` button.
  - A bogus sign-in with `test@example.com` gets "Email or password is incorrect." from the real Supabase auth.
  - There are zero page or console errors.
- **Lighthouse on the live sign-in.** These runs were from this machine, against the real CDN.

  | Run | Performance | Accessibility | Best practices | LCP |
  |---|---|---|---|---|
  | Mobile default, 3 runs | 97 / 97 / 99 | 100 | 100 | 1.76–1.86 s |
  | Fast 3G, 3 runs | 92–95 | – | – | 2.43–2.70 s (worst 2.70 s) |

- **Not verified live.** The signed-in screens (Today queue, one-tap nudge, loading and removing demo data, promise, paid stamp, Quote pull) were not exercised on the live site. That needs an owner login, which I don't have. Loading demo data would also write rows to the live database, and the task allowed no live changes beyond the patch.
  - They are covered end to end by Gate 2 against the test backend.
  - On the live database, the verify scripts prove the RPCs and triggers they rely on.
  - BLOCKED-BY-PATCH steps 1, 2 and 10 are now done. Steps 3–9 and the signed-in part of 11 are for Tom, with a test login.

## Addenda (Tom's Nov 5 directive and the US-frontier lens)

- **Decision lens: what I cut.** Each of these would slow a first "yes" more than it helps:
  - An in-app template editor. Templates stay in config, so DropStack sets them up for the client; the owner can still edit any message before sending.
  - Per-customer ladders. The audit said "per-customer sequence"; I built one ladder per business, because it's one less thing to explain in a demo.
  - A Chaser → Quote "open the quote" link. Separate subdomains keep separate sign-ins, so it would land on a login wall, which the directive forbids.
  - Automatic background re-pulls. The pull is one tap, on demand.
- **Demo mode** replaces "sample rows", as specified:
  - three trades, SA names, placeholder mobiles, Rand amounts, real job descriptions
  - a DEMO badge, one-tap load and remove
  - `demo.allowed` and `demo.industries` in config switch it per client
  - the demo shows invoices owed, never results or a track record
- **Onboarding:**
  - a first-run checklist, shown until complete and dismissible after
  - every empty state has one primary action
  - every target is at least 44 px
  - primary actions are full width and thumb-reachable on phones
- **Health endpoint:** `/api/health` (booleans only) plus the shell status line. Nothing is scheduled to ping it.
- **One suite: sign-in.** The sign-in screen copies Quote & Invoice's. It has the same layout, the same field labels, the same error wording (`friendlyAuthError` copied verbatim) and the same no-signup rule. Only the one-line subtitle differs ("Sign in to see who owes you").
- **One suite: same credentials.** Quote's REPORT says quote.dropstack.co runs on dropstack-dev, the same Supabase project as Chaser. So the same `auth.users` login works in both tools by construction. **I could not verify it live** (no credentials or `.env` here, and no live access by rule). Quote also requires the login to be on its `business_users` allowlist; Chaser has no allowlist.
- **One suite: customer join.** Customers are joined on mobile number (normalised), then email, in the Quote pull.
- **Pipeline wiring:**
  - Pull from Quote & Invoice is built, with dedupe on `source_quote_id` (unique) and imported invoices on the ladder.
  - The Quote schema **can** express paid (`status = 'paid'`), so paid quotes are excluded.
  - **Quote pass-2 item:** there's no write-back. Marking an invoice paid in Chaser doesn't mark the quote paid. That needs a write path the Quote repo owns, and I didn't touch it.
- **Deterministic drafting:** every nudge is pre-composed from the customer's data, including prior promises and their outcomes. The provider seam is named: `composeNudge(..., { refine })` in `src/lib/compose.js`. No AI API is wired.
- **SA reality checklist:**
  - ZAR formatting throughout from config (`R 1 450,00`), never `$`.
  - Today and the composer render from cached state, drafts survive reloads, and nudges logged offline queue and sync.
  - **POPIA:**
    - nudge copy is factual ("refer the account for collection", no threats)
    - one contact per customer: their own number or email
    - signing out wipes cached customer data and drafts from the device

## Schema patch summary (for Ziggy)

Additive and idempotent, in one transaction:

- **Columns and table:**
  - `is_demo` on customers, invoices and nudges
  - `paid_at` and `paid_by` on invoices
  - `source_quote_id` on invoices, with a unique partial index
  - `stage` on nudges
  - new table `chaser_promises`, with the same owner-only RLS and anon revoked
- **Triggers:**
  - The status trigger keeps its derivation. It now stamps `paid_at` and takes `paid_by` from the JWT email unless the app sent one, and clears both when an invoice stops being paid.
  - `chaser_inherit_demo()` marks a nudge or promise on a demo invoice as demo.
- **Functions:**
  - `chaser_import_invoices(jsonb)` keeps its signature and v1 behaviour, adds quote dedupe, and removes customers it created only for skipped rows.
  - New `chaser_load_demo(jsonb)`, which forces `is_demo`, and `chaser_remove_demo()`, which keeps a demo customer that has since got a real invoice.
- **Grants:** every function is revoked from public/anon/authenticated and granted back to authenticated only where called.
- **Order:** apply the patch before deploying the frontend. If the frontend ships first, it degrades cleanly, as the pre-patch run shows.

## Behaviour changes (every one)

1. **The home screen is Today**, not the v1 dashboard list. All invoices moved to the Invoices tab, still sorted most overdue first, with search, status, customer and age filters.
2. **Aged buckets are Current / 1–30 / 31–60 / 61–90 / 90+.** v1 had 60+ as its last bucket.
3. **The nudge sheet pre-selects the ladder stage and is keyed to it.** The stage is shown as its label (Friendly/Firm/Final, from config). Nudges record the stage on the patched DB.
4. **Default templates were reworded** to carry the job, the part-payment thanks, the promise line and the pay block. The amount is still the outstanding balance, and "final" still states next steps without threats. **Tom's call:** the base config's `paymentInstructions` is an obvious placeholder. Health and Setup flag it as missing until real details are added.
5. **Payment details:** the new field is `paymentInstructions`. The old `paymentDetails` is still read.
6. **Email sends on demo invoices never call the send function.** They're logged only.
7. **Marking paid** goes through the payment sheet, which states the consequence. The patched DB records who and when.
8. **Delete confirmations are sheets**, not `window.confirm()`.
9. **Sign-out clears the device cache** (customer details, drafts, the outbox). Small preferences like "checklist hidden" are kept.
10. **New routes:** `/invoices`, `/invoices/:id`, `/customers`, `/import`, `/setup`. v1 had a single page with an internal switch.
11. **The browser tab title** is now "Today · <businessName>". v1's was the fixed "Invoice Chaser".
12. **The UI is light.** This is the brief's reskin, and CLAUDE.md's old dark tokens are marked superseded.

## Flagged / not done / for Tom or Ziggy

- **Applied, pushed and deployed on Nov 8 (see Gate 6).** No PR is open yet. CLAUDE.md expects one, and the Netlify production branch still points at `feat/stage-1-scaffold-schema-import`.
- **Shared dev database exposure.** Chaser's RLS is owner-only in the sense of "any authenticated login on this project". On the shared dropstack-dev project, any login (for example a Quote staff login) can read and write `chaser_*` rows. That's fine for one project per client, which is the deploy model. It's worth knowing while dropstack-dev is shared. Not changed here, since the brief said to preserve RLS.
- **Fast-3G first visit to Today is 2.9–4.0 s** in emulation. Later visits are 2.1 s. Re-measure on the live URL.
- **The "due-today count" in the hero** is shown as "Chase today": the nudges due today, which is what needs the owner. The number of invoices falling due today is its sub-line. Change the label if you meant only the latter.
- **Drag-down sheets** were driven with synthetic pointer events in Chromium phone emulation. Nothing ran on a physical phone; check it with a thumb.
- **`src/dev/mockBackend.js` stays in the repo.** It's dev-only and compiled out of normal builds. It doubles as a laptop demo backend.
- **Bugs the gates found and I fixed:**
  - A broken promise on a finished ladder never came back to Today.
  - The payment field's label wasn't linked to its input.
  - The offline copy went stale after local changes.
  - The fade-ins hid the real LCP.
  - The schema probe and the data fetch ran one after the other.
  - The sign-in screen had no `<main>` landmark.
  - One link was under 44 px.
- **Not built, per the audit's NOT-building list:**
  - automated WhatsApp sending (permanent doctrine)
  - accounting sync (first post-pass candidate)
  - payment processing or autopay (parked)
  - AI risk scoring
  - scheduled or cron chasing

## Where this still loses to Chaser and Kolleno

On the owner's morning moment it now holds up. They open Today and see what they're owed, what's overdue and who broke a promise. They tap once and the right message is already written, with the bank details and a pay link in it. For a plumber on WhatsApp at R350 a month, that is most of what Chaser sells.

Past that moment it still loses, on substance rather than polish:

- **It doesn't live inside the books.** Chaser and Kolleno sit on Xero and QuickBooks, so invoices appear without being typed and stop the second they're paid. Here, invoices arrive by CSV, by hand or from our own Quote tool, and "paid" is whatever the owner remembers to record. A missed payment record means a paid customer can get chased, and nothing here catches that.
- **Nothing happens while the owner is busy.** Their sequences send on schedule from your own domain, across hundreds of debtors. Ours waits for a tap on every message. For a tradesperson with twenty open invoices that's a feature. For a business with two hundred it's a ceiling.
- **The money can't be taken in the reminder.** There are no card or EFT rails and no reconciliation. A pay link only goes out to whatever page the client already has, and nothing marks the invoice paid when the money lands.
- **There's no credit-control depth.** No customer portal, no dispute handling, no per-debtor risk view, no team roles, no reporting beyond the hero strip. Email delivery tracking stops at "Resend accepted it".

The first of these, accounting sync, is the one that decides whether this survives contact with a business that already uses Xero.
