// GET /api/health (redirect in netlify.toml). Read-only, no secrets in the
// response: booleans for database reachability, config presence and which
// server-side pieces are configured. Never schedule anything to ping this;
// the endpoint itself is the deliverable.
import { companyConfig } from "../../companyConfig.js";
import { checkHealth } from "../../src/lib/health.js";

export default async function handler(req) {
  if (req && req.method && req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "content-type": "application/json" } });
  }
  const env = {
    supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "",
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    devBlockRealSends: process.env.DEV_BLOCK_REAL_SENDS,
  };
  const body = await checkHealth({ config: companyConfig, env, fetchImpl: fetch, timeoutMs: 4000 });
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
