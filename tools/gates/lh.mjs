// Gate 5: mobile Lighthouse on the local production build (test backend),
// 3 runs per screen, lowest kept; plus a Fast-3G (devtools-throttled) LCP
// check. Chaser has no customer-facing page: the sign-in screen is the only
// surface without a session, so it gets the Fast-3G run along with Today.
// Every non-localhost host is unresolvable.
//   LIGHTHOUSE_CLI=/path/lighthouse/cli/index.js node tools/gates/lh.mjs <outDir> <baseUrl>
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const run = promisify(execFile);
const require = createRequire(process.env.PLAYWRIGHT_FROM ?? `${process.env.HOME}/dropstack-outreachv2/package.json`);
const { chromium } = require("playwright-core");
const [OUT, BASE] = [process.argv[2], process.argv[3] ?? "http://localhost:4310"];
mkdirSync(OUT, { recursive: true });
const PORT = 9334;
const LH = process.env.LIGHTHOUSE_CLI;
const ctx = await chromium.launchPersistentContext(OUT + "/profile", { headless: true, args: [`--remote-debugging-port=${PORT}`, "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"] });

let snapshot = null; // the on-device copy a returning owner already has
// Seed once through the real UI: sign in, load the plumber demo.
let page = await ctx.newPage();
await page.goto(BASE);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem("dropstack-mock-latency", "30"); });
await page.reload();
await page.getByLabel("Email").fill("owner@example.com");
await page.getByLabel("Password").fill("x");
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByTestId("empty-load-demo").click();
await page.getByTestId("demo-load").click();
await page.getByTestId("today-queue").waitFor();
const seeded = await page.evaluate(() => ({ db: localStorage.getItem("dropstack-mock-db-v1"), session: localStorage.getItem("dropstack-mock-session-v1") }));
const detailId = JSON.parse(seeded.db).chaser_invoices[6].id;
await page.reload();
await page.getByTestId("today-queue").waitFor();
snapshot = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("chaser:snap:")));
await page.close();

async function prepare({ latency, session, returning = false }) {
  page = await ctx.newPage();
  await page.goto(BASE + "/setup");
  await page.evaluate(([s, lat, withSession, snap]) => {
    const keep = s;
    localStorage.clear();
    localStorage.setItem("dropstack-mock-db-v1", keep.db);
    if (withSession) localStorage.setItem("dropstack-mock-session-v1", keep.session);
    if (snap) for (const [k, v] of snap) localStorage.setItem(k, v);
    localStorage.setItem("dropstack-mock-latency", String(lat));
  }, [seeded, latency, session, returning ? snapshot : null]);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.clearBrowserCache");
  await page.close();
}

async function lighthouse(url, name, extra = []) {
  const out = `${OUT}/${name}.json`;
  await run("node", [LH, url, `--port=${PORT}`, "--disable-storage-reset", "--only-categories=performance,accessibility,best-practices",
    "--output=json", `--output-path=${out}`, "--quiet", "--chrome-flags=--headless", ...extra], { timeout: 240000, maxBuffer: 1 << 26 });
  const r = JSON.parse(readFileSync(out, "utf8"));
  const a = r.audits;
  return {
    perf: Math.round(r.categories.performance.score * 100),
    a11y: Math.round(r.categories.accessibility.score * 100),
    bp: Math.round(r.categories["best-practices"].score * 100),
    lcp: Math.round(a["largest-contentful-paint"].numericValue),
    tbt: Math.round(a["total-blocking-time"].numericValue),
    cls: Math.round(a["cumulative-layout-shift"].numericValue * 1000) / 1000,
    weightKB: Math.round(a["total-byte-weight"].numericValue / 1024),
    lcpEl: (() => { const n = a["lcp-breakdown-insight"]?.details?.items?.find((x) => x.type === "node"); return n ? `${n.nodeLabel} ${n.snippet}` : ""; })(),
    failedA11y: Object.values(a).filter((x) => x.score === 0 && r.categories.accessibility.auditRefs.some((ref) => ref.id === x.id)).map((x) => x.id),
  };
}

const summary = {};
for (const [name, path, session] of [["today", "/", true], ["invoice-detail", `/invoices/${detailId}`, true], ["sign-in", "/", false]]) {
  const runs = [];
  for (let i = 0; i < 3; i++) { await prepare({ latency: 120, session }); runs.push(await lighthouse(BASE + path, `${name}-run${i + 1}`)); }
  summary[name] = { runs, lowestPerf: Math.min(...runs.map((r) => r.perf)) };
  console.log(name, JSON.stringify(runs.map((r) => [r.perf, r.lcp, r.weightKB])), "lowest", summary[name].lowestPerf, "| a11y", runs[0].a11y, runs[0].failedA11y.join(","), "| bp", runs[0].bp, "| LCP el:", runs[0].lcpEl.slice(0, 90));
}
// Fast 3G (DevTools preset: 1.6 Mbps / 750 Kbps / 562.5 ms RTT, 4x CPU).
// The test backend's data call isn't network traffic, so its in-page latency
// stands in for the Supabase round trip: 1700 ms pessimistic cold, 700 ms warm.
const FAST3G = ["--throttling-method=devtools", "--throttling.requestLatencyMs=562.5", "--throttling.downloadThroughputKbps=1600", "--throttling.uploadThroughputKbps=750", "--throttling.cpuSlowdownMultiplier=4"];
for (const [name, session, lat, returning] of [["sign-in", false, 0, false], ["today-first-visit", true, 1700, false], ["today-first-visit", true, 700, false], ["today-returning", true, 1700, true]]) {
  const runs = [];
  for (let i = 0; i < 3; i++) { await prepare({ latency: lat, session, returning }); runs.push(await lighthouse(BASE + "/", `${name}-fast3g-${lat}-run${i + 1}`, FAST3G)); }
  summary[`fast3g_${name}_${lat}`] = { runs, worstLcp: Math.max(...runs.map((r) => r.lcp)) };
  console.log(`fast3g ${name} (data ${lat} ms) LCP`, runs.map((r) => r.lcp), "worst", summary[`fast3g_${name}_${lat}`].worstLcp, "| LCP el:", runs[0].lcpEl.slice(0, 80));
}
writeFileSync(`${OUT}/gate5-summary.json`, JSON.stringify(summary, null, 2));
await ctx.close();
