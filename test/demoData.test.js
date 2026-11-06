import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDemoPayload, DEMO_INDUSTRIES, DEMO_SCENARIOS, hasDemo, demoIndustryOf } from "../src/lib/demoData.js";
import { createMockClient } from "../src/dev/mockBackend.js";
import { annotate, buildTodayQueue, brokenPromises } from "../src/lib/queue.js";
import { agedSummary } from "../src/lib/aged.js";
import { DEFAULT_LADDER } from "../src/lib/ladder.js";
import { isWhatsAppable } from "../src/lib/phone.js";

const TODAY = "2026-11-05";
const SELECT = "*, customer:chaser_customers(id, name, phone, email, is_demo), nudges:chaser_nudges(id, tone, channel, stage, sent_at, is_demo), promises:chaser_promises(id, promised_on, note, created_at, is_demo)";

test("every industry: SA names, placeholder phones, example.com emails, DEMO- refs, integer cents", () => {
  for (const key of Object.keys(DEMO_INDUSTRIES)) {
    const p = buildDemoPayload(key, TODAY);
    assert.equal(p.invoices.length, DEMO_SCENARIOS.length);
    for (const c of p.customers) {
      assert.equal(c.is_demo, true);
      if (c.phone) {
        assert.match(c.phone, /^\+27 00 000 00\d\d$/, "placeholder pattern only");
        assert.ok(isWhatsAppable(c.phone));
      }
      if (c.email) assert.match(c.email, /@example\.com$/);
    }
    for (const i of p.invoices) {
      assert.equal(i.is_demo, true);
      assert.match(i.reference, new RegExp(`^DEMO-${DEMO_INDUSTRIES[key].prefix}-\\d{4}$`));
      assert.ok(Number.isInteger(i.amount_cents) && Number.isInteger(i.amount_paid_cents));
      assert.ok(i.amount_paid_cents <= i.amount_cents);
      assert.ok(i.due_on >= i.issued_on);
      assert.equal(i.currency, "ZAR");
    }
  }
});

test("the demo covers current, due soon, every ladder stage, one broken promise and one paid", () => {
  const p = buildDemoPayload("plumber", TODAY);
  const invoices = p.invoices.map((i) => ({
    ...i, id: i.key, status: i.amount_paid_cents >= i.amount_cents ? "paid" : i.amount_paid_cents > 0 ? "partial" : "unpaid",
    paid_at: p.paid_at[i.key] ?? null,
    nudges: p.nudges.filter((x) => x.invoice_key === i.key), promises: p.promises.filter((x) => x.invoice_key === i.key),
  }));
  const a = annotate(invoices, { ladder: DEFAULT_LADDER, today: TODAY });
  const q = buildTodayQueue(a);
  const stagesDue = new Set(q.map((i) => i.ladder.nextStage.key));
  assert.deepEqual([...stagesDue].sort(), ["final", "firm", "friendly"]);
  assert.equal(brokenPromises(a).length, 1);
  assert.equal(q[0].promise.state, "broken", "broken promise tops the queue");
  assert.equal(invoices.filter((i) => i.status === "paid").length, 1);
  const s = agedSummary(invoices, TODAY);
  for (const k of ["current", "d1_30", "d31_60", "d61_90", "d90p"]) assert.ok(s.buckets[k].count > 0, `bucket ${k} populated`);
  assert.ok(s.fallingDueToday >= 1);
  assert.ok(a.some((i) => i.ladder.complete), "one ladder finished (call them)");
  assert.ok(a.some((i) => i.promise.state === "pending"));
});

test("load demo through the test backend: every row marked; remove deletes exactly the seeded rows", async () => {
  const sb = createMockClient();
  await sb.auth.signInWithPassword({ email: "owner@example.com", password: "x" });
  // a real customer + invoice + nudge first
  const { data: real } = await sb.from("chaser_customers").insert({ name: "Real Customer", phone: "+27000000077" }).select().single();
  const { data: realInv } = await sb.from("chaser_invoices").insert({ customer_id: real.id, reference: "REAL-1", amount_cents: 1000, issued_on: "2026-10-01", due_on: "2026-10-15" }).select().single();
  await sb.from("chaser_nudges").insert({ invoice_id: realInv.id, channel: "whatsapp", tone: "gentle" });

  const { data: loaded, error } = await sb.rpc("chaser_load_demo", { payload: buildDemoPayload("electrician", TODAY) });
  assert.equal(error, null);
  assert.deepEqual(loaded, { customers_created: 12, invoices_created: 12, nudges_created: 15, promises_created: 3 });
  const { data: all } = await sb.from("chaser_invoices").select(SELECT);
  const demo = all.filter((i) => i.is_demo);
  assert.equal(demo.length, 12);
  assert.ok(demo.every((i) => i.customer.is_demo && i.nudges.every((n) => n.is_demo) && i.promises.every((p) => p.is_demo)));
  assert.ok(hasDemo(all));
  assert.equal(demoIndustryOf(all), "electrician");
  const paid = demo.find((i) => i.status === "paid");
  assert.equal(paid.paid_at.slice(0, 7), "2026-10", "backdated payment: " + paid.paid_at);

  const { data: removed } = await sb.rpc("chaser_remove_demo");
  assert.deepEqual(removed, { nudges_removed: 15, promises_removed: 3, invoices_removed: 12, customers_removed: 12, customers_kept: 0 });
  const { data: left } = await sb.from("chaser_invoices").select(SELECT);
  assert.deepEqual(left.map((i) => i.reference), ["REAL-1"]);
  assert.equal(left[0].nudges.length, 1);
  assert.equal(hasDemo(left), false);
  const { data: custLeft } = await sb.from("chaser_customers").select("*");
  assert.deepEqual(custLeft.map((c) => c.name), ["Real Customer"]);
});

test("a real invoice added to a demo customer survives removal; the customer is kept", async () => {
  const sb = createMockClient();
  await sb.auth.signInWithPassword({ email: "owner@example.com", password: "x" });
  await sb.rpc("chaser_remove_demo");
  await sb.rpc("chaser_load_demo", { payload: buildDemoPayload("plumber", TODAY) });
  const { data: demoCust } = await sb.from("chaser_customers").select("*").eq("is_demo", true).limit(1);
  await sb.from("chaser_invoices").insert({ customer_id: demoCust[0].id, reference: "REAL-ON-DEMO", amount_cents: 5000, issued_on: "2026-11-01", due_on: "2026-11-10" });
  const { data: removed } = await sb.rpc("chaser_remove_demo");
  assert.equal(removed.customers_kept, 1);
  const { data: left } = await sb.from("chaser_invoices").select("*").eq("reference", "REAL-ON-DEMO");
  assert.equal(left.length, 1);
});

test("a nudge recorded on a demo invoice is demo too", async () => {
  const sb = createMockClient();
  await sb.auth.signInWithPassword({ email: "owner@example.com", password: "x" });
  await sb.rpc("chaser_load_demo", { payload: buildDemoPayload("landscaper", TODAY) });
  const { data: inv } = await sb.from("chaser_invoices").select("*").eq("is_demo", true).limit(1);
  const { data: n } = await sb.from("chaser_nudges").insert({ invoice_id: inv[0].id, channel: "email", tone: "firm" }).select().single();
  assert.equal(n.is_demo, true);
  await sb.rpc("chaser_remove_demo");
});

test("demo load is refused without a session (anon has nothing)", async () => {
  const sb = createMockClient();
  await sb.auth.signOut();
  const { error } = await sb.rpc("chaser_load_demo", { payload: buildDemoPayload("plumber", TODAY) });
  assert.equal(error.code, "42501");
});
