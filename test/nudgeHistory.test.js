import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summariseNudges, nudgeLabel, overNudgeWarning, describeAgo, describeNudge, OVER_NUDGE_DAYS,
} from "../src/lib/nudgeHistory.js";

const TODAY = "2026-09-19";
// Midday local time so the UTC offset can't shift the date in either direction.
const at = (iso, tone = "gentle", channel = "whatsapp") => ({
  id: iso, tone, channel, sent_at: new Date(`${iso}T12:00:00`).toISOString(),
});

test("no nudges", () => {
  const s = summariseNudges([], TODAY);
  assert.equal(s.count, 0);
  assert.equal(s.daysSince, null);
  assert.equal(s.recent, false);
  assert.equal(nudgeLabel(s), null);
  assert.equal(overNudgeWarning(s, "Bob"), null);
});

test("counts and finds the most recent regardless of input order", () => {
  const s = summariseNudges([at("2026-09-01"), at("2026-09-14", "firm", "email"), at("2026-09-08")], TODAY);
  assert.equal(s.count, 3);
  assert.equal(s.lastIso, "2026-09-14");
  assert.equal(s.daysSince, 5);
  assert.equal(s.last.tone, "firm");
  assert.deepEqual(s.history.map((n) => n.id), ["2026-09-14", "2026-09-08", "2026-09-01"]);
  assert.equal(nudgeLabel(s), "nudged 3× · last 5 days ago");
});

test("the warning fires up to and including the boundary, and not beyond", () => {
  for (const days of [0, 1, 2, OVER_NUDGE_DAYS]) {
    const iso = `2026-09-${String(19 - days).padStart(2, "0")}`;
    assert.equal(summariseNudges([at(iso)], TODAY).recent, true, `${days} days should warn`);
  }
  const older = summariseNudges([at("2026-09-15")], TODAY); // 4 days
  assert.equal(older.recent, false);
  assert.equal(overNudgeWarning(older, "Bob"), null);
});

test("the warning names the customer, the tone and when", () => {
  const w = overNudgeWarning(summariseNudges([at("2026-09-18", "firm")], TODAY), "Bob");
  assert.match(w, /Firm nudge/);
  assert.match(w, /Bob/);
  assert.match(w, /yesterday/);
  const noName = overNudgeWarning(summariseNudges([at("2026-09-19")], TODAY), "");
  assert.match(noName, /this customer/);
  assert.match(noName, /today/);
});

test("a future timestamp reads as today rather than negative days", () => {
  const s = summariseNudges([at("2026-09-25")], TODAY);
  assert.equal(describeAgo(s.daysSince), "today");
  assert.equal(s.recent, true);
});

test("rows without a timestamp are ignored, not counted", () => {
  const s = summariseNudges([null, {}, { sent_at: null }, at("2026-09-10")], TODAY);
  assert.equal(s.count, 1);
});

test("history rows read as tone, channel and date", () => {
  // en-ZA abbreviates September as "Sep" or "Sept" depending on ICU version.
  assert.match(describeNudge(at("2026-09-14", "final", "email")), /^Final · Email · 14 Sept? 2026$/);
});
