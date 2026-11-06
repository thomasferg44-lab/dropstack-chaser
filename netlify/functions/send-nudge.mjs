// POST /.netlify/functions/send-nudge
//
// Sends one nudge email through Resend. Server-side only: RESEND_API_KEY must
// never reach the browser, so it is read from the environment here and is not
// VITE_ prefixed.
//
// Safety: DEV_BLOCK_REAL_SENDS defaults to blocking. Nothing is sent unless it
// is explicitly "false", which is set in the Netlify dashboard and never in a
// committed file. A blocked call returns 200 with { sent: false, blocked: true }
// so the UI can say plainly that nothing left the building.

import { validateEmailRequest, textToHtml, formatFrom } from "../../src/lib/nudgeEmail.js";
import { companyConfig } from "../../companyConfig.js";

const json = (status, payload) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Verify the caller's Supabase session. Returns the user, or null. */
async function authenticate(req) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!token || !url || !anonKey) return null;

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

export default async function handler(req) {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // Owner-only, exactly like the tables. An unauthenticated endpoint that
  // sends mail from the client's domain is a spam relay.
  const user = await authenticate(req);
  if (!user) return json(401, { error: "Not signed in" });

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "Body must be JSON" });
  }

  const { ok, errors, value } = validateEmailRequest(payload);
  if (!ok) return json(400, { error: errors.join(". ") });

  const from = companyConfig.fromEmail;
  if (!from) return json(500, { error: "fromEmail is not set in companyConfig.js" });

  const blocked = process.env.DEV_BLOCK_REAL_SENDS !== "false";
  if (blocked) {
    console.log(
      `[send-nudge] BLOCKED (DEV_BLOCK_REAL_SENDS is not "false"). Would have sent:\n` +
        `  to: ${value.to}\n  subject: ${value.subject}\n  tone: ${value.tone}\n  invoice: ${value.invoiceId}\n` +
        `  body:\n${value.body}`,
    );
    return json(200, {
      sent: false,
      blocked: true,
      reason: 'Blocked by DEV_BLOCK_REAL_SENDS. The message was logged, not sent.',
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return json(500, { error: "RESEND_API_KEY is not set" });

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: formatFrom(companyConfig.fromName, from),
        to: [value.to],
        ...(companyConfig.replyToEmail ? { reply_to: companyConfig.replyToEmail } : {}),
        subject: value.subject,
        text: value.body,
        html: textToHtml(value.body),
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[send-nudge] Resend rejected the send", res.status, data);
      return json(502, { error: data?.message || `Resend returned ${res.status}` });
    }
    return json(200, { sent: true, id: data?.id || null });
  } catch (e) {
    console.error("[send-nudge] send failed", e);
    return json(502, { error: "Could not reach Resend" });
  }
}
