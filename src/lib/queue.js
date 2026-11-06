// The today queue: the dashboard's primary list. Every open invoice whose next
// ladder nudge is due today or earlier, broken promises first, then the
// biggest balance. One tap on a row opens the composer for that nudge.
import { ladderState } from "./ladder.js";
import { promiseState } from "./promises.js";
import { outstandingCents } from "./money.js";
import { daysOverdue, isoFromTimestamp, daysBetween } from "./dates.js";

const isOpen = (inv) => inv.status === "unpaid" || inv.status === "partial";

/** Ladder + promise state for every invoice (open or not), computed once. */
export function annotate(invoices, { ladder, today }) {
  return (invoices || []).map((inv) => ({
    ...inv,
    owedCents: outstandingCents(inv),
    daysOverdue: daysOverdue(inv.due_on, today),
    ladder: ladderState(inv, { ladder, today }),
    promise: promiseState(inv, inv.promises, today),
  }));
}

/**
 * Items due now, ordered: broken promise first, then amount owed (largest
 * first), then most overdue, then reference for a stable order.
 */
export function buildTodayQueue(annotated) {
  return annotated
    .filter((i) => isOpen(i) && i.ladder.open && !i.ladder.complete && i.ladder.dueNow)
    .sort((a, b) =>
      (b.promise.state === "broken") - (a.promise.state === "broken") ||
      b.owedCents - a.owedCents ||
      b.daysOverdue - a.daysOverdue ||
      String(a.reference ?? "").localeCompare(String(b.reference ?? "")));
}

/** Open invoices with a broken promise, worst (longest broken) first. */
export function brokenPromises(annotated) {
  return annotated
    .filter((i) => isOpen(i) && i.promise.state === "broken")
    .sort((a, b) => b.promise.daysLate - a.promise.daysLate || b.owedCents - a.owedCents);
}

/** Open invoices whose ladder is finished: time for a phone call, not a message. */
export function ladderFinished(annotated) {
  return annotated.filter((i) => isOpen(i) && i.ladder.complete);
}

/** Nudges recorded today across all invoices (the "done today" count). */
export function sentToday(invoices, today) {
  let n = 0;
  for (const inv of invoices || []) for (const x of inv.nudges || []) if (isoFromTimestamp(x.sent_at) === today) n++;
  return n;
}

/** One plain line saying why a row is in the queue. */
export function queueReason(item, today) {
  if (item.promise.state === "broken") {
    const d = item.promise.daysLate;
    return `Broken promise · payment was due ${d} day${d === 1 ? "" : "s"} ago`;
  }
  const stage = item.ladder.nextStage;
  const late = daysBetween(item.ladder.nextDueOn, today);
  const when = late <= 0 ? "due today" : `due ${late} day${late === 1 ? "" : "s"} ago`;
  return `${stage.label} nudge ${when}`;
}
