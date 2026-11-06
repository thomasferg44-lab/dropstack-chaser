// Promise-to-pay. The customer says "Friday"; the owner logs it. A promised
// date that passes without the invoice being paid is a BROKEN PROMISE: it
// jumps to the top of the today queue and the dashboard alerts.
//
// Pure: promises are rows { promised_on, note, created_at }, dates are
// "YYYY-MM-DD" strings, nothing here talks to the database.
import { addDays, daysBetween, isoFromTimestamp, formatDate } from "./dates.js";

export const PROMISE_NOTE_MAX = 500;
const isOpen = (inv) => inv.status === "unpaid" || inv.status === "partial";

/** Newest first, by when it was logged (not by the promised date). */
export function sortPromises(promises) {
  return [...(promises || [])].filter((p) => p && p.promised_on)
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

/** The promise that counts now: the most recently logged one. */
export function activePromise(promises) {
  return sortPromises(promises)[0] ?? null;
}

/**
 * State of the current promise on an invoice, as of `today`:
 *   none       no promise logged
 *   pending    promised date still ahead
 *   due-today  promised for today
 *   broken     date passed and the invoice is still open
 *   kept       paid on or before the promised date
 *   kept-late  paid, but after the promised date
 *   closed     written off / paid with no date recorded
 */
export function promiseState(invoice, promises, today) {
  const p = activePromise(promises ?? invoice?.promises);
  if (!p) return { state: "none", promise: null };
  if (isOpen(invoice)) {
    const d = daysBetween(today, p.promised_on); // >0 ahead, <0 passed
    if (d > 0) return { state: "pending", promise: p, daysLeft: d };
    if (d === 0) return { state: "due-today", promise: p, daysLeft: 0 };
    return { state: "broken", promise: p, daysLate: -d };
  }
  if (invoice?.status === "paid") {
    const paidOn = isoFromTimestamp(invoice.paid_at);
    if (!paidOn) return { state: "closed", promise: p };
    return { state: paidOn <= p.promised_on ? "kept" : "kept-late", promise: p, paidOn };
  }
  return { state: "closed", promise: p };
}

export function isBrokenPromise(invoice, promises, today) {
  return promiseState(invoice, promises, today).state === "broken";
}

/**
 * Every promise with its outcome, newest first. An older promise was:
 *   broken       if its date had passed before the next one was logged
 *   rescheduled  if the next one was logged on or before its date
 * The newest one takes promiseState().
 */
export function promiseHistory(invoice, promises, today) {
  const list = sortPromises(promises ?? invoice?.promises);
  return list.map((p, i) => {
    if (i === 0) return { ...p, outcome: promiseState(invoice, list, today).state };
    const next = list[i - 1];
    const loggedNext = isoFromTimestamp(next.created_at) ?? today;
    return { ...p, outcome: loggedNext > p.promised_on ? "broken" : "rescheduled" };
  });
}

/** How many earlier promises lapsed. Feeds the composer's wording. */
export function brokenCount(invoice, promises, today) {
  return promiseHistory(invoice, promises, today).filter((p) => p.outcome === "broken").length;
}

/** Validate the promise sheet. { ok, errors: { promisedOn?, note? }, value } */
export function validatePromise({ promisedOn, note }, today) {
  const errors = {};
  const d = String(promisedOn ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) errors.promisedOn = "Pick the date they said they'd pay";
  else if (d < today) errors.promisedOn = "That date has passed. Pick today or a later date";
  else if (d > addDays(today, 366)) errors.promisedOn = "Pick a date within the next year";
  const n = String(note ?? "").trim();
  if (n.length > PROMISE_NOTE_MAX) errors.note = `Keep the note under ${PROMISE_NOTE_MAX} characters`;
  return { ok: Object.keys(errors).length === 0, errors, value: { promised_on: d, note: n || null } };
}

/** "Promised 7 Nov" / "Promise broken · 2 days late" style labels. */
export function promiseLabel(ps, locale = "en-ZA") {
  if (!ps?.promise) return null;
  const date = formatDate(ps.promise.promised_on, locale);
  switch (ps.state) {
    case "pending": return `Promised ${date}`;
    case "due-today": return `Promised for today`;
    case "broken": return `Promise broken · was ${date}`;
    case "kept": return `Promise kept · ${date}`;
    case "kept-late": return `Paid after promised ${date}`;
    default: return `Promised ${date}`;
  }
}
