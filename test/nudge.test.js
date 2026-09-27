import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTemplate, buildNudgeVars, renderNudge, TONES } from "../src/lib/nudge.js";
import { companyConfig } from "../companyConfig.js";

const TODAY = "2026-09-19";
const CONFIG = { ...companyConfig, businessName: "Demo Service Co", locale: "en-ZA", currency: "ZAR" };

const invoice = (over = {}) => ({
  amount_cents: 150000,
  amount_paid_cents: 0,
  currency: "ZAR",
  reference: "INV-001",
  due_on: "2026-08-20",
  customer: { name: "Demo Customer", phone: "082 000 0000", email: "test@example.com" },
  ...over,
});

const strip = (s) => s.replace(/ /g, " ");

test("placeholders are substituted; unknown ones are left visible", () => {
  const vars = { a: "1", b: "" };
  assert.equal(renderTemplate("x {a} y {b} z", vars), "x 1 y z");
  assert.equal(renderTemplate("{nope}", vars), "{nope}");
});

test("empty values leave tidy text", () => {
  assert.equal(renderTemplate("Hi.  {x}  Thanks.", { x: "" }), "Hi. Thanks.");
  assert.equal(renderTemplate("A\n\n{x}\n\nB", { x: "" }), "A\n\nB");
  assert.equal(renderTemplate("  {x}  ", { x: "" }), "");
});

test("amount is what is still owed, not the invoice total", () => {
  const v = buildNudgeVars(invoice({ amount_paid_cents: 50000 }), CONFIG, TODAY);
  assert.equal(strip(v.amount), "R 1 000,00");
  assert.equal(strip(v.invoiceTotal), "R 1 500,00");
  assert.equal(strip(v.amountPaid), "R 500,00");
});

test("days overdue is clamped at zero and dates are formatted", () => {
  assert.equal(buildNudgeVars(invoice(), CONFIG, TODAY).daysOverdue, "30");
  assert.equal(buildNudgeVars(invoice({ due_on: "2026-10-01" }), CONFIG, TODAY).daysOverdue, "0");
  assert.equal(buildNudgeVars(invoice(), CONFIG, TODAY).dueDate, "20 Aug 2026");
});

test("missing reference falls back rather than printing undefined", () => {
  const v = buildNudgeVars(invoice({ reference: null }), CONFIG, TODAY);
  assert.equal(v.reference, "—");
});

test("all three tones render for both channels with real values", () => {
  for (const { key: tone } of TONES) {
    const wa = renderNudge(invoice(), { tone, channel: "whatsapp", config: CONFIG, today: TODAY });
    assert.ok(wa.canSend);
    assert.ok(!/\{\w+\}/.test(wa.body), `${tone} whatsapp left a placeholder: ${wa.body}`);
    assert.ok(wa.body.includes("Demo Customer") && wa.body.includes("Demo Service Co"));
    assert.ok(strip(wa.body).includes("R 1 500,00"));
    assert.ok(wa.url.startsWith("https://wa.me/27820000000?text="));
    assert.equal(decodeURIComponent(wa.url.split("?text=")[1]), wa.body);

    const em = renderNudge(invoice(), { tone, channel: "email", config: CONFIG, today: TODAY });
    assert.ok(em.canSend && em.to === "test@example.com");
    assert.ok(!/\{\w+\}/.test(em.subject + em.body), `${tone} email left a placeholder`);
    assert.ok(em.subject.length > 0 && em.body.includes("Demo Customer"));
  }
});

test("tones are genuinely different text, not the same string", () => {
  const body = (tone) => renderNudge(invoice(), { tone, channel: "whatsapp", config: CONFIG, today: TODAY }).body;
  const [g, f, fi] = [body("gentle"), body("firm"), body("final")];
  assert.notEqual(g, f);
  assert.notEqual(f, fi);
  assert.ok(f.includes("30 days") || f.includes("30"), "firm states how overdue it is");
});

test("missing contact details block the send with a reason", () => {
  const noPhone = renderNudge(invoice({ customer: { name: "Demo Customer", phone: null } }), {
    tone: "gentle", channel: "whatsapp", config: CONFIG, today: TODAY,
  });
  assert.equal(noPhone.canSend, false);
  assert.equal(noPhone.url, null);
  assert.match(noPhone.blockedReason, /No phone number/);

  const badPhone = renderNudge(invoice({ customer: { name: "Demo Customer", phone: "123" } }), {
    tone: "gentle", channel: "whatsapp", config: CONFIG, today: TODAY,
  });
  assert.equal(badPhone.canSend, false);
  assert.match(badPhone.blockedReason, /country code/);

  const noEmail = renderNudge(invoice({ customer: { name: "Demo Customer", email: "" } }), {
    tone: "firm", channel: "email", config: CONFIG, today: TODAY,
  });
  assert.equal(noEmail.canSend, false);
  assert.match(noEmail.blockedReason, /No email/);
});

test("a missing template errors loudly instead of sending an empty message", () => {
  assert.throws(
    () => renderNudge(invoice(), { tone: "gentle", channel: "whatsapp", config: { ...CONFIG, nudgeTemplates: {} }, today: TODAY }),
    /No whatsapp template/,
  );
});
