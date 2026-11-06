// First-run checklist: config confirmed → demo loaded or first real invoice →
// first nudge sent (or a payment/promise recorded). Shown until complete,
// dismissible after. The steps are derived from real data wherever possible;
// only "confirmed" and "dismissed" are remembered (per device).
export const STEPS = [
  { key: "config", label: "Check your business details", help: "Name, how customers pay you, and your email sender." },
  { key: "data", label: "Load demo data or add your first invoice", help: "See it working with sample books, or bring in your own." },
  { key: "action", label: "Send your first nudge", help: "Tap the top item in Today and send it. It takes about ten seconds." },
];

export function checklistState({ configConfirmed, invoices, dismissed }) {
  const list = invoices || [];
  const done = {
    config: Boolean(configConfirmed),
    data: list.length > 0,
    // the core action: a nudge sent, a promise logged or a payment recorded
    action: list.some((i) => (i.nudges || []).length > 0 || (i.promises || []).length > 0 || Boolean(i.paid_by)),
  };
  const complete = STEPS.every((s) => done[s.key]);
  return {
    done,
    complete,
    next: STEPS.find((s) => !done[s.key])?.key ?? null,
    count: STEPS.filter((s) => done[s.key]).length,
    // Shown until complete; once complete it can be dismissed.
    show: !complete || !dismissed,
    canDismiss: complete,
  };
}
