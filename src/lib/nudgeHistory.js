// Nudge history and the over-nudge guard.
//
// The guard warns, it never blocks: the owner knows their customer and this
// tool does not. But hounding someone costs the client the relationship, which
// is worth more than the invoice, so the warning is prominent and names the
// last nudge rather than being a vague caution.

import { todayISO, daysBetween, isoFromTimestamp, formatDate } from "./dates.js";

/** Nudged this many days ago or fewer and you get a warning. Inclusive. */
export const OVER_NUDGE_DAYS = 3;

const TONE_LABELS = { gentle: "Gentle", firm: "Firm", final: "Final" };
const CHANNEL_LABELS = { whatsapp: "WhatsApp", email: "Email" };

/** "today" | "yesterday" | "5 days ago". Clock skew never reads as the future. */
export function describeAgo(days) {
  if (days === null || days === undefined) return null;
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * { count, last, lastIso, daysSince, recent, history } — history newest first.
 * `recent` drives the over-nudge warning.
 */
export function summariseNudges(nudges, today = todayISO()) {
  const history = (nudges || [])
    .filter((n) => n && n.sent_at)
    .slice()
    .sort((a, b) => (a.sent_at < b.sent_at ? 1 : a.sent_at > b.sent_at ? -1 : 0));

  const last = history[0] || null;
  const lastIso = last ? isoFromTimestamp(last.sent_at) : null;
  const daysSince = lastIso ? daysBetween(lastIso, today) : null;

  return {
    count: history.length,
    last,
    lastIso,
    daysSince,
    recent: daysSince !== null && daysSince <= OVER_NUDGE_DAYS,
    history,
  };
}

/** "nudged 2× · last 5 days ago", or null if never nudged. */
export function nudgeLabel(summary) {
  if (!summary.count) return null;
  return `nudged ${summary.count}× · last ${describeAgo(summary.daysSince)}`;
}

/** The warning text, or null when there is nothing to warn about. */
export function overNudgeWarning(summary, customerName) {
  if (!summary.recent) return null;
  const who = customerName || "this customer";
  const when = describeAgo(summary.daysSince);
  const tone = summary.last?.tone ? `${TONE_LABELS[summary.last.tone] || summary.last.tone} nudge` : "nudge";
  return `You sent a ${tone} to ${who} ${when}. Chasing again this soon can cost you the relationship.`;
}

/** "Firm · WhatsApp · 12 Sep 2026" for one history row. */
export function describeNudge(nudge, locale = "en-ZA") {
  const tone = TONE_LABELS[nudge.tone] || nudge.tone;
  const channel = CHANNEL_LABELS[nudge.channel] || nudge.channel;
  return `${tone} · ${channel} · ${formatDate(isoFromTimestamp(nudge.sent_at), locale)}`;
}
