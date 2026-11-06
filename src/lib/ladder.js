// The escalation ladder: which nudge an invoice is due for, and when.
//
// Nothing here sends anything. It only works out what the owner should be
// prompted to send, so the today queue can put it in front of them with one
// tap. WhatsApp sending stays manual, permanently.
//
// Rules (also written next to `ladder` in companyConfig.js):
//   - stage i becomes due `day` days after the invoice's due date
//   - the first nudge starts at the highest stage the invoice has reached,
//     but never at the final stage: nobody gets a final notice out of the blue
//   - after that, each nudge moves up exactly one stage
//   - at least minDaysBetweenNudges days between two nudges
//   - a promise to pay pauses the ladder until the day after the promised date
//   - paid or written off: off the ladder, nothing is due (auto-stop)
import { addDays, daysOverdue, isoFromTimestamp } from "./dates.js";
import { activePromise } from "./promises.js";

export const DEFAULT_LADDER = {
  stages: [
    { key: "friendly", label: "Friendly", day: 1, tone: "gentle" },
    { key: "firm", label: "Firm", day: 7, tone: "firm" },
    { key: "final", label: "Final", day: 14, tone: "final" },
  ],
  minDaysBetweenNudges: 3,
};
const TONES = ["gentle", "firm", "final"];

/** Config → a clean ladder. Throws with a readable message on a broken config. */
export function normaliseLadder(raw) {
  const src = raw && Array.isArray(raw.stages) && raw.stages.length ? raw : DEFAULT_LADDER;
  const stages = src.stages.map((s, i) => {
    const key = String(s.key ?? "").trim();
    if (!key) throw new Error(`Ladder stage ${i + 1} has no key in companyConfig.js`);
    if (!TONES.includes(s.tone)) throw new Error(`Ladder stage "${key}" needs a tone of gentle, firm or final`);
    const day = Number(s.day);
    if (!Number.isInteger(day) || day < 0) throw new Error(`Ladder stage "${key}" needs a whole number of days`);
    return { key, label: String(s.label ?? key), day, tone: s.tone };
  });
  for (let i = 1; i < stages.length; i++) {
    if (stages[i].day <= stages[i - 1].day) throw new Error("Ladder stages must be in order of days, each later than the last");
    if (stages.slice(0, i).some((s) => s.key === stages[i].key)) throw new Error(`Ladder stage key "${stages[i].key}" is used twice`);
  }
  const gap = Number(src.minDaysBetweenNudges ?? DEFAULT_LADDER.minDaysBetweenNudges);
  return { stages, minDaysBetweenNudges: Number.isInteger(gap) && gap >= 0 ? gap : DEFAULT_LADDER.minDaysBetweenNudges };
}

/** Which stage a recorded nudge counts as: its stage key, else its tone. */
export function stageIndexOfNudge(nudge, ladder) {
  if (nudge?.stage) {
    const i = ladder.stages.findIndex((s) => s.key === nudge.stage);
    if (i !== -1) return i;
  }
  // v1 rows have no stage: the highest stage using that tone.
  let found = -1;
  ladder.stages.forEach((s, i) => { if (s.tone === nudge?.tone) found = i; });
  return found;
}

const maxIso = (...xs) => xs.filter(Boolean).sort().at(-1);
const isOpen = (inv) => inv.status === "unpaid" || inv.status === "partial";

/**
 * Where an invoice sits on the ladder as of `today`.
 * {
 *   open, complete, dueNow,
 *   lastIndex      highest stage already sent (-1 = none)
 *   reachedIndex   highest stage the days overdue have reached (-1 = none)
 *   nextIndex      stage of the next nudge (null when complete or closed)
 *   nextStage, nextDueOn ("YYYY-MM-DD"), pausedUntil (promise), lastNudgeOn
 *   stages: [{ ...stage, state: "sent"|"skipped"|"next"|"upcoming", sentOn, dueOn }]
 * }
 */
export function ladderState(invoice, { ladder: rawLadder, today, promises } = {}) {
  const ladder = rawLadder?.stages?.[0]?.tone ? rawLadder : normaliseLadder(rawLadder);
  const { stages, minDaysBetweenNudges } = ladder;
  const nudges = invoice.nudges || [];
  const sentOn = {};
  let lastIndex = -1;
  let lastNudgeOn = null;
  for (const n of nudges) {
    const on = isoFromTimestamp(n.sent_at);
    const i = stageIndexOfNudge(n, ladder);
    if (i > lastIndex) lastIndex = i;
    if (i !== -1 && (!sentOn[i] || on > sentOn[i])) sentOn[i] = on;
    if (on && (!lastNudgeOn || on > lastNudgeOn)) lastNudgeOn = on;
  }
  const days = daysOverdue(invoice.due_on, today);
  let reachedIndex = -1;
  stages.forEach((s, i) => { if (days >= s.day) reachedIndex = i; });

  const base = { lastIndex, reachedIndex, lastNudgeOn, daysOverdue: days };
  // sent | next | skipped (passed over, never sent) | upcoming | stopped (closed invoice)
  const stageView = (nextIndex, nextDueOn, closed = false) => stages.map((s, i) => {
    let state;
    if (sentOn[i]) state = "sent";
    else if (closed) state = "stopped";
    else if (i === nextIndex) state = "next";
    else if (i < (nextIndex ?? stages.length)) state = "skipped";
    else state = "upcoming";
    return { ...s, sentOn: sentOn[i] ?? null, dueOn: i === nextIndex ? nextDueOn : addDays(invoice.due_on, s.day), state };
  });

  if (!isOpen(invoice)) {
    return { ...base, open: false, complete: false, dueNow: false, nextIndex: null, nextStage: null, nextDueOn: null, pausedUntil: null, stages: stageView(null, null, true) };
  }

  let nextIndex = lastIndex + 1;
  if (nextIndex >= stages.length) {
    return { ...base, open: true, complete: true, dueNow: false, nextIndex: null, nextStage: null, nextDueOn: null, pausedUntil: null, stages: stageView(null, null) };
  }
  if (lastIndex === -1 && reachedIndex > 0) {
    // Start where the invoice has got to, but never on the final stage.
    nextIndex = Math.min(reachedIndex, stages.length - 2);
    if (nextIndex < 0) nextIndex = 0;
  }

  const stageDate = addDays(invoice.due_on, stages[nextIndex].day);
  const gapDate = lastNudgeOn ? addDays(lastNudgeOn, minDaysBetweenNudges) : null;
  const p = activePromise(promises ?? invoice.promises);
  const promiseDate = p ? addDays(p.promised_on, 1) : null;
  const nextDueOn = maxIso(stageDate, gapDate, promiseDate);
  const pausedUntil = promiseDate && promiseDate > today && promiseDate === nextDueOn ? promiseDate : null;

  return {
    ...base,
    open: true,
    complete: false,
    dueNow: nextDueOn <= today,
    nextIndex,
    nextStage: stages[nextIndex],
    nextDueOn,
    pausedUntil,
    stages: stageView(nextIndex, nextDueOn),
  };
}
