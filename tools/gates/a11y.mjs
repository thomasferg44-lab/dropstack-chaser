// Gate 5 accessibility spot checks: every input labelled, tap targets >= 44px,
// visible focus, status-pill contrast >= 4.5:1. Phone + desktop.
//   node tools/gates/a11y.mjs <outDir> <baseUrl> <repo>
import { writeFileSync } from "node:fs";
import { launch, PHONE, DESKTOP, DB_KEY } from "./lib.mjs";
const [OUT, BASE, repo] = [process.argv[2], process.argv[3] ?? "http://127.0.0.1:4302", process.argv[4] ?? process.cwd()];
const { contrast, hexToRgb } = await import(`${repo}/src/lib/brand.js`);
const report = { pills: {}, screens: {} };
for (const [k, fg, bg] of [["good (Paid, Kept)", "#1a7a37", "#e6f6ea"], ["warn (Overdue, Firm, DEMO)", "#a35200", "#fff4e0"], ["bad (60+ overdue, Broken promise, Final)", "#c7001a", "#ffeaec"], ["info (Due in, Friendly, Promised)", "#0062cc", "#e7f1ff"], ["neutral (Written off)", "#48484a", "#e8e8ed"], ["secondary text on white", "#6e6e73", "#ffffff"], ["secondary text on canvas", "#6e6e73", "#f5f5f7"]])
  report.pills[k] = Math.round(contrast(hexToRgb(fg), hexToRgb(bg)) * 100) / 100;
const b = await launch();
for (const [pname, profile] of [["phone", PHONE], ["desktop", DESKTOP]]) {
  const ctx = await b.newContext({ ...profile, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem("dropstack-mock-latency", "20"); });
  await p.reload();
  const audit = async () => p.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    const name = (e) => e.getAttribute("aria-label") || (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent) || e.closest("label")?.textContent || e.getAttribute("title") || "";
    const unlabeled = [...document.querySelectorAll("input, select, textarea")].filter((e) => e.type !== "hidden" && vis(e) && !name(e).trim()).map((e) => e.outerHTML.slice(0, 80));
    const small = [...document.querySelectorAll("button, a[href], [role=radio], label:has(input[type=checkbox])")].filter(vis)
      .filter((e) => !e.closest("p") && !e.closest("table"))
      .map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((x) => x.h < 44 || x.w < 44);
    return { unlabeled, small };
  });
  await p.getByLabel("Email").fill("owner@example.com");
  report.screens[`sign-in-${pname}`] = await audit();
  await p.getByLabel("Password").fill("x");
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.getByTestId("empty-load-demo").click();
  report.screens[`demo-sheet-${pname}`] = await audit();
  await p.getByTestId("demo-load").click();
  await p.getByTestId("today-queue").waitFor();
  const st = JSON.parse(await p.evaluate((k) => localStorage.getItem(k), DB_KEY));
  const go = async (path) => { await p.evaluate((x) => { history.pushState({}, "", x); dispatchEvent(new PopStateEvent("popstate")); }, path); await p.waitForTimeout(400); };
  for (const [n, path] of [["today", "/"], ["invoices", "/invoices"], ["detail", `/invoices/${st.chaser_invoices[6].id}`], ["customers", "/customers"], ["import", "/import"], ["setup", "/setup"]]) {
    await go(path); report.screens[`${n}-${pname}`] = await audit();
  }
  await go("/"); await p.getByTestId("queue-row").first().click(); await p.waitForTimeout(400);
  report.screens[`composer-${pname}`] = await audit();
  await p.keyboard.press("Escape");
  await go(`/invoices/${st.chaser_invoices[6].id}`); await p.getByTestId("detail-pay").click(); await p.waitForTimeout(300);
  report.screens[`payment-${pname}`] = await audit();
  await p.keyboard.press("Escape");
  // focus visible: tab through Today
  await go("/");
  const focus = [];
  for (let i = 0; i < 12; i++) {
    await p.keyboard.press("Tab");
    focus.push(await p.evaluate(() => { const e = document.activeElement; if (e === document.body) return { t: "body", visible: true }; const cs = getComputedStyle(e); return { t: (e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 25), visible: (cs.outlineStyle !== "none" && cs.outlineWidth !== "0px") || /rgb/.test(cs.boxShadow) }; }));
  }
  report.screens[`focus-today-${pname}`] = focus;
  await ctx.close();
}
await b.close();
writeFileSync(`${OUT}/a11y.json`, JSON.stringify(report, null, 1));
console.log("contrast", JSON.stringify(report.pills));
let bad = Object.values(report.pills).filter((c) => c < 4.5).length;
for (const [k, v] of Object.entries(report.screens)) {
  if (k.startsWith("focus")) { const nv = v.filter((x) => !x.visible); bad += nv.length; console.log(k, nv.length ? "NOT VISIBLE: " + JSON.stringify(nv) : `all ${v.length} focus stops visible`); }
  else { bad += v.unlabeled.length + v.small.length; console.log(k, "unlabeled:", v.unlabeled.length, "small targets:", JSON.stringify(v.small)); }
}
console.log(bad ? `${bad} issue(s)` : "ALL PASS");
