import { test } from "node:test";
import assert from "node:assert/strict";
import { planPayment, fullPaymentInput } from "../src/lib/payment.js";
import { summarise } from "../src/lib/aging.js";
import { sumCents, formatCents, outstandingCents } from "../src/lib/money.js";

const invoice = (over = {}) => ({
  amount_cents: 150000, amount_paid_cents: 0, status: "unpaid", due_on: "2026-08-20", currency: "ZAR", ...over,
});

test("a partial payment leaves the right balance and status", () => {
  const p = planPayment(invoice(), "500");
  assert.ok(p.ok);
  assert.equal(p.amountCents, 50000);
  assert.equal(p.newPaidCents, 50000);
  assert.equal(p.newBalanceCents, 100000);
  assert.equal(p.newStatus, "partial");
  assert.equal(p.overpaymentCents, 0);
});

test("payments accumulate rather than replacing the running total", () => {
  const after1 = planPayment(invoice(), "500");
  const after2 = planPayment(invoice({ amount_paid_cents: after1.newPaidCents, status: "partial" }), "500");
  assert.equal(after2.newPaidCents, 100000);
  assert.equal(after2.newBalanceCents, 50000);
  assert.equal(after2.newStatus, "partial");
});

test("paying the exact balance settles the invoice", () => {
  const p = planPayment(invoice({ amount_paid_cents: 50000, status: "partial" }), fullPaymentInput(invoice({ amount_paid_cents: 50000 })));
  assert.equal(p.amountCents, 100000);
  assert.equal(p.newPaidCents, 150000);
  assert.equal(p.newBalanceCents, 0);
  assert.equal(p.newStatus, "paid");
});

test("full-payment shortcut offers the outstanding balance, not the invoice total", () => {
  assert.equal(fullPaymentInput(invoice({ amount_paid_cents: 50000 })), "1000.00");
  assert.equal(fullPaymentInput(invoice()), "1500.00");
  assert.equal(fullPaymentInput(invoice({ amount_paid_cents: 200000 })), "0.00");
});

test("overpayment is allowed, flagged, and never shows a negative balance", () => {
  const p = planPayment(invoice(), "2000");
  assert.equal(p.newPaidCents, 200000);
  assert.equal(p.newBalanceCents, 0);
  assert.equal(p.overpaymentCents, 50000);
  assert.equal(p.newStatus, "paid");
});

test("messy input is parsed the same way as everywhere else", () => {
  assert.equal(planPayment(invoice(), "R1 234,56").amountCents, 123456);
  assert.equal(planPayment(invoice(), "1,234.56").amountCents, 123456);
});

test("bad input is rejected with a reason and changes nothing", () => {
  for (const bad of ["", "   ", "abc", "0", "-50", "12.345"]) {
    const p = planPayment(invoice({ amount_paid_cents: 50000 }), bad);
    assert.equal(p.ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.ok(p.errors.length > 0);
    assert.equal(p.newPaidCents, 50000, "running total must not move");
  }
});

test("paying a written-off invoice brings it back", () => {
  const p = planPayment(invoice({ status: "written_off" }), "1500");
  assert.equal(p.clearsWriteOff, true);
  assert.equal(p.newStatus, "paid");
  const partial = planPayment(invoice({ status: "written_off" }), "500");
  assert.equal(partial.newStatus, "partial");
});

// Definition of done: totals verified by hand, including a partial payment.
test("dashboard totals match hand arithmetic after payments", () => {
  const TODAY = "2026-09-19";
  let book = [
    { id: "a", amount_cents: 150000, amount_paid_cents: 0, status: "unpaid", due_on: "2026-09-17" },  // 2 days
    { id: "b", amount_cents: 1234567, amount_paid_cents: 0, status: "unpaid", due_on: "2026-07-20" }, // 61 days
    { id: "c", amount_cents: 45000, amount_paid_cents: 0, status: "unpaid", due_on: "2026-10-01" },   // not due
    { id: "d", amount_cents: 99, amount_paid_cents: 0, status: "unpaid", due_on: "2026-08-19" },      // 31 days
  ];
  // Hand check: 1500.00 + 12345.67 + 450.00 + 0.99 = 14296.66
  assert.equal(summarise(book, TODAY).outstanding, 1429666);

  // Bob pays R500 off invoice b, then R5 000 more.
  const apply = (id, input) => {
    book = book.map((inv) => {
      if (inv.id !== id) return inv;
      const p = planPayment(inv, input);
      assert.ok(p.ok, p.errors.join("; "));
      return { ...inv, amount_paid_cents: p.newPaidCents, status: p.newStatus };
    });
  };
  apply("b", "500");
  apply("b", "R5 000,00");

  const b = book.find((i) => i.id === "b");
  assert.equal(b.amount_paid_cents, 550000);
  assert.equal(b.status, "partial");
  // 12345.67 - 5500.00 = 6845.67 still owed on b
  assert.equal(outstandingCents(b), 684567);

  // 1500.00 + 6845.67 + 450.00 + 0.99 = 8796.66
  const afterPartial = summarise(book, TODAY);
  assert.equal(afterPartial.outstanding, 879666);
  assert.equal(afterPartial.count, 4);
  assert.equal(formatCents(afterPartial.outstanding, "ZAR", "en-ZA").replace(/ /g, " "), "R 8 796,66");

  // Settle a in full; it leaves the outstanding view entirely.
  apply("a", "1500");
  const afterFull = summarise(book, TODAY);
  assert.equal(book.find((i) => i.id === "a").status, "paid");
  assert.equal(afterFull.count, 3);
  assert.equal(afterFull.outstanding, 729666); // 6845.67 + 450.00 + 0.99
  assert.equal(afterFull.outstanding, sumCents([684567, 45000, 99]));
  assert.deepEqual(afterFull.buckets.critical, { total: 684567, count: 1 });
  assert.deepEqual(afterFull.buckets.late, { total: 99, count: 1 });
  assert.deepEqual(afterFull.buckets.due, { total: 0, count: 0 });
  assert.deepEqual(afterFull.buckets.current, { total: 45000, count: 1 });
});
