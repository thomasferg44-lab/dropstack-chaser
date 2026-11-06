import { test } from "node:test";
import assert from "node:assert/strict";
import { composeNudge, checkDraft, draftWarnings, toneForStage } from "../src/lib/compose.js";
import { jobPhrase } from "../src/lib/nudge.js";
import { companyConfig } from "../companyConfig.js";
import { formatDate } from "../src/lib/dates.js";
const D = (iso) => formatDate(iso, "en-ZA");

const TODAY = "2026-11-05";
const CONFIG = { ...companyConfig, businessName: "Demo Plumbing", ownerName: "Sam", paymentInstructions: "FNB · Acc 62000000000 · Branch 250655", paymentLink: "https://pay.example.com/demo" };
const at = (iso) => `${iso}T10:00:00`;
const strip = (s) => s.replace(/[  ]/g, " ");
const invoice = (over = {}) => ({
  id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", reference: "INV-204", description: "Geyser replacement",
  amount_cents: 985000, amount_paid_cents: 0, currency: "ZAR", due_on: "2026-10-22", status: "unpaid",
  customer: { name: "Thandi Mokoena", phone: "+27 00 000 0001", email: "thandi@example.com" }, nudges: [], promises: [], ...over,
});

test("stage keys map to tones from the ladder config", () => {
  assert.equal(toneForStage("friendly", CONFIG), "gentle");
  assert.equal(toneForStage("final", CONFIG), "final");
  assert.equal(toneForStage("firm", CONFIG), "firm");
});

test("every stage, both channels: pre-written with real values and the pay block, nothing left to type", () => {
  for (const stage of ["friendly", "firm", "final"]) {
    for (const channel of ["whatsapp", "email"]) {
      const n = composeNudge(invoice(), { stage, channel, config: CONFIG, today: TODAY });
      const text = strip(`${n.subject ?? ""}\n${n.body}`);
      assert.ok(text.includes("Thandi Mokoena") && text.includes("INV-204") && text.includes("R 9 850,00"), `${stage}/${channel}`);
      assert.ok(text.includes("for the geyser replacement"), "job woven in");
      assert.ok(text.includes("FNB · Acc 62000000000") && text.includes("Reference: INV-204") && text.includes("https://pay.example.com/demo"), "pay block");
      assert.deepEqual(n.checks.unresolved, []);
      assert.equal(n.checks.payIncluded, true);
      assert.deepEqual(draftWarnings(n.checks), []);
    }
  }
});

test("part-payment is acknowledged and only the balance is asked for", () => {
  const n = composeNudge(invoice({ amount_paid_cents: 300000, status: "partial" }), { stage: "firm", channel: "whatsapp", config: CONFIG, today: TODAY });
  const t = strip(n.body);
  assert.ok(t.includes("R 6 850,00 still outstanding"));
  assert.ok(t.includes("Thanks for the R 3 000,00 already paid."));
});

test("a broken promise is played back factually, and repeat breaks are counted", () => {
  const one = composeNudge(invoice({ promises: [{ promised_on: "2026-11-02", created_at: at("2026-10-28") }] }), { stage: "firm", channel: "whatsapp", config: CONFIG, today: TODAY });
  assert.ok(one.body.includes(`On ${D("2026-10-28")} you mentioned paying by ${D("2026-11-02")}, and it hasn't come through yet.`), one.body);
  assert.ok(!one.body.includes("second"));
  const two = composeNudge(invoice({ promises: [
    { promised_on: "2026-11-02", created_at: at("2026-10-28") },
    { promised_on: "2026-10-25", created_at: at("2026-10-20") },
  ] }), { stage: "final", channel: "email", config: CONFIG, today: TODAY });
  assert.ok(two.body.includes("This is the second payment date that has passed."));
});

test("a pending promise is thanked, not chased", () => {
  const n = composeNudge(invoice({ promises: [{ promised_on: "2026-11-07", created_at: at("2026-11-04") }] }), { stage: "friendly", channel: "whatsapp", config: CONFIG, today: TODAY });
  assert.ok(n.body.includes(`Thanks for letting me know you'll pay by ${D("2026-11-07")}.`), n.body);
});

test("pay check catches an edit that removed the payment details, and unconfigured payment", () => {
  const n = composeNudge(invoice(), { stage: "friendly", channel: "whatsapp", config: CONFIG, today: TODAY });
  const edited = checkDraft(invoice(), { body: n.body.replace(/How to pay:[\s\S]*$/, "") }, CONFIG, TODAY);
  assert.equal(edited.payIncluded, false);
  assert.match(draftWarnings(edited)[0], /edited out/);
  const bare = composeNudge(invoice(), { stage: "friendly", channel: "whatsapp", config: { ...CONFIG, paymentInstructions: "", paymentLink: "" }, today: TODAY });
  assert.ok(!bare.body.includes("How to pay"));
  assert.match(draftWarnings(bare.checks)[0], /No payment details/);
  const typo = checkDraft(invoice(), { body: "Hi {custmerName}" }, CONFIG, TODAY);
  assert.deepEqual(typo.unresolved, ["{custmerName}"]);
});

test("a non-https payment link is never put in a message", () => {
  const n = composeNudge(invoice(), { stage: "friendly", channel: "whatsapp", config: { ...CONFIG, paymentLink: "javascript:alert(1)" }, today: TODAY });
  assert.ok(!n.body.includes("javascript:"));
  assert.ok(!n.body.includes("Pay online"));
});

test("provider seam: refine() can rewrite the draft, and the checks still run on its output", () => {
  const n = composeNudge(invoice(), { stage: "friendly", channel: "whatsapp", config: CONFIG, today: TODAY, refine: () => ({ body: "short" }) });
  assert.equal(n.body, "short");
  assert.equal(n.checks.payIncluded, false);
});

test("wa.me prefill equals the composed body", () => {
  const n = composeNudge(invoice(), { stage: "firm", channel: "whatsapp", config: CONFIG, today: TODAY });
  assert.ok(n.url.startsWith("https://wa.me/27000000001?text="));
  assert.equal(decodeURIComponent(n.url.split("?text=")[1]), n.body);
});

test("job phrase from descriptions", () => {
  assert.equal(jobPhrase("Geyser replacement."), " for the geyser replacement");
  assert.equal(jobPhrase("DB board upgrade"), " for the DB board upgrade");
  assert.equal(jobPhrase("the gate motor"), " for the gate motor");
  assert.equal(jobPhrase(""), "");
  assert.ok(jobPhrase("x ".repeat(80)).length < 70);
});
