// Aged-debtors summary for the hero strip: Current / 1–30 / 31–60 / 61–90 /
// 90+ days overdue. Every figure is summed from stored integer cents on each
// call; nothing is cached. (aging.js keeps the v1 four-bucket split, which its
// tests pin; the dashboard now uses this one.)
import { outstandingCents, sumCents } from "./money.js";
import { daysOverdue } from "./dates.js";

export const AGED_BUCKETS = [
  { key: "current", label: "Not yet due", short: "Current", tone: "info" },
  { key: "d1_30", label: "1–30 days", short: "1–30", tone: "warn" },
  { key: "d31_60", label: "31–60 days", short: "31–60", tone: "warn" },
  { key: "d61_90", label: "61–90 days", short: "61–90", tone: "bad" },
  { key: "d90p", label: "90+ days", short: "90+", tone: "bad" },
];

/** Bucket for a number of days overdue. Due today (0) is not overdue. */
export function agedBucketFor(days) {
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90p";
}

const isOpen = (inv) => inv.status === "unpaid" || inv.status === "partial";

/**
 * { outstanding, count, overdueCount, overdueCents, fallingDueToday, oldestDays,
 *   buckets: { key: { total, count } } } over open invoices only.
 */
export function agedSummary(invoices, today) {
  const open = (invoices || []).filter(isOpen).map((inv) => {
    const days = daysOverdue(inv.due_on, today);
    return { days, owed: outstandingCents(inv), bucket: agedBucketFor(days) };
  });
  const buckets = Object.fromEntries(AGED_BUCKETS.map((b) => [b.key, { total: 0, count: 0 }]));
  for (const o of open) {
    buckets[o.bucket].total += o.owed;
    buckets[o.bucket].count += 1;
  }
  const overdue = open.filter((o) => o.days > 0);
  return {
    outstanding: sumCents(open.map((o) => o.owed)),
    count: open.length,
    overdueCount: overdue.length,
    overdueCents: sumCents(overdue.map((o) => o.owed)),
    fallingDueToday: open.filter((o) => o.days === 0).length,
    oldestDays: overdue.length ? Math.max(...overdue.map((o) => o.days)) : 0,
    buckets,
  };
}

/** Bar widths for the aged strip, in whole percent, summing to 100 (or all 0). */
export function bucketShares(buckets) {
  const total = sumCents(AGED_BUCKETS.map((b) => buckets[b.key].total));
  if (total === 0) return Object.fromEntries(AGED_BUCKETS.map((b) => [b.key, 0]));
  // Largest-remainder rounding so the bar never over- or under-fills.
  const raw = AGED_BUCKETS.map((b) => ({ key: b.key, exact: (buckets[b.key].total * 100) / total }));
  const out = Object.fromEntries(raw.map((r) => [r.key, Math.floor(r.exact)]));
  let left = 100 - Object.values(out).reduce((a, b) => a + b, 0);
  for (const r of [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
    if (left <= 0) break;
    out[r.key] += 1;
    left -= 1;
  }
  return out;
}
