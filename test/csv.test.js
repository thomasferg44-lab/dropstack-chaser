import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv, guessMapping, normalisePhone, buildPreview, buildImportPayload, validateValues, annotateRows, indexCustomers,
} from "../src/lib/csv.js";
import { sumCents } from "../src/lib/money.js";

const TODAY = "2026-09-17";

test("parseCsv handles quotes, CRLF, BOM, semicolons", () => {
  const r = parseCsv('﻿Name;Amount\r\n"Demo, Customer";"R1 500,00"\r\n"Say ""hi""";2\r\n');
  assert.equal(r.delimiter, ";");
  assert.deepEqual(r.headers, ["Name", "Amount"]);
  assert.deepEqual(r.rows.map((x) => x.cells), [["Demo, Customer", "R1 500,00"], ['Say "hi"', "2"]]);
  assert.deepEqual(r.rows.map((x) => x.line), [2, 3]);
});

test("guessMapping is forgiving about column names", () => {
  const m = guessMapping(["Client Name", "Cell", "E-mail", "Invoice #", "Amount Due", "Paid", "Invoice Date", "Due Date"]);
  assert.deepEqual(m, {
    0: "customer_name", 1: "phone", 2: "email", 3: "reference", 4: "amount", 5: "amount_paid", 6: "issued_on", 7: "due_on",
  });
  const m2 = guessMapping(["customer", "total", "date", "Something Else"]);
  assert.deepEqual(m2, { 0: "customer_name", 1: "amount", 2: "issued_on", 3: null });
});

test("normalisePhone", () => {
  assert.equal(normalisePhone("082 000 0000"), "27820000000");
  assert.equal(normalisePhone("+27 82 000 0000"), "27820000000");
  assert.equal(normalisePhone("0027820000000"), "27820000000");
  assert.equal(normalisePhone(""), "");
});

const MESSY = `Customer,Phone,Email,Invoice No,Description,Total,Paid,Invoice Date,Due Date
Sample Plumbing Co,082 000 0000,billing@example.com,INV-001,Geyser,"R1,500.00",,01/08/2026,31/08/2026
Sample Plumbing Co,+27820000000,,INV-002,Callout,"R 450,00",,2026-08-15,
,,,,,,,,
Demo Landscaping,,hello@example.com,INV-003,Garden,"1 200",200,15 Aug 2026,14/09/2026
Broken Row,,,INV-004,,abc,,32/13/2026,
Zero Amount Co,,,INV-005,,0,,17/09/2026,17/09/2026
Sample Plumbing Co,0820000000,,INV-001,Dup,1500,,01/08/2026,31/08/2026
`;

test("buildPreview never drops a row and flags problems", () => {
  const p = buildPreview(MESSY, { today: TODAY, defaultCurrency: "ZAR" });
  assert.equal(p.blankRows, 1);
  assert.equal(p.rows.length, 6);

  const [r1, r2, r3, r4, r5, r6] = p.rows;
  assert.deepEqual(r1.errors, {});
  assert.equal(r1.parsed.amount_cents, 150000);
  assert.equal(r1.parsed.issued_on, "2026-08-01");
  assert.equal(r1.parsed.due_on, "2026-08-31");

  assert.equal(r2.parsed.amount_cents, 45000); // "R 450,00" decimal comma
  assert.equal(r2.parsed.due_on, "2026-09-14"); // defaulted +30
  assert.ok(r2.warnings.some((w) => w.startsWith("No due date")));

  assert.equal(r3.parsed.amount_cents, 120000);
  assert.equal(r3.parsed.amount_paid_cents, 20000);
  assert.equal(r3.parsed.issued_on, "2026-08-15");

  assert.equal(r4.errors.amount, "Not a number");
  assert.ok(r4.errors.issued_on);
  assert.ok(r4.errors.due_on === undefined || r4.errors.due_on); // no due date + bad issued date

  assert.ok(r5.warnings.includes("Amount is zero"));
  assert.deepEqual(r5.errors, {});

  assert.ok(r6.warnings.some((w) => w.startsWith("Duplicate of line 2")));

  // same customer key across three Demo Customer rows (phone-based)
  assert.equal(r1.customer.key, r2.customer.key);
  assert.equal(r1.customer.key, r6.customer.key);
  assert.equal(r1.customer.key, "phone:27820000000");
});

test("payload dedupes new customers and skips error rows", () => {
  const p = buildPreview(MESSY, { today: TODAY, defaultCurrency: "ZAR" });
  const payload = buildImportPayload(p.rows);
  assert.equal(payload.customers.length, 3); // Demo Customer, Demo Landscaping, Zero Amount Co (Broken Row excluded)
  assert.equal(payload.invoices.length, 5); // 6 rows minus the broken one
  const bob = payload.customers.find((c) => c.name === "Sample Plumbing Co");
  assert.equal(bob.id, null);
  assert.equal(bob.email, "billing@example.com");

  // hand-checked outstanding: 1500 + 450 + (1200-200) + 0 + 1500 = 4450.00
  const outstanding = sumCents(payload.invoices.map((i) => i.amount_cents - i.amount_paid_cents));
  assert.equal(outstanding, 445000);
});

test("existing customers are matched by phone, email, then name; existing refs flagged", () => {
  const existing = [
    { id: "c1", name: "Sample Plumbing Co", phone: "27820000000", email: null },
    { id: "c2", name: "Demo Landscaping", phone: null, email: "HELLO@example.com" },
    { id: "c3", name: "zero amount co", phone: null, email: null },
  ];
  const invoices = [{ customer_id: "c1", reference: "inv-001" }];
  const p = buildPreview(MESSY, { today: TODAY, existingCustomers: existing, existingInvoices: invoices });
  assert.equal(p.rows[0].customer.existing.id, "c1");
  assert.equal(p.rows[0].alreadyExists, true);
  assert.equal(p.rows[1].customer.existing.id, "c1");
  assert.equal(p.rows[1].alreadyExists, false);
  assert.equal(p.rows[2].customer.existing.id, "c2");
  assert.equal(p.rows[4].customer.existing.id, "c3");
  assert.equal(p.rows[4].customer.matchedBy, "name");
  assert.ok(p.rows[4].warnings.some((w) => w.startsWith("Matched existing customer")));
  assert.equal(p.rows[0].customer.matchedBy, "phone");
  assert.ok(!p.rows[0].warnings.some((w) => w.startsWith("Matched")));
  assert.equal(p.rows[2].customer.matchedBy, "email");
  const payload = buildImportPayload(p.rows.map((r) => ({ ...r, include: !r.alreadyExists })));
  assert.equal(payload.customers.filter((c) => c.id === null).length, 0);
});

test("editing a row and re-validating clears errors", () => {
  const p = buildPreview(MESSY, { today: TODAY });
  const broken = p.rows[3];
  const fixed = validateValues({ ...broken.values, amount: "R99.90", issued_on: "1/9/2026" }, { today: TODAY });
  assert.deepEqual(fixed.errors, {});
  assert.equal(fixed.parsed.amount_cents, 9990);
  assert.equal(fixed.parsed.due_on, "2026-10-01");
  Object.assign(broken, fixed);
  annotateRows(p.rows, { custIdx: indexCustomers([]) });
  assert.equal(buildImportPayload(p.rows).invoices.length, 6);
});
