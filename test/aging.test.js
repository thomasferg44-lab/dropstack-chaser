import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketFor, summarise, enrich, sortMostOverdue } from "../src/lib/aging.js";

const TODAY = "2026-09-18";
const inv = (due, amount, paid = 0, status = paid >= amount ? "paid" : paid > 0 ? "partial" : "unpaid") => ({
  id: due + amount, due_on: due, amount_cents: amount, amount_paid_cents: paid, status,
});

test("bucket boundaries", () => {
  assert.equal(bucketFor(-5), "current");
  assert.equal(bucketFor(0), "current"); // due today is not overdue
  assert.equal(bucketFor(1), "due");
  assert.equal(bucketFor(30), "due");
  assert.equal(bucketFor(31), "late");
  assert.equal(bucketFor(60), "late");
  assert.equal(bucketFor(61), "critical");
  assert.equal(bucketFor(400), "critical");
});

test("summarise places invoices by due_on relative to today and sums exact cents", () => {
  const list = [
    inv("2026-10-01", 100000),            // current, 1000.00
    inv("2026-09-18", 5),                 // due today → current, 0.05
    inv("2026-09-17", 150000),            // 1 day → due
    inv("2026-08-19", 45000),             // 30 days → due
    inv("2026-08-18", 120000, 20000),     // 31 days → late, owes 1000.00
    inv("2026-07-20", 1234567, 500000),   // 60 days → late, owes 7345.67
    inv("2026-07-19", 99),                // 61 days → critical
    inv("2026-01-01", 500000, 500000),    // paid → excluded
    { ...inv("2025-01-01", 800000), status: "written_off" }, // excluded
  ];
  const s = summarise(list, TODAY);
  assert.equal(s.count, 7);
  assert.equal(s.oldestDays, 61);
  assert.deepEqual(s.buckets.current, { total: 100005, count: 2 });
  assert.deepEqual(s.buckets.due, { total: 195000, count: 2 });
  assert.deepEqual(s.buckets.late, { total: 834567, count: 2 });
  assert.deepEqual(s.buckets.critical, { total: 99, count: 1 });
  // hand check: 1000.00 + 0.05 + 1500.00 + 450.00 + 1000.00 + 7345.67 + 0.99 = 11296.71
  assert.equal(s.outstanding, 1129671);
  assert.equal(s.outstanding, 100005 + 195000 + 834567 + 99);
});

test("empty set", () => {
  const s = summarise([], TODAY);
  assert.equal(s.outstanding, 0);
  assert.equal(s.count, 0);
  assert.equal(s.oldestDays, 0);
});

test("sortMostOverdue", () => {
  const e = enrich([inv("2026-09-10", 100), inv("2026-07-01", 100), inv("2026-07-01", 900), inv("2026-12-01", 100)], TODAY);
  assert.deepEqual(sortMostOverdue(e).map((i) => [i.due_on, i.amount_cents]), [
    ["2026-07-01", 900], ["2026-07-01", 100], ["2026-09-10", 100], ["2026-12-01", 100],
  ]);
});
