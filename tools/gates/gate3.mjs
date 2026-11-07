// Gate 3: config swap. A scratch build with configs/demo-config-2.js copied
// over companyConfig.js, then the shortest Gate 2 flow and a leftover scan.
//   node tools/gates/gate3.mjs <shotsDir> <baseUrl> <scratchRepo>
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, newContext, PHONE, DESKTOP, recorder, clean, expect, useFunctions, outbound } from "./lib.mjs";
const [shots, base, repo] = [process.argv[2], process.argv[3] ?? "http://127.0.0.1:4303", process.argv[4]];
mkdirSync(shots, { recursive: true });
await useFunctions(repo); // the scratch copy's functions read ITS companyConfig
const LEFTOVERS = ["Sample Service Co", "Sample Owner", "accounts@example.com", "owner@example.com>", "Acc no 0000000000", "Friendly nudge", "Firm nudge"];
const browser = await launch();
const all = {};
for (const [label, profile] of [["390", PHONE], ["desktop", DESKTOP]]) {
  console.log(`\n== Gate 3 @ ${label}`);
  const r = recorder();
  const ctx = await newContext(browser, profile, base);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  await page.clock.setFixedTime(new Date("2026-11-05T09:00:00+02:00"));
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const dialog = page.getByRole("dialog");
  const seen = [];
  const grab = async () => seen.push(clean(await page.textContent("body")));
  const nav = async (p) => { await page.evaluate((x) => { history.pushState({}, "", x); dispatchEvent(new PopStateEvent("popstate")); }, p); await page.waitForTimeout(200); };
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("dropstack-mock-latency", "40"); });
  await page.reload();

  await r.check("G3.1 Sign-in shows the new name, monogram EC and brand colour; tab title", async () => {
    await page.getByText("Example Coastal Electrical").first().waitFor();
    expect(clean(await page.getByRole("img", { name: "Example Coastal Electrical" }).first().textContent()) === "EC", "monogram");
    const bg = await page.getByRole("button", { name: "Sign in" }).evaluate((b) => getComputedStyle(b).backgroundColor);
    expect(bg === "rgb(31, 78, 121)", "button colour " + bg);
    expect((await page.title()).includes("Example Coastal Electrical"), await page.title());
    await page.screenshot({ path: `${shots}/after-c2-login-${label}.png` });
    await grab();
  });
  await r.check("G3.2 Demo offers only this client's trade; queue uses this client's ladder labels", async () => {
    await page.getByLabel("Email").fill("owner@example.org");
    await page.getByLabel("Password").fill("x");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByTestId("empty-load-demo").click();
    const trades = await dialog.getByRole("radio").allTextContents();
    expect(JSON.stringify(trades) === '["Electrician"]', JSON.stringify(trades));
    await dialog.getByTestId("demo-load").click();
    await page.getByTestId("today-queue").waitFor();
    const q = clean(await page.getByTestId("today-queue").textContent());
    expect(/Reminder|Overdue|Last notice/.test(q), q);
    await page.screenshot({ path: `${shots}/after-c2-today-${label}.png`, fullPage: true });
    await grab();
  });
  let wa;
  await r.check("G3.3 Nudge: WhatsApp prefill signed by the new owner, new bank details and pay link", async () => {
    await page.getByTestId("queue-row").first().click();
    await page.waitForFunction(() => document.querySelector("[data-testid=nudge-body]")?.value.length > 20);
    await page.screenshot({ path: `${shots}/after-c2-composer-${label}.png` });
    await dialog.getByTestId("composer-send").click();
    await dialog.waitFor({ state: "detached" });
    wa = clean(decodeURIComponent((await page.evaluate(() => window.__opened.at(-1))).split("?text=")[1]));
    for (const s of ["Example Coastal Electrical", "Example Owner Two", "Example Mutual Bank", "Pay online: https://pay.example.com/coastal-electrical"]) expect(wa.includes(s), `missing ${s}: ${wa}`);
    return wa.slice(0, 70) + "…";
  });
  await r.check("G3.4 Email: From and reply-to are the new sender (through the real send function)", async () => {
    process.env.DEV_BLOCK_REAL_SENDS = "false";
    process.env.RESEND_API_KEY = "re_local_test";
    try {
      await nav("/invoices");
      await page.getByRole("button", { name: /New/ }).first().click();
      await dialog.getByRole("button", { name: "New" }).click();
      await dialog.getByLabel("Name").fill("Config Two Customer");
      await dialog.getByLabel("Email").fill("test@example.com");
      await dialog.getByLabel("Amount", { exact: true }).fill("980");
      await dialog.getByLabel("Invoice date").fill("2026-10-01");
      await dialog.getByLabel("Due date").fill("2026-10-10");
      await dialog.getByRole("button", { name: "Add invoice" }).click();
      await page.getByTestId("detail-nudge").click();
      await page.waitForFunction(() => document.querySelector("[data-testid=nudge-body]")?.value.length > 20);
      await grab();
      await dialog.getByTestId("composer-send").click();
      await dialog.waitFor({ state: "detached" });
      const m = outbound.resend.at(-1);
      expect(m.from === "Example Coastal Electrical <billing@example.org>" && m.reply_to === "owner-two@example.org", m.from + " / " + m.reply_to);
      expect(m.text.includes("Example Mutual Bank") && !m.text.includes("Sample"), "body");
      seen.push(m.text, m.subject);
    } finally { delete process.env.DEV_BLOCK_REAL_SENDS; }
  });
  await r.check("G3.5 Setup shows this client's ladder (3 / 10 / 21 days, 4-day gap)", async () => {
    await nav("/setup");
    const t = clean(await page.textContent("body"));
    for (const s of ["3 days after it's due", "10 days after it's due", "21 days after it's due", "At least 4 days between nudges", "Example Coastal Electrical <billing@example.org>"]) expect(t.includes(s), s);
    await page.screenshot({ path: `${shots}/after-c2-setup-${label}.png`, fullPage: true });
    await grab();
  });
  await r.check("G3.6 Leftover scan: zero traces of the base config in screens, prefills and email", async () => {
    for (const p of ["/", "/invoices", "/customers", "/import"]) { await nav(p); await grab(); }
    const hay = [...seen, wa].join("\n");
    const hits = LEFTOVERS.filter((x) => hay.includes(x));
    expect(hits.length === 0, "leftovers: " + hits.join(", "));
    expect(errors.length === 0 && ctx.blocked.length === 0, errors.concat(ctx.blocked).join("; "));
    return `${LEFTOVERS.length} base-config strings checked`;
  });
  all[label] = r.rows;
  await ctx.close();
}
await browser.close();
writeFileSync(`${shots}/gate3.json`, JSON.stringify(all, null, 2));
const fails = Object.values(all).flat().filter((x) => !x.ok).length;
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
