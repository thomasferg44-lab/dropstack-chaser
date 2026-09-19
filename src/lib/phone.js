// Phone normalisation, shared by the CSV importer and the nudge links.

/** Digits only; South African local "0xx…" becomes "27xx…". */
export function normalisePhone(raw) {
  if (!raw) return "";
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("0")) d = "27" + d.slice(1);
  return d;
}

/** A number usable in a wa.me link: international digits, no leading zero. */
export function isWhatsAppable(raw) {
  const d = normalisePhone(raw);
  return d.length >= 9 && d.length <= 15 && !d.startsWith("0");
}

/**
 * wa.me deep link. The owner sends from their own phone, so this targets the
 * CUSTOMER's number. Returns null when the number can't be used.
 */
export function waLink(phone, text) {
  if (!isWhatsAppable(phone)) return null;
  return `https://wa.me/${normalisePhone(phone)}?text=${encodeURIComponent(text)}`;
}
