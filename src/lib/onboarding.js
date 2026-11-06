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
    // The core action, done by the owner in this tool: a nudge sent, a promise
    // logged or a payment recorded. Demo rows arrive with backdated history,
    // which is the seed's, not the owner's, so only actions at or after the
    // invoice landed here count.
    action: list.some((i) => {
      const since = Date.parse(i.created_at ?? "") - 60000 || -Infinity;
      const mine = (ts) => !ts || Date.parse(ts) >= since;
      return (i.nudges || []).some((n) => mine(n.sent_at)) || (i.promises || []).some((p) => mine(p.created_at)) || (Boolean(i.paid_by) && mine(i.paid_at));
    }),
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
