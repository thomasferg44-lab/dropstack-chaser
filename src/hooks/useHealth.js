import { useEffect, useState } from "react";
import { companyConfig } from "../../companyConfig.js";
import { checkHealth } from "../lib/health.js";
import { isMockBackend } from "../lib/supabase.js";

// Production: GET /api/health (the Netlify Function). Local test backend: the
// same checkHealth() against a stand-in fetch that honours the mock's failure
// switch, so the status line can be exercised without a network.
async function fetchHealth() {
  if (isMockBackend) {
    let fail = null;
    try { fail = localStorage.getItem("dropstack-mock-fail"); } catch { /* ignore */ }
    return checkHealth({
      config: companyConfig,
      env: { supabaseUrl: "https://local-test-backend.invalid", supabaseAnonKey: "local", resendApiKey: "", devBlockRealSends: undefined },
      fetchImpl: async () => { if (fail === "all" || fail === "db") throw new TypeError("Failed to fetch"); return new Response("[]", { status: 200 }); },
    });
  }
  try {
    const res = await fetch("/api/health", { headers: { Accept: "application/json" }, cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.includes("json")) return { error: "unavailable" }; // e.g. plain `vite dev`: use `netlify dev`
    return await res.json();
  } catch {
    return { error: "unavailable" };
  }
}

// Shared across the shell: one check at start, then every 60s while visible.
// (In-app polling only while the owner has it open; nothing external pings it.)
let cache = null;
const subs = new Set();
let timer = null;
async function refresh() {
  cache = await fetchHealth();
  for (const s of subs) s(cache);
}
export default function useHealth() {
  const [h, setH] = useState(cache);
  useEffect(() => {
    subs.add(setH);
    if (!cache) refresh();
    if (!timer) timer = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 60000);
    return () => { subs.delete(setH); if (!subs.size) { clearInterval(timer); timer = null; } };
  }, []);
  return h;
}
