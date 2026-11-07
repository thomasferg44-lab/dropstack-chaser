import { test } from "node:test";
import assert from "node:assert/strict";
import { annotate, buildTodayQueue, brokenPromises, ladderFinished, sentToday, queueReason } from "../src/lib/queue.js";
import { DEFAULT_LADDER } from "../src/lib/ladder.js";

const TODAY = "2026-11-05";
const at = (iso) => `${iso}T09:30:00`;
const inv = (id, due, amount, over = {}) => ({ id, reference: id, due_on: due, amount_cents: amount, amount_paid_cents: 0, status: "unpaid", nudges: [], promises: [], ...over });
const Q = (list) => buildTodayQueue(annotate(list, { ladder: DEFAULT_LADDER, today: TODAY }));

test("queue holds only what is due now; broken promise first, then amount desc", () => {
  const list = [
    inv("small", "2026-10-20", 50000),
    inv("big", "2026-10-25", 900000),
    inv("notdue", "2026-11-20", 999999),
    inv("promised", "2026-10-01", 10000, { promises: [{ promised_on: "2026-11-10", created_at: at("2026-11-01") }] }),
    inv("broken", "2026-10-01", 20000, { promises: [{ promised_on: "2026-11-02", created_at: at("2026-10-28") }] }),
    inv("paid", "2026-09-01", 70000, { status: "paid", amount_paid_cents: 70000 }),
    inv("waiting", "2026-10-01", 80000, { nudges: [{ stage: "friendly", tone: "gentle", sent_at: at("2026-11-04") }] }),
  ];
  assert.deepEqual(Q(list).map((i) => i.id), ["broken", "big", "small"]);
});

test("auto-stop: recording full payment removes the item from the queue immediately", () => {
  const before = [inv("a", "2026-10-01", 1000), inv("b", "2026-10-01", 2000)];
  assert.equal(Q(before).length, 2);
  const after = [inv("a", "2026-10-01", 1000, { status: "paid", amount_paid_cents: 1000 }), before[1]];
  assert.deepEqual(Q(after).map((i) => i.id), ["b"]);
});

test("sending a nudge moves the item out of today's queue", () => {
  const list = [inv("a", "2026-10-20", 1000, { nudges: [{ stage: "firm", tone: "firm", sent_at: at(TODAY) }] })];
  assert.equal(Q(list).length, 0);
  assert.equal(sentToday(list, TODAY), 1);
});

test("broken promises list and finished ladders", () => {
  const a = annotate([
    inv("b1", "2026-10-01", 100, { promises: [{ promised_on: "2026-11-01", created_at: at("2026-10-28") }] }),
    inv("b2", "2026-10-01", 100, { promises: [{ promised_on: "2026-10-20", created_at: at("2026-10-10") }] }),
    inv("done", "2026-08-01", 100, { nudges: ["gentle", "firm", "final"].map((tone, i) => ({ tone, sent_at: at(`2026-08-0${2 + i * 3}`) })) }),
  ], { ladder: DEFAULT_LADDER, today: TODAY });
  assert.deepEqual(brokenPromises(a).map((i) => i.id), ["b2", "b1"]);
  assert.deepEqual(ladderFinished(a).map((i) => i.id), ["done"]);
});

test("queue reason reads plainly", () => {
  const [b] = Q([inv("b", "2026-10-01", 100, { promises: [{ promised_on: "2026-11-03", created_at: at("2026-10-28") }] })]);
  assert.equal(queueReason(b, TODAY), "Broken promise · payment was due 2 days ago");
  const [f] = Q([inv("f", "2026-11-04", 100)]);
  assert.equal(queueReason(f, TODAY), "Friendly nudge due today");
});

test("a broken promise on a finished ladder still heads the queue until it's followed up", () => {
  const sent = ["gentle", "firm", "final"].map((tone, i) => ({ tone, sent_at: at(`2026-10-0${2 + i * 3}`) }));
  const p = [{ promised_on: "2026-11-02", created_at: at("2026-10-20") }];
  const list = [inv("big", "2026-10-20", 900000), inv("done", "2026-09-20", 100, { nudges: sent, promises: p })];
  assert.deepEqual(Q(list).map((i) => i.id), ["done", "big"]);
  const followed = [list[0], { ...list[1], nudges: [...sent, { tone: "final", sent_at: at("2026-11-04") }] }];
  assert.deepEqual(Q(followed).map((i) => i.id), ["big"]);
});
