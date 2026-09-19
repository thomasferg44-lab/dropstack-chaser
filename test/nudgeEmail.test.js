import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEmailRequest, isEmail, textToHtml, LIMITS } from "../src/lib/nudgeEmail.js";

const VALID = {
  to: "test@example.com",
  subject: "Overdue: invoice INV-001",
  body: "Hi Bob,\n\nInvoice INV-001 is overdue.",
  tone: "firm",
  invoiceId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
};

test("accepts a well-formed request and trims it", () => {
  const r = validateEmailRequest({ ...VALID, to: "  test@example.com  " });
  assert.ok(r.ok, r.errors.join("; "));
  assert.equal(r.value.to, "test@example.com");
});

test("rejects bad recipients", () => {
  for (const to of ["", "nope", "a@b", null, ["a@b.com"], "a@b.com, c@d.com"]) {
    assert.equal(validateEmailRequest({ ...VALID, to }).ok, false, `accepted ${JSON.stringify(to)}`);
  }
  assert.equal(isEmail("a@b.co.za"), true);
});

test("rejects missing or oversized fields", () => {
  assert.equal(validateEmailRequest({ ...VALID, subject: "" }).ok, false);
  assert.equal(validateEmailRequest({ ...VALID, body: "   " }).ok, false);
  assert.equal(validateEmailRequest({ ...VALID, subject: "x".repeat(LIMITS.subject + 1) }).ok, false);
  assert.equal(validateEmailRequest({ ...VALID, body: "x".repeat(LIMITS.body + 1) }).ok, false);
});

test("rejects header injection in the subject", () => {
  const r = validateEmailRequest({ ...VALID, subject: "Hi\nBcc: someone@example.com" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /line breaks/.test(e)));
});

test("rejects unknown tone and malformed invoice id", () => {
  assert.equal(validateEmailRequest({ ...VALID, tone: "angry" }).ok, false);
  assert.equal(validateEmailRequest({ ...VALID, invoiceId: "123" }).ok, false);
  assert.equal(validateEmailRequest(null).ok, false);
});

test("html conversion escapes and preserves line breaks", () => {
  const html = textToHtml("a <b> &\nnext");
  assert.ok(html.includes("a &lt;b&gt; &amp;\nnext"));
  assert.ok(html.includes("white-space:pre-wrap"));
});
