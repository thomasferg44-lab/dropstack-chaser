import { useState } from "react";
import Icon from "./ui/Icon.jsx";
import { STEPS, checklistState } from "../lib/onboarding.js";
import { prefs } from "../lib/cache.js";
import { linkProps } from "../hooks/useRoute.js";
import { useData } from "../state/DataStore.jsx";
import { companyConfig } from "../../companyConfig.js";

export const confirmKey = (uid) => `configConfirmed:${uid}`;
const dismissKey = (uid) => `checklistDismissed:${uid}`;

/**
 * First-run checklist: check details → demo or first invoice → first nudge.
 * Shown until complete, dismissible after. Each step has exactly one action.
 */
export default function Checklist({ onLoadDemo, onAddInvoice, queueFirst, onNudgeFirst }) {
  const { user, invoices, schema } = useData();
  const [dismissed, setDismissed] = useState(() => Boolean(prefs.get(dismissKey(user.id))));
  const s = checklistState({ configConfirmed: prefs.get(confirmKey(user.id)), invoices, dismissed });
  if (!s.show) return null;
  const canDemo = companyConfig.demo?.allowed !== false && schema === "v2";

  const action = (key) => {
    if (s.done[key] || s.next !== key) return null;
    if (key === "config") return <a className="btn-primary !py-2.5" {...linkProps("/setup")} data-testid="checklist-config">Check details</a>;
    if (key === "data") return canDemo
      ? <button className="btn-primary !py-2.5" onClick={onLoadDemo} data-testid="checklist-demo">Load demo data</button>
      : <button className="btn-primary !py-2.5" onClick={onAddInvoice}>Add invoice</button>;
    if (key === "action") return queueFirst
      ? <button className="btn-primary !py-2.5" onClick={onNudgeFirst} data-testid="checklist-nudge">Nudge {queueFirst.customer?.name?.split(" ")[0] ?? "them"}</button>
      : <a className="btn-primary !py-2.5" {...linkProps("/invoices")}>Open invoices</a>;
    return null;
  };

  return (
    <section className="card p-5 animate-rise" aria-labelledby="checklist-h" data-testid="checklist">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id="checklist-h" className="text-[17px] font-semibold">{s.complete ? "You're set up" : "Get going in a minute"}</h2>
        <span className="text-[13px] text-ink-3 tabular">{s.count} of {STEPS.length}</span>
      </div>
      <ol className="space-y-3">
        {STEPS.map((step, i) => {
          const done = s.done[step.key];
          return (
            <li key={step.key} className="flex items-center gap-3">
              <span className={`h-7 w-7 rounded-full flex-shrink-0 inline-flex items-center justify-center text-[13px] font-semibold ${done ? "bg-good-soft text-good" : s.next === step.key ? "bg-info-soft text-info" : "bg-fill text-ink-3"}`}>
                {done ? <Icon name="check" size={16} /> : i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className={`text-[15px] ${done ? "text-ink-3 line-through decoration-ink-4" : "font-medium"}`}>{step.label}</div>
                {s.next === step.key && <div className="text-[13px] text-ink-3">{step.help}</div>}
              </div>
              {action(step.key)}
            </li>
          );
        })}
      </ol>
      {s.canDismiss && (
        <button className="btn-plain mt-3 -ml-3" onClick={() => { prefs.set(dismissKey(user.id), true); setDismissed(true); }}>Hide this</button>
      )}
    </section>
  );
}
