// Shared between the browser and the Netlify Function so both agree on what a
// valid send request looks like. The function re-validates — never trust the
// client, even an authenticated one.

export const LIMITS = { subject: 200, body: 5000, to: 254 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TONES = ["gentle", "firm", "final"];
const STAGE_RE = /^[a-z0-9_-]{1,40}$/i;

export function isEmail(value) {
  return typeof value === "string" && value.length <= LIMITS.to && EMAIL_RE.test(value.trim());
}

/**
 * Validate a send request. Returns { ok, errors: string[], value } where
 * `value` is the trimmed, safe payload.
 *
 * Exactly one recipient: this tool nudges one customer about one invoice, and
 * an endpoint that accepts a list is an endpoint worth stealing a token for.
 */
export function validateEmailRequest(input) {
  const errors = [];
  const p = input && typeof input === "object" ? input : {};
  const to = typeof p.to === "string" ? p.to.trim() : "";
  const subject = typeof p.subject === "string" ? p.subject.trim() : "";
  const body = typeof p.body === "string" ? p.body : "";
  const tone = typeof p.tone === "string" ? p.tone : "";
  const invoiceId = typeof p.invoiceId === "string" ? p.invoiceId : "";
  const stage = typeof p.stage === "string" ? p.stage : null;

  if (!isEmail(to)) errors.push("A single valid recipient email is required");
  if (!subject) errors.push("Subject is required");
  if (subject.length > LIMITS.subject) errors.push(`Subject is over ${LIMITS.subject} characters`);
  if (!body.trim()) errors.push("Message body is required");
  if (body.length > LIMITS.body) errors.push(`Message is over ${LIMITS.body} characters`);
  if (!TONES.includes(tone)) errors.push("Tone must be gentle, firm or final");
  if (!UUID_RE.test(invoiceId)) errors.push("A valid invoice id is required");
  if (/[\r\n]/.test(subject)) errors.push("Subject cannot contain line breaks");
  if (stage !== null && !STAGE_RE.test(stage)) errors.push("Stage is not valid");

  return { ok: errors.length === 0, errors, value: { to, subject, body, tone, invoiceId, ...(stage ? { stage } : {}) } };
}

/**
 * Plain text → minimal HTML, so the email renders as written in every client.
 * https links (the payment link) become clickable; nothing else is trusted.
 */
export function textToHtml(text) {
  const escaped = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const linked = escaped.replace(/\bhttps:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}" style="color:#0066cc">${url}</a>`);
  return `<div style="white-space:pre-wrap;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:#111">${linked}</div>`;
}

/**
 * RFC 5322-safe From header. The display name is quoted when it contains
 * specials (a comma in "Smith, Jones & Co" would otherwise split it into two
 * addresses), and any line break or quote/backslash is neutralised so a config
 * value can never inject a header. No name → the bare address.
 */
export function formatFrom(name, email) {
  const addr = String(email ?? "").trim();
  const clean = String(name ?? "").replace(/[\r\n\t]+/g, " ").replace(/[<>]/g, "").trim();
  if (!clean) return addr;
  if (/^[\w !#$%&'*+\-/=?^`{|}~]+$/.test(clean)) return `${clean} <${addr}>`;
  return `"${clean.replace(/["\\]/g, (c) => "\\" + c)}" <${addr}>`;
}
