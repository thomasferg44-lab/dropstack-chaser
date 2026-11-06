import { test } from "node:test";
import assert from "node:assert/strict";
import { safePaymentLink, buildPayLine, payCheck } from "../src/lib/payInfo.js";
import { formatFrom, textToHtml, validateEmailRequest } from "../src/lib/nudgeEmail.js";
import { checklistState } from "../src/lib/onboarding.js";
import { friendlyAuthError } from "../src/lib/auth.js";
import { brandInk, initials, brandVars } from "../src/lib/brand.js";

test("payment link: https only", () => {
  assert.equal(safePaymentLink("https://pay.example.com/x"), "https://pay.example.com/x");
  for (const bad of ["http://pay.example.com", "javascript:alert(1)", "pay.example.com", "", null]) assert.equal(safePaymentLink(bad), null);
});

test("pay line: instructions, reference, link; empty when nothing is configured; v1 paymentDetails honoured", () => {
  assert.equal(buildPayLine({ paymentInstructions: "FNB 123", paymentLink: "https://p.example.com" }, { reference: "INV-1" }),
    "How to pay:\nFNB 123\nReference: INV-1\nPay online: https://p.example.com/");
  assert.equal(buildPayLine({}, { reference: "INV-1" }), "");
  assert.equal(buildPayLine({ paymentDetails: "Old field" }, {}), "How to pay:\nOld field");
  assert.deepEqual(payCheck({ paymentInstructions: "FNB 123" }, { reference: "R1" }, "FNB 123 R1"), { configured: true, instructions: true, link: null, reference: true });
});

test("RFC-safe From: quotes specials, strips header injection", () => {
  assert.equal(formatFrom("Sample Service Co", "a@example.com"), "Sample Service Co <a@example.com>");
  assert.equal(formatFrom("Smith, Jones & Co", "a@example.com"), '"Smith, Jones & Co" <a@example.com>');
  assert.equal(formatFrom('Evil\r\nBcc: x@y.z "q"', "a@example.com"), '"Evil Bcc: x@y.z \\"q\\"" <a@example.com>');
  assert.equal(formatFrom("", "a@example.com"), "a@example.com");
});

test("email HTML: escaped, and only https links become clickable", () => {
  const html = textToHtml('Pay: https://pay.example.com/x?a=1&b=2.\n<script>"');
  assert.ok(html.includes('<a href="https://pay.example.com/x?a=1&amp;b=2"'));
  assert.ok(html.includes("&lt;script&gt;&quot;"));
  assert.ok(!textToHtml("javascript:alert(1)").includes("<a "));
});

test("send request accepts a valid ladder stage and rejects junk", () => {
  const base = { to: "test@example.com", subject: "S", body: "B", tone: "firm", invoiceId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" };
  assert.equal(validateEmailRequest({ ...base, stage: "firm" }).value.stage, "firm");
  assert.equal(validateEmailRequest({ ...base, stage: "x y<z>" }).ok, false);
  assert.equal(validateEmailRequest(base).ok, true);
});

test("first-run checklist: shown until complete, dismissible only after", () => {
  const s0 = checklistState({ configConfirmed: false, invoices: [], dismissed: true });
  assert.equal(s0.show, true);
  assert.equal(s0.next, "config");
  assert.equal(s0.canDismiss, false);
  const s1 = checklistState({ configConfirmed: true, invoices: [{ nudges: [] }], dismissed: false });
  assert.equal(s1.next, "action");
  const s2 = checklistState({ configConfirmed: true, invoices: [{ nudges: [{}] }], dismissed: false });
  assert.equal(s2.complete, true);
  assert.equal(s2.show, true);
  assert.equal(checklistState({ configConfirmed: true, invoices: [{ nudges: [{}] }], dismissed: true }).show, false);
});

test("sign-in errors use the suite's words", () => {
  assert.equal(friendlyAuthError({ code: "invalid_credentials" }), "Email or password is incorrect.");
  assert.equal(friendlyAuthError({ name: "AuthRetryableFetchError", status: 0 }), "Couldn't reach the server. Check your connection and try again.");
});

test("brand colour: readable ink and initials", () => {
  assert.equal(brandInk("#0071E3"), "#ffffff");
  assert.equal(brandInk("#FFD60A"), "#1d1d1f");
  assert.equal(initials("Sample Service Co"), "SS");
  assert.equal(brandVars({ primaryColor: "nope" })["--brand-rgb"], "0 113 227");
});
