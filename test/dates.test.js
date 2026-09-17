import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFlexibleDate, addDays, daysBetween, daysOverdue } from "../src/lib/dates.js";

test("ISO", () => {
  assert.equal(parseFlexibleDate("2026-09-17"), "2026-09-17");
  assert.equal(parseFlexibleDate("2026/09/17"), "2026-09-17");
  assert.equal(parseFlexibleDate("2026-09-17T10:00:00Z"), "2026-09-17");
  assert.equal(parseFlexibleDate("2026-9-7"), "2026-09-07");
});

test("South African day-first", () => {
  assert.equal(parseFlexibleDate("17/09/2026"), "2026-09-17");
  assert.equal(parseFlexibleDate("17-09-2026"), "2026-09-17");
  assert.equal(parseFlexibleDate("17.09.2026"), "2026-09-17");
  assert.equal(parseFlexibleDate("17/09/26"), "2026-09-17");
  assert.equal(parseFlexibleDate("7/9/2026"), "2026-09-07"); // ambiguous → day-first
  assert.equal(parseFlexibleDate("01/02/2026"), "2026-02-01");
  assert.equal(parseFlexibleDate("31/12/2025 14:30"), "2025-12-31");
});

test("unambiguous US month-first is accepted", () => {
  assert.equal(parseFlexibleDate("09/17/2026"), "2026-09-17");
});

test("month names", () => {
  assert.equal(parseFlexibleDate("17 Sep 2026"), "2026-09-17");
  assert.equal(parseFlexibleDate("17 September 2026"), "2026-09-17");
  assert.equal(parseFlexibleDate("17-Sep-26"), "2026-09-17");
  assert.equal(parseFlexibleDate("Sep 17, 2026"), "2026-09-17");
  assert.equal(parseFlexibleDate("September 17 2026"), "2026-09-17");
});

test("Excel serial", () => {
  assert.equal(parseFlexibleDate("46012"), "2025-12-21");
});

test("invalid", () => {
  assert.equal(parseFlexibleDate(""), null);
  assert.equal(parseFlexibleDate("hello"), null);
  assert.equal(parseFlexibleDate("30/02/2026"), null);
  assert.equal(parseFlexibleDate("32/01/2026"), null);
  assert.equal(parseFlexibleDate("13/13/2026"), null);
  assert.equal(parseFlexibleDate(null), null);
});

test("arithmetic", () => {
  assert.equal(addDays("2026-01-31", 30), "2026-03-02");
  assert.equal(daysBetween("2026-09-01", "2026-09-17"), 16);
  assert.equal(daysOverdue("2026-08-01", "2026-09-17"), 47);
  assert.equal(daysOverdue("2026-10-01", "2026-09-17"), -14);
});
