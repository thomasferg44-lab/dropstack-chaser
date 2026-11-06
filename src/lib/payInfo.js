// Pay-from-the-nudge: how the customer pays, from config. Every nudge in both
// channels ends with this block, because a reminder that says HOW to pay is
// the single highest-converting thing a chase message can carry.

/** An https payment link, or null. Anything else (http, javascript:, junk) is ignored. */
export function safePaymentLink(link) {
  if (typeof link !== "string" || !link.trim()) return null;
  try {
    const u = new URL(link.trim());
    return u.protocol === "https:" && u.hostname ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Bank details text. `paymentDetails` is the v1 name and still honoured. */
export function paymentInstructions(config) {
  return String(config?.paymentInstructions ?? config?.paymentDetails ?? "").trim();
}

/**
 * The "how to pay" block for one invoice, or "" when the business has set
 * neither instructions nor a link (the composer then warns the owner).
 */
export function buildPayLine(config, invoice) {
  const instructions = paymentInstructions(config);
  const link = safePaymentLink(config?.paymentLink);
  if (!instructions && !link) return "";
  const lines = ["How to pay:"];
  if (instructions) lines.push(instructions);
  if (invoice?.reference) lines.push(`Reference: ${invoice.reference}`);
  if (link) lines.push(`Pay online: ${link}`);
  return lines.join("\n");
}

/** What the composer checks before send: is the pay block really in the message? */
export function payCheck(config, invoice, text) {
  const instructions = paymentInstructions(config);
  const link = safePaymentLink(config?.paymentLink);
  const body = String(text ?? "");
  return {
    configured: Boolean(instructions || link),
    instructions: instructions ? body.includes(instructions) : null,
    link: link ? body.includes(link) : null,
    reference: invoice?.reference ? body.includes(invoice.reference) : null,
  };
}
