import { test } from "node:test";
import assert from "node:assert/strict";
import { agedBucketFor, agedSummary, bucketShares, AGED_BUCKETS } from "../src/lib/aged.js";

const TODAY = "2026-11-05";
const inv = (due, amount, paid = 0, status = paid >= amount ? "paid" : paid > 0 ? "partial" : "unpaid") => ({ due_on: due, amount_cents: amount, amount_paid_cents: paid, status });

test("bucket boundaries 0/1/30/31/60/61/90/91", () => {
  const cases = [[-3, "current"], [0, "current"], [1, "d1_30"], [30, "d1_30"], [31, "d31_60"], [60, "d31_60"], [61, "d61_90"], [90, "d61_90"], [91, "d90p"], [400, "d90p"]];
  for (const [d, k] of cases) assert.equal(agedBucketFor(d), k, `${d} days`);
});

test("hand-checked totals including a partial payment, exact cents", () => {
  const list = [
    inv("2026-11-20", 100000),             // current        1 000,00
    inv("2026-11-05", 5),                  // due today      0,05 (current, falls due today)
    inv("2026-11-04", 150050),             // 1 day          1 500,50
    inv("2026-10-06", 45000, 15000),       // 30 days, part  owes 300,00
    inv("2026-10-05", 120000),             // 31 days        1 200,00
    inv("2026-09-06", 99999),              // 60 days        999,99
    inv("2026-09-05", 1234567, 500000),    // 61 days, part  owes 7 345,67
    inv("2026-08-07", 10),                 // 90 days        0,10
    inv("2026-08-06", 250000),             // 91 days        2 500,00
    inv("2026-01-01", 500000, 500000),     // paid: excluded
    { ...inv("2025-01-01", 800000), status: "written_off" }, // excluded
  ];
  const s = agedSummary(list, TODAY);
  assert.deepEqual(s.buckets.current, { total: 100005, count: 2 });
  assert.deepEqual(s.buckets.d1_30, { total: 180050, count: 2 });
  assert.deepEqual(s.buckets.d31_60, { total: 219999, count: 2 });
  assert.deepEqual(s.buckets.d61_90, { total: 734577, count: 2 });
  assert.deepEqual(s.buckets.d90p, { total: 250000, count: 1 });
  // 1000.00+0.05+1500.50+300.00+1200.00+999.99+7345.67+0.10+2500.00 = 14 846,31
  assert.equal(s.outstanding, 1484631);
  assert.equal(s.outstanding, AGED_BUCKETS.reduce((a, b) => a + s.buckets[b.key].total, 0));
  assert.equal(s.count, 9);
  assert.equal(s.overdueCount, 7);
  assert.equal(s.overdueCents, 1484631 - 100005);
  assert.equal(s.fallingDueToday, 1);
  assert.equal(s.oldestDays, 91);
  for (const v of [s.outstanding, ...Object.values(s.buckets).map((b) => b.total)]) assert.ok(Number.isInteger(v));
});

test("empty and all-paid books", () => {
  const s = agedSummary([inv("2026-10-01", 100, 100)], TODAY);
  assert.equal(s.outstanding, 0);
  assert.equal(s.oldestDays, 0);
  assert.deepEqual(bucketShares(s.buckets), { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0 });
});

test("bar shares always sum to exactly 100", () => {
  const shares = bucketShares({ current: { total: 1 }, d1_30: { total: 1 }, d31_60: { total: 1 }, d61_90: { total: 0 }, d90p: { total: 0 } });
  assert.equal(Object.values(shares).reduce((a, b) => a + b, 0), 100);
  const s = agedSummary([inv("2026-11-20", 333), inv("2026-10-01", 667)], TODAY);
  assert.deepEqual(bucketShares(s.buckets), { current: 33, d1_30: 0, d31_60: 67, d61_90: 0, d90p: 0 });
});
