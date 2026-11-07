// Aging buckets and the headline numbers. Everything is computed from stored
// integer cents on every call — nothing here is cached anywhere.
import { outstandingCents, sumCents } from "./money.js";
import { daysOverdue, todayISO } from "./dates.js";

export const BUCKETS = [
  { key: "current", label: "Current", hint: "not yet due" },
  { key: "due", label: "1–30 days", hint: "overdue" },
  { key: "late", label: "31–60 days", hint: "overdue" },
  { key: "critical", label: "60+ days", hint: "overdue" },
];

/** Bucket key for a number of days overdue (≤ 0 = not yet due). */
export function bucketFor(days) {
  if (days <= 0) return "current";
  if (days <= 30) return "due";
  if (days <= 60) return "late";
  return "critical";
}

/** An invoice still owes money and hasn't been written off. */
export function isOpen(inv) {
  return inv.status === "unpaid" || inv.status === "partial";
}

/** Annotate open invoices with days overdue, bucket and owed cents. */
export function enrich(invoices, today = todayISO()) {
  return invoices.map((inv) => {
    const days = daysOverdue(inv.due_on, today);
    return { ...inv, daysOverdue: days, bucket: bucketFor(days), owedCents: outstandingCents(inv) };
  });
}

/**
 * Headline + bucket totals over the OPEN invoices only.
 * { outstanding, count, oldestDays, buckets: { key: { total, count } } }
 */
export function summarise(invoices, today = todayISO()) {
  const open = enrich(invoices.filter(isOpen), today);
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b.key, { total: 0, count: 0 }]));
  for (const inv of open) {
    buckets[inv.bucket].total += inv.owedCents;
    buckets[inv.bucket].count += 1;
  }
  return {
    outstanding: sumCents(open.map((i) => i.owedCents)),
    count: open.length,
    oldestDays: open.length ? Math.max(...open.map((i) => i.daysOverdue)) : 0,
    buckets,
  };
}

/** Most overdue first; ties broken by larger amount owed. */
export function sortMostOverdue(enriched) {
  return [...enriched].sort((a, b) => b.daysOverdue - a.daysOverdue || b.owedCents - a.owedCents);
}
