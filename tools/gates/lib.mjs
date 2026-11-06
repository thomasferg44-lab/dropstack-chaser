// Shared helpers for the gate scripts (design spec §6). Not part of the app.
import { createRequire } from "node:module";
// playwright-core is borrowed from another local project (not a dependency of
// this app). Point PLAYWRIGHT_FROM at any package.json whose node_modules has it.
const require = createRequire(process.env.PLAYWRIGHT_FROM ?? `${process.env.HOME}/dropstack-outreachv2/package.json`);
export const { chromium } = require("playwright-core");

export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const DESKTOP = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 };
export const DB_KEY = "dropstack-mock-db-v1";

export async function launch() { return chromium.launch({ headless: true }); }

// ---- the real Netlify Functions, run in this Node process -----------------
// /.netlify/functions/send-nudge and /api/health are answered by the repo's own
// handlers. Their outbound calls are stubbed here: the Supabase auth check
// accepts the test backend's token, and Resend is a recorder. Nothing leaves
// this machine.
export const outbound = { resend: [], auth: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("http://auth-stub.local/auth/v1/user")) {
    outbound.auth++;
    const ok = (init.headers?.Authorization ?? "") === "Bearer mock";
    return new Response(JSON.stringify(ok ? { id: "00000000-0000-4000-8000-00000000c4a5", email: "owner@example.com" } : {}), { status: ok ? 200 : 401 });
  }
  if (u.startsWith("http://auth-stub.local/rest/v1/")) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  if (u.startsWith("https://api.resend.com/")) {
    outbound.resend.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "re_test_" + outbound.resend.length }), { status: 200 });
  }
  if (u.startsWith("http://127.0.0.1") || u.startsWith("http://localhost")) return realFetch(url, init);
  throw new Error("gate harness blocked outbound fetch to " + u);
};
process.env.VITE_SUPABASE_URL = "http://auth-stub.local";
process.env.VITE_SUPABASE_ANON_KEY = "local-anon";

const FUNCTIONS = {};
export async function useFunctions(repo) {
  FUNCTIONS["send-nudge"] = (await import(`${repo}/netlify/functions/send-nudge.mjs`)).default;
  try { FUNCTIONS.health = (await import(`${repo}/netlify/functions/health.mjs`)).default; } catch { /* baseline has none */ }
}

// Block every request that isn't the local server: proves no live DB/network.
export async function newContext(browser, profile, base) {
  const ctx = await browser.newContext({ ...profile, timezoneId: "Africa/Johannesburg", locale: "en-ZA",
    permissions: ["clipboard-read", "clipboard-write"] });
  const blocked = [];
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    const u = req.url();
    const fn = /\/\.netlify\/functions\/([\w-]+)|\/api\/(health)$/.exec(new URL(u).pathname);
    if (u.startsWith(base) && fn) {
      const name = fn[1] ?? fn[2];
      if (!FUNCTIONS[name]) return route.fulfill({ status: 404, body: "not found" });
      const res = await FUNCTIONS[name](new Request(u, { method: req.method(), headers: req.headers(), body: req.postData() ?? undefined }));
      return route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
    }
    if (u.startsWith(base) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
    blocked.push(u);
    return route.abort();
  });
  // wa.me links are captured, never followed.
  await ctx.addInitScript(() => {
    window.__opened = [];
    window.open = (u) => { window.__opened.push(String(u)); return null; };
  });
  ctx.blocked = blocked;
  return ctx;
}

export async function dumpDb(page) { return JSON.parse((await page.evaluate((k) => localStorage.getItem(k), DB_KEY)) ?? "{}"); }

export function recorder() {
  const rows = [];
  return {
    rows,
    async check(name, fn) {
      try { const d = await fn(); rows.push({ name, ok: true, detail: d ?? "" }); console.log(`PASS  ${name}${d ? "  — " + d : ""}`); }
      catch (e) { rows.push({ name, ok: false, detail: String(e.message).split("\n")[0] }); console.log(`FAIL  ${name}  — ${String(e.message).split("\n")[0]}`); }
    },
  };
}
export const clean = (s) => String(s).replace(/[  ]/g, " ");
export function expect(cond, msg) { if (!cond) throw new Error(msg); }
