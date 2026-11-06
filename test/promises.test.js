import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate } from "../src/lib/dates.js";
import { promiseState, isBrokenPromise, promiseHistory, brokenCount, validatePromise, activePromise, promiseLabel } from "../src/lib/promises.js";

const TODAY = "2026-11-05";
const at = (iso, t = "10:00:00") => `${iso}T${t}`;
const open = (promises, over = {}) => ({ status: "unpaid", amount_cents: 1000, amount_paid_cents: 0, promises, ...over });
const P = (on, logged) => ({ promised_on: on, created_at: at(logged) });

test("no promise", () => {
  assert.equal(promiseState(open([]), null, TODAY).state, "none");
  assert.equal(isBrokenPromise(open([]), null, TODAY), false);
});

test("pending, due today, broken: by the promised date against today", () => {
  assert.equal(promiseState(open([P("2026-11-07", "2026-11-04")]), null, TODAY).state, "pending");
  assert.equal(promiseState(open([P("2026-11-05", "2026-11-01")]), null, TODAY).state, "due-today");
  const b = promiseState(open([P("2026-11-03", "2026-10-30")]), null, TODAY);
  assert.equal(b.state, "broken");
  assert.equal(b.daysLate, 2);
  assert.equal(isBrokenPromise(open([P("2026-11-04", "2026-10-30")]), null, TODAY), true);
});

test("partial payment does not un-break a promise; the invoice is still open", () => {
  assert.equal(promiseState(open([P("2026-11-01", "2026-10-25")], { status: "partial", amount_paid_cents: 500 }), null, TODAY).state, "broken");
});

test("paid: kept on or before the date, kept-late after it", () => {
  assert.equal(promiseState({ status: "paid", paid_at: at("2026-11-03"), promises: [P("2026-11-03", "2026-10-30")] }, null, TODAY).state, "kept");
  assert.equal(promiseState({ status: "paid", paid_at: at("2026-11-04"), promises: [P("2026-11-03", "2026-10-30")] }, null, TODAY).state, "kept-late");
  assert.equal(promiseState({ status: "paid", paid_at: null, promises: [P("2026-11-03", "2026-10-30")] }, null, TODAY).state, "closed");
  assert.equal(isBrokenPromise({ status: "written_off", promises: [P("2026-10-01", "2026-09-30")] }, null, TODAY), false);
});

test("the newest-logged promise is the active one", () => {
  const list = [P("2026-11-20", "2026-11-04"), P("2026-11-01", "2026-10-25")];
  assert.equal(activePromise(list).promised_on, "2026-11-20");
  assert.equal(promiseState(open(list), null, TODAY).state, "pending");
});

test("history: an older promise was broken if it lapsed before the next, rescheduled otherwise", () => {
  const list = [P("2026-11-20", "2026-11-04"), P("2026-11-01", "2026-10-25"), P("2026-10-20", "2026-10-18")];
  const h = promiseHistory(open(list), null, TODAY);
  assert.deepEqual(h.map((x) => x.outcome), ["pending", "broken", "broken"]);
  assert.equal(brokenCount(open(list), null, TODAY), 2);
  const resched = promiseHistory(open([P("2026-11-20", "2026-10-28"), P("2026-11-01", "2026-10-25")]), null, TODAY);
  assert.deepEqual(resched.map((x) => x.outcome), ["pending", "rescheduled"]);
});

test("validatePromise: date required, not past, within a year, note length", () => {
  assert.equal(validatePromise({ promisedOn: "", note: "" }, TODAY).errors.promisedOn, "Pick the date they said they'd pay");
  assert.match(validatePromise({ promisedOn: "2026-11-04" }, TODAY).errors.promisedOn, /passed/);
  assert.equal(validatePromise({ promisedOn: "2026-11-05" }, TODAY).ok, true);
  assert.match(validatePromise({ promisedOn: "2028-01-01" }, TODAY).errors.promisedOn, /year/);
  assert.match(validatePromise({ promisedOn: "2026-11-06", note: "x".repeat(501) }, TODAY).errors.note, /500/);
  assert.deepEqual(validatePromise({ promisedOn: "2026-11-06", note: "  Friday  " }, TODAY).value, { promised_on: "2026-11-06", note: "Friday" });
});

test("labels say the word, not just a colour", () => {
  assert.equal(promiseLabel(promiseState(open([P("2026-11-03", "2026-10-30")]), null, TODAY)), `Promise broken · was ${formatDate("2026-11-03")}`);
  assert.equal(promiseLabel(promiseState(open([P("2026-11-07", "2026-11-01")]), null, TODAY)), `Promised ${formatDate("2026-11-07")}`);
});
