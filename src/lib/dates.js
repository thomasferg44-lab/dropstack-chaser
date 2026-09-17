// Dates are handled as "YYYY-MM-DD" strings (Postgres `date`). No timezones.

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function pad(n) {
  return String(n).padStart(2, "0");
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function build(y, m, d) {
  if (y < 1900 || y > 2200) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function year4(y) {
  const n = Number(y);
  if (y.length === 2) return 2000 + n;
  return n;
}

/**
 * Parse a flexible date string to "YYYY-MM-DD" or null.
 *
 * Day-first by default (South African convention):
 *   17/09/2026, 17-09-2026, 17.09.2026, 17/09/26
 * Also: ISO 2026-09-17 (with optional time), 2026/09/17,
 *   17 Sep 2026, 17 September 2026, Sep 17, 2026, 17-Sep-26,
 *   Excel serial numbers (e.g. 46012).
 * A numeric x/y/z where x ≤ 12 and y > 12 is unambiguously month-first
 * (US export) and is accepted as such.
 */
export function parseFlexibleDate(input) {
  if (input === null || input === undefined) return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return build(input.getFullYear(), input.getMonth() + 1, input.getDate());
  }
  let s = String(input).trim();
  if (s === "") return null;

  // ISO: 2026-09-17 or 2026/09/17, optionally followed by time
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));

  // Numeric day-first: 17/09/2026, 17-9-26, 17.09.2026 (optional trailing time)
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s].*)?$/);
  if (m) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    const y = year4(m[3]);
    if (a > 12 && b <= 12) return build(y, b, a); // clearly D/M
    if (a <= 12 && b > 12) return build(y, a, b); // clearly M/D
    return build(y, b, a); // ambiguous → day-first
  }

  // 17 Sep 2026 / 17-Sep-26 / 17 September, 2026
  m = s.match(/^(\d{1,2})[\s\-/.]*([A-Za-z]+)[\s\-/.,]*(\d{2}|\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return build(year4(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  }

  // Sep 17, 2026 / September 17 2026
  m = s.match(/^([A-Za-z]+)[\s\-/.]*(\d{1,2})[\s,\-/.]*(\d{2}|\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    return build(year4(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));
  }

  // Excel serial (days since 1899-12-30). Plausible range ≈ 1990–2100.
  if (/^\d{5}$/.test(s)) {
    const serial = Number(s);
    if (serial >= 32874 && serial <= 73415) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return build(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }

  return null;
}

/** Today as "YYYY-MM-DD" in the browser's local zone. */
export function todayISO(now = new Date()) {
  return build(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Add whole days to a "YYYY-MM-DD" string. */
export function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const r = new Date(t);
  return build(r.getUTCFullYear(), r.getUTCMonth() + 1, r.getUTCDate());
}

/** Whole days from `a` to `b` (both "YYYY-MM-DD"). Positive if b is later. */
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Days an invoice is overdue as of `today`. 0 or negative means not yet due. */
export function daysOverdue(dueOn, today = todayISO()) {
  return daysBetween(dueOn, today);
}

/** "YYYY-MM-DD" → "17 Sep 2026" for display. */
export function formatDate(iso, locale = "en-ZA") {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(y, m - 1, d));
}
