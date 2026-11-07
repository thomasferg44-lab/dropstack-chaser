// The new UI against the database as it is live today (before the
// 2026-11-05 patch): v1 features keep working, new ones say what they need.
//   node tools/gates/legacy.mjs <shotsDir> <baseUrl> <repo>
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, newContext, PHONE, DESKTOP, recorder, clean, expect, useFunctions, dumpDb } from "./lib.mjs";
const [shots, base, repo] = [process.argv[2], process.argv[3] ?? "http://127.0.0.1:4302", process.argv[4] ?? process.cwd()];
mkdirSync(shots, { recursive: true });
await useFunctions(repo);
const browser = await launch();
const all = {};
for (const [label, profile] of [["390", PHONE], ["desktop", DESKTOP]]) {
  console.log(`\n== pre-patch database @ ${label}`);
  const r = recorder();
  const ctx = await newContext(browser, profile, base);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  await page.clock.setFixedTime(new Date("2026-11-05T09:00:00+02:00"));
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const dialog = page.getByRole("dialog");
  const nav = async (p) => { await page.evaluate((x) => { history.pushState({}, "", x); dispatchEvent(new PopStateEvent("popstate")); }, p); await page.waitForTimeout(150); };
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("dropstack-mock-schema", "legacy"); localStorage.setItem("dropstack-mock-latency", "40"); });
  await page.reload();
  let id;
  await r.check("P1 Sign in; empty state offers 'Add your first invoice' (demo needs the patch)", async () => {
    await page.getByLabel("Email").fill("owner@example.com");
    await page.getByLabel("Password").fill("x");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Add your first invoice" }).waitFor();
    await page.screenshot({ path: `${shots}/after-prepatch-empty-${label}.png`, fullPage: true });
  });
  await r.check("P2 Add an invoice, see its ladder", async () => {
    await page.getByRole("button", { name: "Add your first invoice" }).click();
    await dialog.getByLabel("Name").fill("Legacy Path Customer");
    await dialog.getByLabel("Mobile (for WhatsApp)").fill("082 000 0303");
    await dialog.getByLabel("Your invoice number").fill("INV-3001");
    await dialog.getByLabel("Amount", { exact: true }).fill("1500");
    await dialog.getByLabel("Invoice date").fill("2026-10-20");
    await dialog.getByLabel("Due date").fill("2026-10-30");
    await dialog.getByRole("button", { name: "Add invoice" }).click();
    await page.getByTestId("detail-ladder").waitFor();
    id = page.url().split("/invoices/")[1];
  });
  await r.check("P3 Promise button disabled with a plain reason", async () => {
    expect(await page.getByTestId("detail-promise").isDisabled(), "enabled");
    await page.getByText("Promise-to-pay needs the November database update.").waitFor();
  });
  await r.check("P4 WhatsApp nudge works and is logged (tone only, no stage column)", async () => {
    await page.getByTestId("detail-nudge").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=nudge-body]")?.value.length > 20);
    await dialog.getByTestId("composer-send").click();
    await dialog.waitFor({ state: "detached" });
    const url = await page.evaluate(() => window.__opened.at(-1));
    expect(clean(decodeURIComponent(url)).includes("INV-3001") && clean(decodeURIComponent(url)).includes("R 1 500,00"), url);
    const n = (await dumpDb(page)).chaser_nudges;
    expect(n.length === 1 && !("stage" in n[0]), JSON.stringify(n));
    await page.getByTestId("detail-history").getByText(/nudge sent by WhatsApp/).waitFor();
  });
  await r.check("P5 Paid in full works; auto-stop holds; who/when shows 'not recorded' until the patch", async () => {
    await page.getByTestId("detail-pay").click();
    await dialog.getByRole("button", { name: "Paid in full" }).click();
    await dialog.getByRole("button", { name: "Mark as paid" }).click();
    await dialog.waitFor({ state: "detached" });
    await page.getByTestId("detail-history").getByText("Date not recorded").waitFor();
    expect((await dumpDb(page)).chaser_invoices[0].status === "paid", "status");
  });
  await r.check("P6 Pull from Quote & Invoice and demo mode say they need the update", async () => {
    await nav("/import");
    expect(await page.getByTestId("pull-open").isDisabled(), "pull enabled");
    await nav("/setup");
    await page.getByText("Demo mode needs the November database update.").waitFor();
    await page.screenshot({ path: `${shots}/after-prepatch-setup-${label}.png`, fullPage: true });
  });
  await r.check("P7 No JS errors; nothing left localhost", async () => {
    expect(errors.length === 0, errors.join("; "));
    expect(ctx.blocked.length === 0, ctx.blocked.join(","));
  });
  all[label] = r.rows;
  await ctx.close();
}
await browser.close();
writeFileSync(`${shots}/legacy.json`, JSON.stringify(all, null, 2));
const fails = Object.values(all).flat().filter((x) => !x.ok).length;
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
