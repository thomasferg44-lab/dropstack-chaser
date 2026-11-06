import { test } from "node:test";
import assert from "node:assert/strict";
import { ladderState, normaliseLadder, stageIndexOfNudge, DEFAULT_LADDER } from "../src/lib/ladder.js";

const TODAY = "2026-11-05";
const L = normaliseLadder(DEFAULT_LADDER); // friendly +1, firm +7, final +14, gap 3
const at = (iso) => `${iso}T09:30:00`; // local time, read back by isoFromTimestamp
const inv = (due, over = {}) => ({ id: "x", due_on: due, status: "unpaid", amount_cents: 1000, amount_paid_cents: 0, nudges: [], promises: [], ...over });
const nudge = (stage, on, tone) => ({ stage, tone: tone ?? { friendly: "gentle", firm: "firm", final: "final" }[stage], sent_at: at(on) });
const S = (i, today = TODAY) => ladderState(i, { ladder: L, today });

test("not yet due: friendly is next, due the day after the due date", () => {
  const s = S(inv("2026-11-10"));
  assert.equal(s.nextStage.key, "friendly");
  assert.equal(s.nextDueOn, "2026-11-11");
  assert.equal(s.dueNow, false);
});

test("due today is not overdue; one day late makes friendly due now", () => {
  assert.equal(S(inv("2026-11-05")).dueNow, false);
  const s = S(inv("2026-11-04"));
  assert.equal(s.nextStage.key, "friendly");
  assert.equal(s.nextDueOn, "2026-11-05");
  assert.equal(s.dueNow, true);
});

test("stage boundaries: day 6 is still friendly-reached, day 7 firm-reached, day 14 final-reached", () => {
  assert.equal(S(inv("2026-10-30")).reachedIndex, 0); // 6 days
  assert.equal(S(inv("2026-10-29")).reachedIndex, 1); // 7 days
  assert.equal(S(inv("2026-10-22")).reachedIndex, 2); // 14 days
});

test("first nudge starts where the invoice has got to, but never at final", () => {
  assert.equal(S(inv("2026-10-29")).nextStage.key, "firm");   // 7 days, never chased
  const long = S(inv("2026-08-01"));                           // 96 days, never chased
  assert.equal(long.nextStage.key, "firm");
  assert.equal(long.dueNow, true);
  assert.equal(long.stages[0].state, "skipped");
});

test("after a nudge the ladder moves up exactly one stage, respecting the stage day", () => {
  const s = S(inv("2026-11-01", { nudges: [nudge("friendly", "2026-11-02")] })); // 4 days overdue
  assert.equal(s.lastIndex, 0);
  assert.equal(s.nextStage.key, "firm");
  assert.equal(s.nextDueOn, "2026-11-08"); // due + 7
  assert.equal(s.dueNow, false);
  assert.deepEqual(s.stages.map((x) => x.state), ["sent", "next", "upcoming"]);
});

test("never skips firm after a friendly nudge, however late it gets", () => {
  const s = S(inv("2026-09-01", { nudges: [nudge("friendly", "2026-09-02")] }));
  assert.equal(s.nextStage.key, "firm");
  assert.equal(s.dueNow, true);
});

test("minimum gap between nudges pushes the next one out", () => {
  // firm reached long ago, but friendly was sent yesterday: firm waits 3 days
  const s = S(inv("2026-10-01", { nudges: [nudge("friendly", "2026-11-04")] }));
  assert.equal(s.nextStage.key, "firm");
  assert.equal(s.nextDueOn, "2026-11-07");
  assert.equal(s.dueNow, false);
});

test("final sent: ladder complete, nothing more is due", () => {
  const s = S(inv("2026-09-01", { nudges: [nudge("friendly", "2026-09-02"), nudge("firm", "2026-09-08"), nudge("final", "2026-09-15")] }));
  assert.equal(s.complete, true);
  assert.equal(s.dueNow, false);
  assert.equal(s.nextDueOn, null);
});

test("v1 nudges without a stage count by tone", () => {
  assert.equal(stageIndexOfNudge({ tone: "firm" }, L), 1);
  assert.equal(stageIndexOfNudge({ tone: "gentle", stage: "nope" }, L), 0);
  const s = S(inv("2026-10-01", { nudges: [{ tone: "firm", sent_at: at("2026-10-20") }] }));
  assert.equal(s.nextStage.key, "final");
});

test("an active promise pauses the ladder until the day after the promised date", () => {
  const s = S(inv("2026-10-01", { promises: [{ promised_on: "2026-11-08", created_at: at("2026-11-03") }] }));
  assert.equal(s.nextDueOn, "2026-11-09");
  assert.equal(s.pausedUntil, "2026-11-09");
  assert.equal(s.dueNow, false);
});

test("a broken promise makes the next nudge due now", () => {
  const s = S(inv("2026-10-01", { promises: [{ promised_on: "2026-11-02", created_at: at("2026-10-28") }] }));
  assert.equal(s.dueNow, true);
  assert.equal(s.nextDueOn, "2026-11-03");
});

test("auto-stop: paid and written-off invoices are off the ladder", () => {
  for (const status of ["paid", "written_off"]) {
    const s = S(inv("2026-09-01", { status, nudges: [nudge("friendly", "2026-09-02")] }));
    assert.equal(s.open, false);
    assert.equal(s.dueNow, false);
    assert.equal(s.nextStage, null);
    assert.deepEqual(s.stages.map((x) => x.state), ["sent", "stopped", "stopped"]);
  }
});

test("custom ladders from config, validated", () => {
  const custom = normaliseLadder({ stages: [{ key: "a", day: 3, tone: "gentle" }, { key: "b", day: 10, tone: "final" }], minDaysBetweenNudges: 5 });
  assert.equal(custom.minDaysBetweenNudges, 5);
  const s = ladderState(inv("2026-10-20"), { ladder: custom, today: TODAY }); // 16 days, never chased
  assert.equal(s.nextStage.key, "a"); // can't open on the final stage
  assert.throws(() => normaliseLadder({ stages: [{ key: "a", day: 5, tone: "gentle" }, { key: "b", day: 5, tone: "firm" }] }), /in order of days/);
  assert.throws(() => normaliseLadder({ stages: [{ key: "a", day: 1, tone: "shouty" }] }), /tone/);
  assert.equal(normaliseLadder(undefined).stages.length, 3);
});
