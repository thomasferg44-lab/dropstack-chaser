// Nudge message rendering. Pure: invoice + tone + channel → the exact text
// the owner will send. Templates live in companyConfig.js so a client deploy
// can reword them without touching code.

import { formatCents, outstandingCents } from "./money.js";
import { formatDate, daysOverdue, todayISO, isoFromTimestamp } from "./dates.js";
import { waLink, isWhatsAppable } from "./phone.js";
import { buildPayLine, paymentInstructions } from "./payInfo.js";
import { promiseState, brokenCount } from "./promises.js";

export const TONES = [
  { key: "gentle", label: "Gentle", hint: "assumes it was overlooked" },
  { key: "firm", label: "Firm", hint: "states the amount, asks for a date" },
  { key: "final", label: "Final", hint: "professional, states next steps" },
];

export const CHANNELS = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "email", label: "Email" },
];

/**
 * Placeholder values for one invoice.
 *
 * {amount} is what is STILL OWED, not the invoice total — quoting the full
 * amount to someone who has already part-paid is the fastest way to lose the
 * client's trust. {invoiceTotal} and {amountPaid} are available for templates
 * that want to spell the split out.
 */
export function buildNudgeVars(invoice, config, today = todayISO()) {
  const { locale } = config;
  const currency = invoice.currency || config.currency;
  const days = daysOverdue(invoice.due_on, today);
  return {
    customerName: invoice.customer?.name || "there",
    businessName: config.businessName,
    ownerName: config.ownerName || config.businessName,
    amount: formatCents(outstandingCents(invoice), currency, locale),
    invoiceTotal: formatCents(invoice.amount_cents, currency, locale),
    amountPaid: formatCents(invoice.amount_paid_cents || 0, currency, locale),
    reference: invoice.reference || "—",
    daysOverdue: String(Math.max(0, days)),
    dueDate: formatDate(invoice.due_on, locale),
    paymentDetails: paymentInstructions(config),
    payLine: buildPayLine(config, invoice),
    jobPhrase: jobPhrase(invoice.description),
    paidLine: paidLine(invoice, currency, locale),
    promiseLine: promiseLine(invoice, today, locale),
  };
}

// ---- context lines: what makes a nudge read as written for this customer ----

const ORDINAL = ["", "first", "second", "third", "fourth", "fifth"];

/** " for the geyser replacement" from the description, or "". */
export function jobPhrase(description) {
  let d = String(description ?? "").replace(/\s+/g, " ").trim().replace(/[.;:,]+$/, "");
  if (!d) return "";
  if (d.length > 60) d = d.slice(0, 57).replace(/\s+\S*$/, "") + "…";
  // Lower-case a leading capital unless the word is an acronym ("DB board").
  if (/^[A-Z][a-z]/.test(d)) d = d[0].toLowerCase() + d.slice(1);
  return /^(the|a|an|your|our)\b/i.test(d) ? ` for ${d}` : ` for the ${d}`;
}

/** Thanks for what was already paid, on a part-paid invoice. */
export function paidLine(invoice, currency, locale) {
  const paid = Number(invoice.amount_paid_cents || 0);
  if (paid <= 0 || paid >= Number(invoice.amount_cents)) return "";
  return ` Thanks for the ${formatCents(paid, currency, locale)} already paid.`;
}

/**
 * The customer's own words, played back: a promise they made and whether it
 * held. Factual, never accusatory.
 */
export function promiseLine(invoice, today, locale) {
  const ps = promiseState(invoice, invoice.promises, today);
  if (!ps.promise) return "";
  const promised = formatDate(ps.promise.promised_on, locale);
  if (ps.state === "broken") {
    const logged = isoFromTimestamp(ps.promise.created_at);
    const said = logged ? `On ${formatDate(logged, locale)} you mentioned` : "You mentioned";
    const earlier = brokenCount(invoice, invoice.promises, today) - 1; // the newest one is counted too
    const repeat = earlier > 0 && ORDINAL[earlier + 1] ? ` This is the ${ORDINAL[earlier + 1]} payment date that has passed.` : "";
    return ` ${said} paying by ${promised}, and it hasn't come through yet.${repeat}`;
  }
  if (ps.state === "pending" || ps.state === "due-today") {
    return ` Thanks for letting me know you'll pay by ${ps.state === "due-today" ? "today" : promised}. The details are below to make it easy.`;
  }
  return "";
}

/**
 * Substitute {placeholders}. Unknown placeholders are left alone so a typo in
 * a client's template is visible in the preview rather than silently blank.
 * Empty values leave tidy text: no double spaces, no stranded blank lines.
 */
export function renderTemplate(template, vars) {
  const out = String(template || "").replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Template lookup with a clear error rather than a blank message. */
export function getTemplate(config, channel, tone) {
  const t = config.nudgeTemplates?.[channel]?.[tone];
  if (!t) throw new Error(`No ${channel} template for tone "${tone}" in companyConfig.js`);
  return t;
}

/**
 * The full rendered nudge.
 * WhatsApp → { channel, tone, body, url, canSend, blockedReason }
 * Email    → { channel, tone, subject, body, to, canSend, blockedReason }
 */
export function renderNudge(invoice, { tone, channel, config, today = todayISO() }) {
  const vars = buildNudgeVars(invoice, config, today);
  const template = getTemplate(config, channel, tone);

  if (channel === "whatsapp") {
    const body = renderTemplate(template, vars);
    const phone = invoice.customer?.phone;
    return {
      channel,
      tone,
      body,
      url: waLink(phone, body),
      canSend: isWhatsAppable(phone),
      blockedReason: isWhatsAppable(phone)
        ? null
        : phone
          ? "That phone number isn't usable for WhatsApp — add the country code."
          : "No phone number on this customer.",
    };
  }

  const email = invoice.customer?.email;
  return {
    channel,
    tone,
    subject: renderTemplate(template.subject, vars),
    body: renderTemplate(template.body, vars),
    to: email || null,
    canSend: Boolean(email),
    blockedReason: email ? null : "No email address on this customer.",
  };
}
