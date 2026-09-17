import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmountToCents, formatCents, centsToInput, sumCents, outstandingCents } from "../src/lib/money.js";

const ok = (input, cents) => {
  const r = parseAmountToCents(input);
  assert.equal(r.error, null, `${JSON.stringify(input)} → error ${r.error}`);
  assert.equal(r.cents, cents, `${JSON.stringify(input)} → ${r.cents}, want ${cents}`);
};
const bad = (input) => {
  const r = parseAmountToCents(input);
  assert.ok(r.error, `${JSON.stringify(input)} should error, got ${r.cents}`);
};

test("plain integers and decimals", () => {
  ok("1999", 199900);
  ok("19.99", 1999);
  ok("19.9", 1990);
  ok("0.05", 5);
  ok(".5", 50);
  ok("1500.", 150000);
  ok(1999, 199900);
  ok(19.99, 1999);
});

test("currency symbols, codes and spaces", () => {
  ok("R19.99", 1999);
  ok("R 19.99", 1999);
  ok("ZAR 1 500,00", 150000);
  ok("$1,999.50", 199950);
  ok("€1.999,50", 199950);
  ok("R1 999 500.25", 199950025);
  ok("1 500", 150000); // non-breaking space
});

test("comma rules", () => {
  ok("1,500", 150000); // 3 digits after → thousands
  ok("1,50", 150); // 2 digits after → decimal comma
  ok("1,5", 150);
  ok("1,234,567", 123456700);
  ok("1,234,567.89", 123456789);
  ok("1.234.567,89", 123456789);
  ok("1.234.567", 123456700);
});

test("negatives", () => {
  ok("-50.00", -5000);
  ok("(50.00)", -5000);
  ok("R-50", -5000);
});

test("empty and invalid", () => {
  assert.deepEqual(parseAmountToCents(""), { cents: null, error: null });
  assert.deepEqual(parseAmountToCents("   "), { cents: null, error: null });
  assert.deepEqual(parseAmountToCents(null), { cents: null, error: null });
  bad("abc");
  bad("R");
  bad("1.2.3,4");
  bad("12.345"); // more than 2 decimals — never round stored data
  bad("1-2");
  bad("12.34.56");
  bad("1,23,456");
});

test("float traps produce exact cents", () => {
  ok("0.1", 10);
  ok("0.2", 20);
  ok("0.3", 30);
  ok("1.15", 115);
  ok("4.35", 435);
});

test("formatCents is exact and integer-only", () => {
  assert.equal(formatCents(199950, "ZAR", "en-ZA").replace(/ /g, " "), "R 1 999,50");
  assert.equal(formatCents(5, "ZAR", "en-ZA").replace(/ /g, " "), "R 0,05");
  assert.equal(formatCents(-5000, "ZAR", "en-ZA").replace(/ /g, " "), "-R 50,00");
  assert.equal(formatCents(123456789, "USD", "en-US"), "$1,234,567.89");
  assert.equal(formatCents(null), "—");
  assert.throws(() => formatCents(19.99));
});

test("centsToInput round-trips", () => {
  assert.equal(centsToInput(1999), "19.99");
  assert.equal(centsToInput(5), "0.05");
  assert.equal(centsToInput(150000), "1500.00");
  assert.equal(centsToInput(-250), "-2.50");
  assert.equal(parseAmountToCents(centsToInput(123456789)).cents, 123456789);
});

test("sumCents and outstandingCents", () => {
  assert.equal(sumCents([1, 2, 3]), 6);
  assert.equal(sumCents(["100", 200]), 300);
  assert.throws(() => sumCents([1.5]));
  assert.equal(outstandingCents({ amount_cents: 10000, amount_paid_cents: 2500 }), 7500);
  assert.equal(outstandingCents({ amount_cents: 10000, amount_paid_cents: 12000 }), 0);
  assert.equal(outstandingCents({ amount_cents: "10000" }), 10000);
});
