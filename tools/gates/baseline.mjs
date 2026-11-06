// Gate 0: the brief's Chaser flow on the CURRENT (v1) UI, before any change.
// Runs against fff7b9f's code with only the local test backend swapped in,
// in "legacy" schema mode (the database as it is live today).
//   node tools/gates/baseline.mjs <shotsDir> <baseUrl> <repoForFunctions>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { launch, newContext, PHONE, DESKTOP, recorder, clean, expect, useFunctions, outbound } from "./lib.mjs";

const [shots, base, repo] = [process.argv[2], process.argv[3] ?? "http://localhost:4301", process.argv[4]];
mkdirSync(shots, { recursive: true });
await useFunctions(repo);
const CSV = readFileSync(new URL("../../samples/messy-invoices.csv", import.meta.url), "utf8");
const browser = await launch();
const all = {};

for (const [label, profile] of [["390", PHONE], ["desktop", DESKTOP]]) {
  console.log(`\n== Gate 0 baseline @ ${label}`);
  const r = recorder();
  const ctx = await newContext(browser, profile, base);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date("2026-11-05T09:00:00+02:00"));
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("dropstack-mock-schema", "legacy"); localStorage.setItem("dropstack-mock-latency", "40"); });
  await page.reload();
  const shot = (n) => page.screenshot({ path: `${shots}/before-${n}-${label}.png`, fullPage: true });
  const dialog = page.getByRole("dialog");

  await r.check("Sign-in rejects a wrong password", async () => {
    await shot("login");
    await page.fill("#email", "owner@example.com");
    await page.fill("#password", "wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("Invalid login credentials").waitFor();
  });
  await r.check("Sign in, empty dashboard", async () => {
    await page.fill("#password", "correct-horse");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("No invoices yet").waitFor();
    await shot("dashboard-empty");
  });
  await r.check("Create a customer and an invoice (R 2 450,50, due 15 Oct 2026)", async () => {
    await page.getByRole("button", { name: "+ Add invoice" }).click();
    await dialog.getByRole("button", { name: "+ New" }).click();
    await dialog.locator("input").first().fill("Baseline Test Customer");
    await dialog.getByPlaceholder("082 000 0000").fill("+27 00 000 0001");
    await dialog.getByRole("button", { name: "Save customer" }).click();
    await dialog.getByPlaceholder("INV-001").fill("INV-1001");
    await dialog.getByPlaceholder("Geyser replacement").fill("Geyser valve");
    await dialog.getByPlaceholder("1500.00").fill("R 2 450,50");
    const dates = dialog.locator('input[type="date"]');
    await dates.nth(0).fill("2026-10-01");
    await dates.nth(1).fill("2026-10-15");
    await dialog.getByRole("button", { name: "Add invoice" }).click();
    await dialog.waitFor({ state: "detached" });
  });
  await r.check("Invoice shows as overdue with the right headline", async () => {
    await page.getByText("21 days overdue").first().waitFor();
    const body = clean(await page.textContent("body"));
    expect(body.includes("R 2 450,50"), "headline missing R 2 450,50");
    await shot("dashboard-one");
  });
  await r.check("Nudge sheet: Firm tone, WhatsApp prefill has INV-1001 and R 2 450,50", async () => {
    await page.getByRole("button", { name: "Nudge" }).first().click();
    await dialog.getByRole("button", { name: /Firm/ }).click();
    await shot("nudge-sheet");
    await dialog.getByRole("button", { name: "Open WhatsApp" }).click();
    await dialog.waitFor({ state: "detached" });
    const opened = await page.evaluate(() => window.__opened);
    const url = opened.at(-1);
    expect(url.startsWith("https://wa.me/27000000001?text="), "wrong wa.me target: " + url);
    const text = clean(decodeURIComponent(url.split("?text=")[1]));
    expect(text.includes("INV-1001") && text.includes("R 2 450,50") && text.includes("21 days overdue"), "prefill: " + text);
    return text.slice(0, 70) + "…";
  });
  await r.check("Nudge recorded on the row", async () => { await page.getByText("nudged 1× · last today").waitFor(); });
  await r.check("Partial payment R 450,50 leaves R 2 000,00, status Partial", async () => {
    await page.getByRole("button", { name: "Payment" }).first().click();
    await dialog.locator("#payment-amount").fill("450,50");
    await shot("payment-sheet");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await dialog.waitFor({ state: "detached" });
    await page.locator("span", { hasText: /^Partial$/ }).first().waitFor();
    expect(clean(await page.textContent("body")).includes("R 2 000,00"), "balance not R 2 000,00");
  });
  await r.check("CSV import of the messy sample: 6 ready, total R 11 795,67", async () => {
    await page.getByRole("button", { name: "Import CSV" }).first().click();
    const ta = page.locator("textarea");
    await ta.fill(CSV);
    await ta.blur();
    await page.getByText("Customer match").waitFor();
    await shot("import-preview");
    // untick the duplicate (already default) and the error row
    const rowsWithErr = page.locator('tr:has(input[value="Unparsable Co"]) input[type="checkbox"]');
    await rowsWithErr.uncheck();
    const btn = page.getByRole("button", { name: /Import \d+ invoice/ });
    const label = await btn.textContent();
    await btn.click();
    await page.getByText("Import complete").waitFor();
    return label;
  });
  await r.check("Dashboard total = R 2 000,00 + R 11 795,67 = R 13 795,67", async () => {
    await page.getByRole("button", { name: "View invoices" }).click();
    await page.getByText("You are owed").waitFor();
    await page.waitForTimeout(300);
    const head = clean(await page.locator(".text-4xl").textContent());
    expect(head === "R 13 795,67", "headline: " + head);
    await shot("dashboard-populated");
  });
  await r.check("Email nudge goes through the real send function and is blocked by DEV_BLOCK_REAL_SENDS", async () => {
    const before = outbound.resend.length;
    await page.locator("div.card", { hasText: "INV-001" }).getByRole("button", { name: "Nudge" }).first().click();
    await dialog.getByRole("button", { name: "Email" }).click();
    await dialog.getByRole("button", { name: "Send email" }).click();
    await dialog.getByText(/Blocked by DEV_BLOCK_REAL_SENDS/).waitFor();
    expect(outbound.resend.length === before, "Resend was called");
    await page.keyboard.press("Escape");
    await dialog.getByRole("button", { name: "Close" }).click();
  });
  await r.check("Customers page lists the imported customers", async () => {
    await page.getByRole("button", { name: "Customers" }).first().click();
    await page.getByText("Placeholder Electrical").waitFor();
    await shot("customers");
  });
  await r.check("No JS errors; no request left the local server", async () => {
    expect(errors.length === 0, errors.join("; "));
    expect(ctx.blocked.length === 0, ctx.blocked.join(", "));
  });
  all[label] = r.rows;
  await ctx.close();
}
await browser.close();
writeFileSync(`${shots}/gate0.json`, JSON.stringify(all, null, 2));
const fails = Object.values(all).flat().filter((x) => !x.ok).length;
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
