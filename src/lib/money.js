// Money = integer minor units (cents). Nothing in this file ever produces a
// float that represents money. Parsing is string → integer; formatting is
// integer → string. Division only happens here, at the display edge, and it
// is integer division.

const CURRENCY_NOISE = /[^\d.,\-()]/g; // strips "R", "ZAR", "$", "€", spaces, NBSP…

/**
 * Parse a human-entered amount into integer cents.
 *
 * Accepts: "1999", "19.99", "R 1 999,50", "R1,999.50", "$1,999", "1.999,50",
 * "(50.00)" or "-50.00" (negative), 1999 (number), "" (empty → null).
 *
 * Separator rules (documented in README):
 *  - Whitespace and any non-numeric symbols are ignored.
 *  - If both "," and "." appear, the LAST one is the decimal separator.
 *  - A lone "." is always a decimal point.
 *  - A lone "," is a decimal comma if followed by 1–2 digits ("1,50"),
 *    a thousands separator if followed by exactly 3 digits ("1,500").
 *  - More than two decimal digits is an error (we never round stored data).
 *
 * @returns {{ cents: number|null, error: string|null }}
 */
export function parseAmountToCents(input) {
  if (input === null || input === undefined) return { cents: null, error: null };
  let s = typeof input === "number" ? String(input) : String(input);
  s = s.trim();
  if (s === "") return { cents: null, error: null };

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(CURRENCY_NOISE, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (s === "" || /[-()]/.test(s)) return { cents: null, error: "Not a number" };

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let intPart = s;
  let fracPart = "";

  const split = (idx) => {
    intPart = s.slice(0, idx);
    fracPart = s.slice(idx + 1);
  };

  if (lastComma !== -1 && lastDot !== -1) {
    split(Math.max(lastComma, lastDot));
  } else if (lastDot !== -1) {
    if (s.indexOf(".") !== lastDot) {
      // "1.234.567" → multiple dots = thousands separators
      intPart = s;
      fracPart = "";
    } else {
      split(lastDot);
    }
  } else if (lastComma !== -1) {
    const after = s.length - lastComma - 1;
    const single = s.indexOf(",") === lastComma;
    if (single && after >= 1 && after <= 2) split(lastComma);
    else if (after === 3) {
      intPart = s; // thousands
      fracPart = "";
    } else if (single) split(lastComma);
    else return { cents: null, error: "Ambiguous number format" };
  }

  // Any separators left in the integer part are thousands separators: every
  // group after the first must be exactly 3 digits ("1.234.567" ok, "1.2.3" not).
  if (/[.,]/.test(intPart)) {
    const groups = intPart.split(/[.,]/);
    if (groups.slice(1).some((g) => g.length !== 3) || groups[0].length === 0 || groups[0].length > 3) {
      return { cents: null, error: "Ambiguous number format" };
    }
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (/[.,]/.test(fracPart)) return { cents: null, error: "Ambiguous number format" };

  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) {
    return { cents: null, error: "Not a number" };
  }
  if (intPart === "" && fracPart === "") return { cents: null, error: "Not a number" };
  if (fracPart.length > 2) {
    return { cents: null, error: "More than 2 decimal places" };
  }
  if (intPart.length > 13) return { cents: null, error: "Amount too large" };

  const centsStr = (intPart || "0") + fracPart.padEnd(2, "0");
  let cents = Number(centsStr); // integer; safe well below 2^53
  if (negative) cents = -cents;
  return { cents, error: null };
}

/** Integer cents → "R 1 999,50" per locale/currency. Display only. */
export function formatCents(cents, currency = "ZAR", locale = "en-ZA") {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return "—";
  const n = Number(cents);
  if (!Number.isInteger(n)) throw new Error("formatCents expects integer cents");
  const negative = n < 0;
  const abs = Math.abs(n);
  const whole = Math.trunc(abs / 100); // integer division on an integer
  const frac = abs % 100;

  // Let Intl do symbol + grouping for the whole part, then splice our exact
  // 2-digit fraction in. This avoids ever passing a float to the formatter.
  const fmt = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const parts = fmt.formatToParts(whole);
  let out = "";
  for (const p of parts) {
    if (p.type === "fraction") out += String(frac).padStart(2, "0");
    else if (p.type === "minusSign") continue;
    else out += p.value;
  }
  return negative ? "-" + out : out;
}

/** Integer cents → plain "1999.50" (for editable inputs). */
export function centsToInput(cents) {
  if (cents === null || cents === undefined) return "";
  const n = Number(cents);
  const negative = n < 0;
  const abs = Math.abs(n);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  return `${negative ? "-" : ""}${whole}.${String(frac).padStart(2, "0")}`;
}

/** Sum an array of integer cents. Throws on non-integers so drift can't hide. */
export function sumCents(values) {
  let total = 0;
  for (const v of values) {
    const n = Number(v);
    if (!Number.isInteger(n)) throw new Error(`sumCents: non-integer ${v}`);
    total += n;
  }
  return total;
}

/** Amount still owed on an invoice. Never negative. */
export function outstandingCents(invoice) {
  const owed = Number(invoice.amount_cents) - Number(invoice.amount_paid_cents || 0);
  return owed > 0 ? owed : 0;
}
