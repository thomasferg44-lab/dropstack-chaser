// Tool health, shared by the Netlify Function (netlify/functions/health.mjs)
// and the status line in the app shell. Pure: fetch, env and config come in.
//
// Booleans only: never a key, URL, address, number or name.
//   ok          the endpoint answered (always true when you get a body)
//   healthy     database reachable AND required config present
//   database    PostgREST + Postgres answered a read-only probe in time
//   functions.* which server-side pieces are configured (email key present,
//               real sends switched on)
//   config.*    which settings are present
//
// The probe asks for zero rows of chaser_invoices with the anon key. anon has
// no access, so Postgres answers with a permission error, which proves the
// API and the database are both up without reading or writing any data.
import { safePaymentLink, paymentInstructions } from "./payInfo.js";

const present = (v) => typeof v === "string" && v.trim().length > 0;
// example.com/.org/.net and .invalid/.test can never deliver: a placeholder.
const PLACEHOLDER_EMAIL = /@(?:[\w-]+\.)*(example\.(?:com|org|net)|[\w-]+\.(?:invalid|test|example))$/i;
export const realEmail = (v) => present(v) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && !PLACEHOLDER_EMAIL.test(v.trim());

export function configPresence(config, env = {}) {
  return {
    businessName: present(config?.businessName),
    paymentInstructions: present(paymentInstructions(config)) && !/0{6,}/.test(paymentInstructions(config)),
    paymentLink: Boolean(safePaymentLink(config?.paymentLink)),
    fromEmail: realEmail(config?.fromEmail),
    replyToEmail: realEmail(config?.replyToEmail),
    supabaseUrl: /^https:\/\//.test(env.supabaseUrl ?? ""),
    supabaseAnonKey: present(env.supabaseAnonKey),
  };
}

export function functionPresence(env = {}) {
  return {
    sendNudge: true, // this function ships in the same deploy as health.mjs
    resendKey: present(env.resendApiKey),
    realSendsEnabled: env.devBlockRealSends === "false",
  };
}

export const REQUIRED_CONFIG = ["businessName", "supabaseUrl", "supabaseAnonKey"];

export async function probeDatabase({ supabaseUrl, supabaseAnonKey, fetchImpl, timeoutMs = 4000, now = () => Date.now() }) {
  if (!/^https?:\/\//.test(supabaseUrl ?? "") || !present(supabaseAnonKey)) return { reachable: false, latencyMs: null };
  const started = now();
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/chaser_invoices?select=id&limit=0`, {
      method: "GET",
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, Accept: "application/json" },
      signal: ctrl?.signal,
    });
    // 200 (empty) or a Postgres permission error (401/403 with a JSON body)
    // both mean PostgREST reached Postgres. 5xx / HTML / no answer do not.
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    const reachable = res.status < 500 && body !== null;
    return { reachable, latencyMs: now() - started };
  } catch {
    return { reachable: false, latencyMs: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkHealth({ config, env, fetchImpl, timeoutMs, now = () => Date.now() }) {
  const presence = configPresence(config, env);
  const db = await probeDatabase({ ...env, fetchImpl, timeoutMs, now });
  const configComplete = REQUIRED_CONFIG.every((k) => presence[k]);
  return {
    ok: true,
    healthy: db.reachable && configComplete,
    database: db.reachable,
    databaseLatencyMs: db.latencyMs,
    configComplete,
    config: presence,
    functions: functionPresence(env),
    checkedAt: new Date(now()).toISOString(),
  };
}

/** One short line for the shell. */
export function healthSummary(h) {
  if (!h) return { tone: "unknown", text: "Checking status…" };
  if (h.error) return { tone: "unknown", text: "Status check unavailable" };
  if (!h.database) return { tone: "bad", text: "Database not reachable" };
  if (!h.configComplete) return { tone: "bad", text: "Setup incomplete" };
  const missing = [];
  if (!h.config.paymentInstructions && !h.config.paymentLink) missing.push("payment details");
  if (!h.config.fromEmail) missing.push("sender email");
  if (missing.length) return { tone: "warn", text: `Connected · add ${missing.join(" and ")}` };
  if (h.functions && !h.functions.realSendsEnabled) return { tone: "good", text: "Connected · email in test mode" };
  return { tone: "good", text: "All systems normal" };
}
