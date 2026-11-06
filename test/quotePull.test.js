import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteToCandidate, pullCandidates, buildPullPayload, matchCustomer, quoteRef, quoteDescription } from "../src/lib/quotePull.js";
import { createMockClient } from "../src/dev/mockBackend.js";

const TODAY = "2026-11-05";
const q = (id, over = {}) => ({
  id, status: "accepted", customer_name: "Lerato Nkosi", customer_phone: "082 000 0004", customer_email: null,
  line_items: [{ description: "Lawn and edging" }, { description: "Hedge trim" }], total_text: "3400", accepted_at: "2026-10-20T08:00:00Z",
  invoiced_at: null, created_at: "2026-10-18T08:00:00Z", ...over,
});
const ID = (n) => `0000000${n}-aaaa-4bbb-8ccc-${String(n).padStart(12, "0")}`;

test("numeric rand text becomes exact integer cents, no float path", () => {
  assert.equal(quoteToCandidate(q(ID(1), { total_text: "1062.5" }), { termsDays: 7, today: TODAY }).amount_cents, 106250);
  assert.equal(quoteToCandidate(q(ID(1), { total_text: "0.1" }), { termsDays: 7, today: TODAY }).amount_cents, 10);
  assert.equal(quoteToCandidate(q(ID(1), { total_text: "12345678.99" }), { termsDays: 7, today: TODAY }).amount_cents, 1234567899);
});

test("due = invoiced (else accepted) date + terms; reference matches Quote's PDF", () => {
  const c = quoteToCandidate(q(ID(1)), { termsDays: 7, today: TODAY });
  assert.equal(c.issued_on, "2026-10-20");
  assert.equal(c.due_on, "2026-10-27");
  assert.equal(c.daysOverdue, 9);
  assert.equal(c.reference, "Q-000000");
  assert.equal(quoteRef({ id: "3f2504e0-4f89", status: "invoiced" }), "INV-3F2504");
  const inv = quoteToCandidate(q(ID(2), { status: "invoiced", invoiced_at: "2026-10-30T08:00:00Z" }), { termsDays: 7, today: TODAY });
  assert.equal(inv.due_on, "2026-11-06");
  assert.equal(inv.pastDue, false);
  assert.equal(quoteDescription(q(ID(1))), "Lawn and edging, plus 1 more");
});

test("only accepted/invoiced, unpaid, past due, not already imported are offered", () => {
  const quotes = [
    q(ID(1)),
    q(ID(2), { status: "paid" }),
    q(ID(3), { status: "sent" }),
    q(ID(4), { accepted_at: "2026-11-02T08:00:00Z" }), // within terms
    q(ID(5)), // already imported
    q(ID(6), { total_text: "0" }), // unusable
  ];
  const r = pullCandidates(quotes, { importedQuoteIds: [ID(5)], termsDays: 7, today: TODAY });
  assert.deepEqual(r.offered.map((c) => c.quoteId), [ID(1)]);
  assert.equal(r.notYetDue, 1);
  assert.equal(r.alreadyImported, 1);
  assert.deepEqual(r.skipped.map((c) => c.quoteId), [ID(6)]);
  const withNotDue = pullCandidates(quotes, { importedQuoteIds: [ID(5)], termsDays: 7, today: TODAY, includeNotDue: true });
  assert.equal(withNotDue.offered.length, 2);
});

test("same person across tools: matched on phone first, then email; one new customer per person", () => {
  const existing = [{ id: "c1", name: "L Nkosi", phone: "+27 82 000 0004", email: null }, { id: "c2", name: "X", phone: null, email: "x@example.com" }];
  assert.deepEqual(matchCustomer({ phone: "082 000 0004" }, existing), { id: "c1", by: "phone" });
  assert.deepEqual(matchCustomer({ phone: null, email: "X@Example.com" }, existing), { id: "c2", by: "email" });
  assert.equal(matchCustomer({ phone: "082 000 0099" }, existing), null);
  const cands = [q(ID(1)), q(ID(7), { customer_name: "New Person", customer_phone: "082 000 0010" }), q(ID(8), { customer_name: "New Person", customer_phone: "+27820000010" })]
    .map((x) => quoteToCandidate(x, { termsDays: 7, today: TODAY }));
  const p = buildPullPayload(cands, existing);
  assert.equal(p.customers.filter((c) => c.id === null).length, 1);
  assert.equal(p.invoices.length, 3);
  assert.equal(p.invoices[0].customer_key, "id:c1");
  assert.ok(p.invoices.every((i) => i.source_quote_id && Number.isInteger(i.amount_cents)));
});

test("re-running the pull through the test backend never duplicates", async () => {
  const sb = createMockClient();
  await sb.auth.signInWithPassword({ email: "owner@example.com", password: "x" });
  const cands = [quoteToCandidate(q(ID(9)), { termsDays: 7, today: TODAY })];
  const first = await sb.rpc("chaser_import_invoices", { payload: buildPullPayload(cands, []) });
  assert.equal(first.data.invoices_created, 1);
  const again = await sb.rpc("chaser_import_invoices", { payload: buildPullPayload(cands, []) });
  assert.equal(again.data.invoices_created, 0);
  assert.equal(again.data.invoices_skipped, 1);
  assert.equal(again.data.customers_created, 0, "no empty customer left behind");
  const { data: rows } = await sb.from("chaser_invoices").select("*").eq("source_quote_id", ID(9));
  assert.equal(rows.length, 1);
});
