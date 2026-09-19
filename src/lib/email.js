// Browser side of the email channel. The message is rendered in the browser,
// but delivery happens in a Netlify Function so the Resend key stays server-side.
import { supabase } from "./supabase.js";

const ENDPOINT = "/.netlify/functions/send-nudge";

/**
 * Send one nudge email.
 * Resolves to { sent, blocked?, reason?, id? } or throws with a readable message.
 */
export async function sendNudgeEmail({ to, subject, body, tone, invoiceId }) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Your session expired — sign in again.");

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, subject, body, tone, invoiceId }),
    });
  } catch {
    throw new Error("Couldn't reach the send function. Is it running?");
  }

  // `npm run dev` serves the app but not the functions, so a 404 here is the
  // usual cause rather than a real failure.
  if (res.status === 404) {
    throw new Error("Send function not found — run `npx netlify dev` instead of `npm run dev`.");
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Send failed (${res.status})`);
  return payload;
}
