import { test } from "node:test";
import assert from "node:assert/strict";
import { checkHealth, configPresence, healthSummary, probeDatabase, realEmail } from "../src/lib/health.js";
import handler from "../netlify/functions/health.mjs";
import { companyConfig } from "../companyConfig.js";

const KEY = "anon-PRIVATE-key";
const ENV = { supabaseUrl: "https://abc.supabase.co", supabaseAnonKey: KEY, resendApiKey: "re_PRIVATE", devBlockRealSends: undefined };
const answer = async () => new Response(JSON.stringify({ code: "42501", message: "permission denied" }), { status: 401 });

test("reachable when PostgREST answers (even with a permission error); not on 5xx, HTML or a throw", async () => {
  assert.equal((await probeDatabase({ ...ENV, fetchImpl: answer })).reachable, true);
  assert.equal((await probeDatabase({ ...ENV, fetchImpl: async () => new Response("[]", { status: 200 }) })).reachable, true);
  assert.equal((await probeDatabase({ ...ENV, fetchImpl: async () => new Response("<html>", { status: 503 }) })).reachable, false);
  assert.equal((await probeDatabase({ ...ENV, fetchImpl: async () => { throw new TypeError("Failed to fetch"); } })).reachable, false);
  assert.equal((await probeDatabase({ supabaseUrl: "", supabaseAnonKey: "", fetchImpl: answer })).reachable, false);
});

test("the probe is a zero-row GET: no write", async () => {
  let seen;
  await probeDatabase({ ...ENV, fetchImpl: async (url, init) => { seen = { url, init }; return answer(); } });
  assert.equal(seen.init.method, "GET");
  assert.match(seen.url, /\/rest\/v1\/chaser_invoices\?select=id&limit=0$/);
});

test("booleans only: no key, URL, address or name in the response", async () => {
  const h = await checkHealth({ config: companyConfig, env: ENV, fetchImpl: answer });
  const json = JSON.stringify(h);
  for (const s of ["PRIVATE", "abc.supabase.co", "example.com", companyConfig.businessName, "0000000000"]) assert.ok(!json.includes(s), s);
  for (const v of [...Object.values(h.config), ...Object.values(h.functions), h.database, h.ok, h.healthy, h.configComplete]) assert.equal(typeof v, "boolean");
});

test("placeholder config is reported as missing, not as present", () => {
  const p = configPresence(companyConfig, ENV);
  assert.equal(p.fromEmail, false, "example.com sender is a placeholder");
  assert.equal(p.paymentInstructions, false, "all-zero bank details are a placeholder");
  assert.equal(realEmail("accounts@plumbing.co.za"), true);
  assert.equal(realEmail("x@demo.invalid"), false);
});

test("status line wording", () => {
  assert.equal(healthSummary(null).text, "Checking status…");
  assert.equal(healthSummary({ error: "x" }).text, "Status check unavailable");
  assert.equal(healthSummary({ database: false }).text, "Database not reachable");
  assert.equal(healthSummary({ database: true, configComplete: true, config: { paymentInstructions: false, paymentLink: false, fromEmail: false } }).text, "Connected · add payment details and sender email");
  assert.equal(healthSummary({ database: true, configComplete: true, config: { paymentInstructions: true, fromEmail: true }, functions: { realSendsEnabled: false } }).text, "Connected · email in test mode");
  assert.equal(healthSummary({ database: true, configComplete: true, config: { paymentInstructions: true, fromEmail: true }, functions: { realSendsEnabled: true } }).tone, "good");
});

test("the Netlify handler end to end (GET only, JSON, no-store)", async () => {
  const realFetch = globalThis.fetch;
  process.env.VITE_SUPABASE_URL = "https://abc.supabase.co";
  process.env.VITE_SUPABASE_ANON_KEY = KEY;
  globalThis.fetch = answer;
  try {
    const res = await handler(new Request("https://x/api/health"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.database, true);
    assert.ok(!JSON.stringify(body).includes("PRIVATE"));
    assert.equal((await handler(new Request("https://x/api/health", { method: "POST" }))).status, 405);
  } finally {
    globalThis.fetch = realFetch;
  }
});
