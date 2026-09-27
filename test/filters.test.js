import { test } from "node:test";
import assert from "node:assert/strict";
import { filterInvoices, countHiddenByStatus, matchesQuery } from "../src/lib/filters.js";

const inv = (id, status, bucket, customer, reference, description = "") => ({
  id, status, bucket, customer_id: customer.toLowerCase(), customer: { name: customer }, reference, description,
});
const LIST = [
  inv("a", "unpaid", "due", "Sample Plumbing Co", "INV-001", "Geyser"),
  inv("b", "partial", "late", "Sample Plumbing Co", "INV-002"),
  inv("c", "unpaid", "current", "Demo Landscaping", "INV-003", "Garden"),
  inv("d", "paid", "current", "Demo Landscaping", "INV-004"),
  inv("e", "written_off", "critical", "Zero Amount Co", "INV-005"),
];
const ids = (rows) => rows.map((r) => r.id);

test("default view is open invoices only", () => {
  assert.deepEqual(ids(filterInvoices(LIST, {})), ["a", "b", "c"]);
});

test("status filters", () => {
  assert.deepEqual(ids(filterInvoices(LIST, { status: "unpaid" })), ["a", "c"]);
  assert.deepEqual(ids(filterInvoices(LIST, { status: "partial" })), ["b"]);
  assert.deepEqual(ids(filterInvoices(LIST, { status: "paid" })), ["d"]);
  assert.deepEqual(ids(filterInvoices(LIST, { status: "written_off" })), ["e"]);
  assert.deepEqual(ids(filterInvoices(LIST, { status: "all" })), ["a", "b", "c", "d", "e"]);
});

test("customer and bucket filters combine", () => {
  assert.deepEqual(ids(filterInvoices(LIST, { customerId: "sample plumbing co" })), ["a", "b"]);
  assert.deepEqual(ids(filterInvoices(LIST, { bucket: "current" })), ["c"]);
  assert.deepEqual(ids(filterInvoices(LIST, { bucket: "current", status: "all" })), ["c", "d"]);
  assert.deepEqual(ids(filterInvoices(LIST, { customerId: "sample plumbing co", bucket: "late" })), ["b"]);
});

test("search matches customer, reference or description, case-insensitively", () => {
  assert.deepEqual(ids(filterInvoices(LIST, { query: "landscaping" })), ["c"]);
  assert.deepEqual(ids(filterInvoices(LIST, { query: "inv-00" })), ["a", "b", "c"]);
  assert.deepEqual(ids(filterInvoices(LIST, { query: "GEYSER" })), ["a"]);
  assert.deepEqual(ids(filterInvoices(LIST, { query: "  " })), ["a", "b", "c"]);
  assert.equal(matchesQuery({ customer: null, reference: null }, "x"), false);
});

test("paid invoices stay searchable and the hidden count says so", () => {
  assert.deepEqual(ids(filterInvoices(LIST, { query: "INV-004" })), []);
  assert.equal(countHiddenByStatus(LIST, { query: "INV-004" }), 1);
  assert.deepEqual(ids(filterInvoices(LIST, { query: "INV-004", status: "all" })), ["d"]);
  assert.equal(countHiddenByStatus(LIST, { query: "landscaping" }), 1);
  assert.equal(countHiddenByStatus(LIST, {}), 2);
  assert.equal(countHiddenByStatus(LIST, { status: "all" }), 0);
});
