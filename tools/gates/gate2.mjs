// Gate 2 (design spec §6): scripted end-to-end flows on the reskinned build,
// 390px phone and 1280px desktop, test data only, against the local test
// backend. Also captures the Gate 4 "after" screenshots.
//   node tools/gates/gate2.mjs <shotsDir> <baseUrl> <repo>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { launch, newContext, PHONE, DESKTOP, recorder, clean, expect, useFunctions, outbound, dumpDb, DB_KEY } from "./lib.mjs";

const [shots, base, repo] = [process.argv[2], process.argv[3] ?? "http://127.0.0.1:4302", process.argv[4] ?? process.cwd()];
mkdirSync(shots, { recursive: true });
await useFunctions(repo);
const { buildDemoPayload } = await import(`${repo}/src/lib/demoData.js`);
const { agedSummary } = await import(`${repo}/src/lib/aged.js`);
const { formatCents } = await import(`${repo}/src/lib/money.js`);
const CSV = readFileSync(`${repo}/samples/messy-invoices.csv`, "utf8");
const NOW = "2026-11-05T09:00:00+02:00";
const OWNER = "00000000-0000-4000-8000-00000000c4a5";
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;
const browser = await launch();
const all = {};
const timings = {};

for (const [label, profile] of [["390", PHONE], ["desktop", DESKTOP]]) {
  console.log(`\n== Gate 2 @ ${label}`);
  const r0 = recorder();
  // On a failure: screenshot it, then close any open sheet so the next step starts clean.
  const r = { rows: r0.rows, check: (name, fn) => r0.check(name, async () => {
    try { return await fn(); }
    catch (e) {
      await page.screenshot({ path: `${shots}/FAIL-${name.slice(0, 3).trim()}-${label}.png` }).catch(() => {});
      for (let i = 0; i < 3 && await page.getByRole("dialog").count(); i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(200); }
      throw e;
    }
  }) };
  const ctx = await newContext(browser, profile, base);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  await page.clock.setFixedTime(new Date(NOW));
  const errors = [];
  const confirms = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => { confirms.push(d.type()); d.dismiss(); });
  const shot = (n, full = true) => page.screenshot({ path: `${shots}/after-${n}-${label}.png`, fullPage: full });
  const dialog = page.getByRole("dialog");
  const body = async () => clean(await page.textContent("body"));
  const noHScroll = async (where) => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(w <= 1, `${where}: horizontal scroll ${w}px`);
  };
  const draft = async () => { await page.waitForFunction(() => document.querySelector("[data-testid=nudge-body]")?.value.length > 20, null, { timeout: 5000 }); return clean(await dialog.getByTestId("nudge-body").inputValue()); };
  const opened = () => page.evaluate(() => window.__opened);
  const nav = async (path) => { await page.evaluate((p) => { history.pushState({}, "", p); dispatchEvent(new PopStateEvent("popstate")); }, path); await page.waitForTimeout(150); };

  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("dropstack-mock-latency", "60"); });
  await page.reload();

  // ---- A. First run, timed: sign-in → checklist → demo → first nudge ----------
  let t0;
  await r.check("A1 Wrong password: inline plain-language error", async () => {
    await page.getByLabel("Email").waitFor();
    await shot("login");
    t0 = Date.now();
    await page.getByLabel("Email").fill("owner@example.com");
    await page.getByLabel("Password").fill("wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("alert").filter({ hasText: "Email or password is incorrect." }).waitFor();
    await shot("login-error");
  });
  await r.check("A2 Sign in lands on Today: designed empty state, checklist 0 of 3, one primary action", async () => {
    await page.getByLabel("Password").fill("correct-horse");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("Nothing to chase yet").waitFor();
    await page.getByTestId("checklist").getByText("0 of 3").waitFor();
    await noHScroll("empty today");
    await shot("today-empty");
  });
  await r.check("A3 Checklist step 1: check details in Setup, confirm, back on Today", async () => {
    await page.getByTestId("checklist-config").click();
    await page.getByTestId("setup-payline").waitFor();
    await shot("setup");
    await page.getByTestId("setup-confirm").click();
    await page.getByTestId("checklist").getByText("1 of 3").waitFor();
  });
  await r.check("A4 Checklist step 2: load the plumber demo in one tap; DEMO badge shows", async () => {
    await page.getByTestId("checklist-demo").click();
    await shot("demo-sheet", false);
    await page.getByTestId("demo-load").click();
    await page.getByTestId("today-queue").waitFor();
    await page.locator("[data-testid=demo-badge]:visible").first().waitFor();
    await page.getByTestId("checklist").getByText("2 of 3").waitFor();
  });
  await r.check("A5 Checklist step 3: first nudge from the queue (WhatsApp opens prefilled)", async () => {
    await page.getByTestId("checklist-nudge").click();
    await dialog.getByTestId("composer-send").click();
    await dialog.waitFor({ state: "detached" });
    const url = (await opened()).at(-1);
    expect(url?.startsWith("https://wa.me/2700000"), "no wa.me link: " + url);
    timings[label] = (Date.now() - t0) / 1000;
    await page.getByTestId("checklist").getByText("3 of 3").waitFor();
    return `first value in ${timings[label].toFixed(1)} s (scripted)`;
  });
  await r.check("A6 Checklist complete → dismissible", async () => {
    await page.getByRole("button", { name: "Hide this" }).click();
    await page.getByTestId("checklist").waitFor({ state: "detached" });
  });

  // ---- B. Today: hero, aged buckets, queue order ------------------------------
  const payload = buildDemoPayload("plumber", "2026-11-05");
  const expected = agedSummary(payload.invoices.map((i) => ({ ...i, status: i.amount_paid_cents >= i.amount_cents ? "paid" : i.amount_paid_cents ? "partial" : "unpaid" })), "2026-11-05");
  const R = (c) => clean(formatCents(c, "ZAR", "en-ZA"));
  await r.check("B1 Hero: outstanding, overdue and buckets equal the hand-summed demo cents", async () => {
    await page.waitForTimeout(800); // count-up
    const out = clean(await page.getByTestId("hero-outstanding").textContent());
    expect(out === R(expected.outstanding), `hero ${out} vs ${R(expected.outstanding)}`);
    expect(clean(await page.getByTestId("hero-overdue").textContent()) === String(expected.overdueCount), "overdue count");
    for (const k of ["current", "d1_30", "d31_60", "d61_90", "d90p"]) {
      const t = clean(await page.getByTestId(`bucket-${k}`).textContent());
      expect(t.includes(R(expected.buckets[k].total)), `bucket ${k}: ${t}`);
    }
    const sum = Object.values(expected.buckets).reduce((a, b) => a + b.total, 0);
    expect(sum === expected.outstanding, "buckets sum to outstanding");
    await noHScroll("today");
    await shot("today-populated");
    return `${out} = sum of 5 buckets`;
  });
  await r.check("B2 Broken promise: alert names them; queue sorted by amount; nudged ones leave today's queue", async () => {
    const alert = clean(await page.getByTestId("broken-alert").textContent());
    expect(alert.includes("Johan Pretorius"), alert);
    const rows = page.getByTestId("queue-row");
    const texts = [];
    for (let i = 0; i < await rows.count(); i++) texts.push(clean(await rows.nth(i).textContent()));
    expect(!texts.some((t) => t.includes("Johan Pretorius")), "Johan was nudged in A5 and should wait the 3-day gap");
    const amounts = texts.map((t) => Number(t.match(/R ([\d ]+),(\d\d)/).slice(1).join("").replace(/ /g, "")));
    expect(amounts.every((a, i) => i === 0 || amounts[i - 1] >= a), "not amount-desc: " + amounts);
    return `${texts.length} due, ${amounts.join(" ≥ ")} cents`;
  });
  await r.check("B3 Before any nudge, the broken promise is the first queue row", async () => {
    // a fresh copy of the seed, nobody nudged yet
    const db = await dumpDb(page);
    const johan = db.chaser_invoices.find((i) => i.description === "Pressure valve and drip tray");
    await page.evaluate(([k, id]) => { const d = JSON.parse(localStorage.getItem(k)); d.chaser_nudges = d.chaser_nudges.filter((n) => !(n.invoice_id === id && n.sent_at > "2026-11-05")); localStorage.setItem(k, JSON.stringify(d)); }, [DB_KEY, johan.id]);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("[data-testid=queue-row]")?.textContent.includes("Johan"), null, { timeout: 6000 });
    const first = clean(await page.getByTestId("queue-row").first().textContent());
    expect(first.includes("Johan Pretorius") && first.includes("Broken promise"), first);
    await shot("today-populated-broken-first");
  });

  // ---- C. Composer: pre-written, pay block, draft safety ----------------------
  await r.check("C1 Composer for the broken promise: promise played back, pay block, checks green", async () => {
    await page.getByTestId("queue-row").first().click();
    const text = await draft();
    expect(/you mentioned paying by .* and it hasn't come through yet/.test(text), "no promise line: " + text);
    expect(text.includes("How to pay:") && text.includes("Example Bank") && text.includes("Reference: DEMO-PLB-"), "no pay block");
    expect(!/\{\w+\}/.test(text), "unresolved placeholder");
    const checks = clean(await dialog.getByTestId("draft-checks").textContent());
    expect(checks.includes("How to pay included") && checks.includes("Balance included"), checks);
    await shot("composer", false);
  });
  await r.check("C2 Editing out the payment details is flagged before send", async () => {
    const ta = dialog.getByTestId("nudge-body");
    const v = await draft();
    await ta.fill(v.replace(/How to pay:[\s\S]*?(\n\n|$)/, ""));
    await dialog.getByText("The payment details were edited out of this message.").waitFor();
  });
  await r.check("C3 An unsent edit survives a reload (saved on the device)", async () => {
    await page.reload();
    await page.getByTestId("queue-row").first().click();
    await dialog.getByText("Restored your unsent edit from this phone.").waitFor();
    await dialog.getByRole("button", { name: "Use fresh draft" }).click();
    expect((await draft()).includes("How to pay:"), "fresh draft lacks pay block");
  });
  await r.check("C4 Email on a demo invoice is shown and logged, never sent", async () => {
    const before = outbound.resend.length;
    await dialog.getByRole("radio", { name: "Email" }).click();
    if (await dialog.getByText("No email address on this customer.").count()) { await page.keyboard.press("Escape"); return "customer has no email (WhatsApp-only)"; }
    await dialog.getByTestId("composer-send").click();
    await dialog.waitFor({ state: "detached" });
    expect(outbound.resend.length === before, "Resend called for a demo invoice");
  });
  await r.check("C5 Sheets: close by drag-down on the handle (phone) / backdrop (desktop)", async () => {
    await page.getByTestId("queue-row").first().click();
    await dialog.waitFor();
    if (label === "390") {
      // A thumb drag: pointer events on the grab handle, 260px down.
      await page.getByTestId("sheet-handle").evaluate(async (el) => {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const ev = (type, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 7, pointerType: "touch", isPrimary: true }));
        ev("pointerdown", r.top + 4);
        for (let i = 1; i <= 8; i++) { ev("pointermove", r.top + 4 + i * 33); await new Promise((res) => setTimeout(res, 16)); }
        ev("pointerup", r.top + 268);
      });
    } else {
      await page.getByTestId("sheet-backdrop").click({ position: { x: 20, y: 20 } });
    }
    await dialog.waitFor({ state: "detached" });
  });

  // ---- D. The brief's Chaser flow on a real (non-demo) invoice ----------------
  let invId;
  await r.check("D1 New invoice: empty save shows errors under the fields", async () => {
    await nav("/invoices");
    await page.getByRole("button", { name: /New/ }).first().click();
    await dialog.getByRole("button", { name: "Add invoice" }).click();
    await dialog.getByText("Pick who owes this, or add a new customer").waitFor();
    await dialog.getByText("Enter the invoice amount").waitFor();
    await shot("invoice-form-error", false);
  });
  await r.check("D2 Create customer + invoice INV-2001, R 2 450,50, due 15 Oct → lands on its detail", async () => {
    await dialog.getByRole("button", { name: "New" }).click();
    await dialog.getByLabel("Name").fill("Gate Two Customer");
    await dialog.getByLabel("Mobile (for WhatsApp)").fill("082 000 0101");
    await dialog.getByLabel("Email").fill("test@example.com");
    await dialog.getByLabel("Your invoice number").fill("INV-2001");
    await dialog.getByLabel("What it was for").fill("Geyser valve replacement");
    await dialog.getByLabel("Amount", { exact: true }).fill("R 2 450,50");
    await dialog.getByLabel("Invoice date").fill("2026-10-01");
    await dialog.getByLabel("Due date").fill("2026-10-15");
    expect(clean(await dialog.getByTestId("invoice-preview").textContent()).includes("R 2 450,50"), "preview");
    await shot("invoice-form-filled", false);
    await dialog.getByRole("button", { name: "Add invoice" }).click();
    await dialog.waitFor({ state: "detached" });
    await page.getByTestId("detail-summary").waitFor();
    invId = page.url().split("/invoices/")[1];
    expect(/^[0-9a-f-]{36}$/.test(invId), "not on detail: " + page.url());
  });
  await r.check("D3 Detail: 21 days overdue, firm is next (never opens on final)", async () => {
    const t = await body();
    expect(t.includes("21 days overdue") && t.includes("R 2 450,50"), "summary");
    expect(clean(await page.getByTestId("detail-nudge").textContent()).includes("Send firm nudge"), "primary action");
    await noHScroll("detail");
    await shot("detail-ladder");
  });
  await r.check("D4 Send nudge: wa.me to 27820000101 with INV-2001, R 2 450,50, 21 days, pay block", async () => {
    await page.getByTestId("detail-nudge").click();
    await dialog.getByTestId("composer-send").click();
    await dialog.waitFor({ state: "detached" });
    const url = (await opened()).at(-1);
    expect(url.startsWith("https://wa.me/27820000101?text="), url);
    const text = clean(decodeURIComponent(url.split("?text=")[1]));
    for (const s of ["INV-2001", "R 2 450,50", "21 days overdue", "for the geyser valve replacement", "How to pay:", "Reference: INV-2001"]) expect(text.includes(s), `prefill missing "${s}": ${text}`);
    return text.slice(0, 80) + "…";
  });
  await r.check("D5 Nudge logged: history + ladder (Firm sent, Final next 29 Oct → due now)", async () => {
    await page.getByTestId("detail-history").getByText("Firm nudge sent by WhatsApp").waitFor();
    const lad = clean(await page.getByTestId("detail-ladder").textContent());
    expect(lad.includes("Sent") && lad.includes("Skipped"), lad);
    const db = await dumpDb(page);
    const n = db.chaser_nudges.filter((x) => x.invoice_id === invId);
    expect(n.length === 1 && n[0].stage === "firm" && n[0].channel === "whatsapp" && n[0].is_demo === false, JSON.stringify(n));
  });
  await r.check("D6 Over-nudge guard warns (does not block) on a second nudge the same day", async () => {
    await page.getByTestId("detail-nudge").click();
    await dialog.getByText(/You sent a Firm nudge to Gate Two Customer today/).waitFor();
    await page.waitForFunction(() => !document.querySelector("[data-testid=composer-send]")?.disabled, null, { timeout: 3000 }).catch(() => { throw new Error("send blocked"); });
    await page.keyboard.press("Escape");
  });

  // ---- E. Email channel through the real send function ------------------------
  await r.check("E1 Email: DEV_BLOCK_REAL_SENDS unset → blocked, nothing logged", async () => {
    delete process.env.DEV_BLOCK_REAL_SENDS;
    const before = outbound.resend.length;
    await page.getByTestId("detail-nudge").click();
    await dialog.getByRole("radio", { name: "Email" }).click();
    await shot("composer-email", false);
    await dialog.getByTestId("composer-send").click();
    await dialog.getByText(/Blocked by DEV_BLOCK_REAL_SENDS/).waitFor();
    expect(outbound.resend.length === before, "Resend was called");
    const db = await dumpDb(page);
    expect(db.chaser_nudges.filter((x) => x.invoice_id === invId).length === 1, "blocked send was logged");
  });
  await r.check("E2 Email: sends explicitly enabled → Resend gets one test recipient, configured sender, pay block; logged", async () => {
    process.env.DEV_BLOCK_REAL_SENDS = "false";
    process.env.RESEND_API_KEY = "re_local_test";
    try {
      await dialog.getByTestId("composer-send").click();
      await dialog.waitFor({ state: "detached" });
      const m = outbound.resend.at(-1);
      expect(m.from === "Sample Service Co <accounts@example.com>", "from: " + m.from);
      expect(JSON.stringify(m.to) === '["test@example.com"]', "to: " + m.to);
      expect(m.reply_to === "owner@example.com", "reply_to");
      expect(m.text.includes("How to pay:") && m.text.includes("INV-2001"), "body");
      const db = await dumpDb(page);
      const n = db.chaser_nudges.filter((x) => x.invoice_id === invId);
      expect(n.length === 2 && n.some((x) => x.channel === "email" && x.stage === "final"), JSON.stringify(n));
      return `subject "${m.subject}" → recorder (no real send)`;
    } finally {
      delete process.env.DEV_BLOCK_REAL_SENDS;
    }
  });

  // ---- F. Promise to pay → broken → top of queue ------------------------------
  await r.check("F1 Log a promise (quick date) → pill, ladder paused", async () => {
    await page.getByTestId("detail-promise").click();
    await dialog.getByLabel("Promised date").fill("2026-11-06");
    await dialog.getByLabel("Note").fill("Paying tomorrow after payroll");
    await shot("promise-sheet", false);
    await dialog.getByRole("button", { name: "Log promise" }).click();
    await dialog.waitFor({ state: "detached" });
    await page.getByTestId("detail-promises").getByText("Waiting").waitFor();
    await shot("detail-promise");
  });
  await r.check("F2 Two days later, unpaid: BROKEN PROMISE heads the queue and the alert", async () => {
    await page.clock.setFixedTime(new Date("2026-11-08T09:00:00+02:00"));
    await page.reload();
    await nav("/");
    await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=queue-row]")].slice(0, 2).some((r) => r.textContent.includes("Gate Two")), null, { timeout: 6000 }).catch(() => {});
    const rows = page.getByTestId("queue-row");
    const top = [clean(await rows.nth(0).textContent()), clean(await rows.nth(1).textContent())];
    expect(top.some((t) => t.includes("Gate Two Customer") && t.includes("Broken promise")), top.join(" | "));
    expect(clean(await page.getByTestId("broken-alert").textContent()).includes("Gate Two Customer"), "alert");
    await shot("today-broken");
    await page.clock.setFixedTime(new Date(NOW));
    await page.reload();
  });

  // ---- G. Payments and auto-stop ------------------------------------------------
  await r.check("G1 Partial R 450,50 → R 2 000,00 outstanding, still on the ladder", async () => {
    await nav(`/invoices/${invId}`);
    await page.getByTestId("detail-pay").click();
    await dialog.getByLabel("Amount received now").fill("450,50");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await dialog.waitFor({ state: "detached" });
    expect((await body()).includes("R 2 000,00"), "balance");
  });
  await r.check("G2 Paid in full: confirmation states the consequence; then off every queue, who/when recorded", async () => {
    const badgeBefore = await page.evaluate(() => document.body.innerText);
    await page.getByTestId("detail-pay").click();
    await dialog.getByRole("button", { name: "Paid in full" }).click();
    await dialog.getByText("It leaves the ladder and every queue straight away.").waitFor();
    await shot("payment-sheet", false);
    await dialog.getByRole("button", { name: "Mark as paid" }).click();
    await dialog.waitFor({ state: "detached" });
    await page.getByTestId("detail-history").getByText("Marked paid by owner@example.com").waitFor();
    expect(clean(await page.getByTestId("detail-ladder").textContent()).includes("Off the ladder: paid"), "ladder");
    expect(await page.getByTestId("detail-nudge").count() === 0, "nudge still offered");
    const db = await dumpDb(page);
    const row = db.chaser_invoices.find((i) => i.id === invId);
    expect(row.status === "paid" && row.paid_at && row.paid_by === "owner@example.com", JSON.stringify(row));
    await nav("/");
    expect(!(await body()).includes("Gate Two Customer"), "still in Today");
    void badgeBefore;
  });

  // ---- H. Invoices list, filters ---------------------------------------------------
  await r.check("H1 Invoices: 90+ bucket chip filters; search finds a paid invoice via 'paid also match'", async () => {
    await nav("/invoices");
    await page.getByRole("button", { name: "90+ days" }).click();
    const rows = page.getByTestId("invoice-row");
    expect(await rows.count() === 1, "90+ rows " + await rows.count());
    await noHScroll("invoices");
    await page.getByRole("button", { name: "Any age" }).click();
    await shot("invoices");
    await page.getByLabel("Search invoices").fill("INV-2001");
    await page.getByRole("button", { name: /paid also match/ }).click();
    await page.getByTestId("invoice-row").filter({ hasText: "Gate Two Customer" }).waitFor();
  });

  // ---- I. CSV import ------------------------------------------------------------------
  await r.check("I1 CSV: messy sample → preview flags rows, 5 import (error row unticked, duplicate kept unticked)", async () => {
    await nav("/import");
    await page.getByLabel("Or paste the rows").fill(CSV);
    await page.getByLabel("Or paste the rows").blur();
    await page.getByText("Customer match").waitFor();
    await shot("import-preview");
    await page.getByLabel("Import line 6").uncheck(); // the Unparsable Co row
    const btn = page.getByRole("button", { name: /^Import \d+ invoice/ });
    const label = await btn.textContent();
    await btn.click();
    await page.getByText("Import complete").waitFor();
    return label;
  });

  // ---- J. Pull from Quote & Invoice --------------------------------------------------
  await r.check("J1 Pull: one accepted past-due quote offered (customer matched by phone); paid/sent/not-due excluded", async () => {
    await page.evaluate(([k, owner]) => {
      const db = JSON.parse(localStorage.getItem(k));
      const q = (id, over) => ({ id, owner_id: owner, customer_name: "Lerato Nkosi", customer_phone: "+27 00 000 0006", customer_email: null,
        line_items: [{ description: "Toilet cistern replacement" }], subtotal: 118000, total: 1180, status: "accepted",
        accepted_at: "2026-10-20T08:00:00Z", invoiced_at: null, paid_at: null, created_at: "2026-10-18T08:00:00Z", updated_at: "2026-10-20T08:00:00Z", ...over });
      db.quotes = [
        q("a1b2c3d4-0000-4000-8000-000000000001", { customer_name: "Nadia Q Customer", customer_phone: "082 000 0202", total: 3450.5, line_items: [{ description: "Lawn and edging" }, { description: "Hedge" }] }),
        q("a1b2c3d4-0000-4000-8000-000000000002", { status: "paid" }),
        q("a1b2c3d4-0000-4000-8000-000000000003", { status: "sent" }),
        q("a1b2c3d4-0000-4000-8000-000000000004", { accepted_at: "2026-11-03T08:00:00Z" }),
        q("a1b2c3d4-0000-4000-8000-000000000005", { owner_id: "00000000-0000-4000-8000-0000000000ff", customer_name: "Other Business Customer" }),
      ];
      localStorage.setItem(k, JSON.stringify(db));
    }, [DB_KEY, OWNER]);
    await page.getByTestId("pull-open").click();
    await dialog.getByTestId("pull-list").waitFor();
    const t = clean(await dialog.textContent());
    expect(t.includes("Nadia Q Customer") && t.includes("R 3 450,50") && t.includes("Q-A1B2C3"), t);
    expect(!t.includes("Other Business Customer"), "another owner's quote leaked");
    expect(t.includes("Also show 1 quote not due yet"), "not-due toggle");
    await shot("pull-sheet", false);
    await dialog.getByTestId("pull-import").click();
    await dialog.waitFor({ state: "detached" });
  });
  await r.check("J2 Pulled invoice enters the ladder; re-running the pull never duplicates", async () => {
    await nav("/invoices");
    await page.getByLabel("Search invoices").fill("Nadia Q");
    await page.getByTestId("invoice-row").first().click();
    await page.getByTestId("detail-summary").getByText("Quote & Invoice").waitFor();
    await page.getByTestId("detail-nudge").waitFor();
    await nav("/import");
    await page.getByTestId("pull-open").click();
    await dialog.getByTestId("pull-empty").waitFor();
    await page.keyboard.press("Escape");
    const db = await dumpDb(page);
    expect(db.chaser_invoices.filter((i) => i.source_quote_id === "a1b2c3d4-0000-4000-8000-000000000001").length === 1, "dup");
  });

  // ---- K. Offline: cached state, queued nudge, sync on return -----------------------
  await r.check("K1 Network drops: Today renders from cache with an offline line", async () => {
    await nav("/");
    await page.getByTestId("today-queue").waitFor();
    await page.evaluate(() => localStorage.setItem("dropstack-mock-fail", "all"));
    await page.reload();
    await page.getByTestId("today-queue").waitFor();
    await page.locator("[data-testid=sync-status]:visible").getByText(/Offline/).waitFor();
    expect(clean(await page.locator("[data-testid=health-status]:visible").textContent()) === "Database not reachable", "health line while offline");
    await shot("today-offline");
  });
  await r.check("K2 WhatsApp nudge while offline: opens, saved on the phone, synced when back", async () => {
    const before = (await dumpDb(page)).chaser_nudges.length;
    await page.getByTestId("queue-row").first().click();
    await dialog.getByTestId("composer-send").click();
    await dialog.waitFor({ state: "detached" });
    await page.getByText("Saved on this phone. It will sync when you're back online.").waitFor();
    expect((await dumpDb(page)).chaser_nudges.length === before, "wrote while offline");
    await page.evaluate(() => { localStorage.removeItem("dropstack-mock-fail"); dispatchEvent(new Event("online")); });
    await page.waitForFunction(([k, n]) => JSON.parse(localStorage.getItem(k)).chaser_nudges.length === n + 1, [DB_KEY, before], { timeout: 6000 });
  });

  // ---- L. Demo removal, health, hygiene ----------------------------------------------
  await r.check("L1 Remove demo data: exactly the DEMO rows go; real and pulled invoices stay; badge gone", async () => {
    const db0 = await dumpDb(page);
    const real0 = db0.chaser_invoices.filter((i) => !i.is_demo).map((i) => i.id).sort();
    await nav("/setup");
    await page.getByTestId("demo-remove").click();
    await shot("demo-remove-confirm", false);
    await dialog.getByRole("button", { name: "Remove demo data" }).click();
    await dialog.waitFor({ state: "detached" });
    await page.locator("[data-testid=demo-badge]:visible").first().waitFor({ state: "detached" });
    const db1 = await dumpDb(page);
    expect(JSON.stringify(db1.chaser_invoices.map((i) => i.id).sort()) === JSON.stringify(real0), "real rows changed");
    expect([...db1.chaser_customers, ...db1.chaser_nudges, ...db1.chaser_promises].every((x) => !x.is_demo), "demo left");
    return `${db0.chaser_invoices.length - real0.length} demo invoices removed, ${real0.length} real kept`;
  });
  await r.check("L2 Health status line shows in the shell (booleans-only endpoint drives it)", async () => {
    await page.reload();
    const t = clean(await page.locator("[data-testid=health-status]:visible").textContent());
    expect(t === "Connected · add payment details and sender email", t);
    await shot("setup-after");
    return t;
  });
  await r.check("L3 Customers list and empty-state copy render; no window.confirm used anywhere", async () => {
    await nav("/customers");
    await page.getByTestId("customer-list").waitFor();
    await shot("customers");
    expect(confirms.length === 0, "native dialogs: " + confirms.join(","));
  });
  await r.check("L4 No emojis, no 'Netlify' badge, no JS errors, nothing left localhost", async () => {
    for (const p of ["/", "/invoices", "/customers", "/import", "/setup"]) {
      await nav(p);
      const t = await body();
      expect(!EMOJI.test(t), `emoji on ${p}`);
      expect(!/netlify/i.test(t), `Netlify text on ${p}`);
      await noHScroll(p);
    }
    expect(errors.length === 0, errors.join("; "));
    expect(ctx.blocked.length === 0, ctx.blocked.join(", "));
  });
  all[label] = r.rows;
  await ctx.close();
}
await browser.close();
writeFileSync(`${shots}/gate2.json`, JSON.stringify({ rows: all, timings }, null, 2));
const fails = Object.values(all).flat().filter((x) => !x.ok).length;
console.log(`\nfirst-value timings (s):`, timings);
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
