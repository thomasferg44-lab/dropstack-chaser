import { useState } from "react";
import Sheet from "./ui/Sheet.jsx";
import Icon from "./ui/Icon.jsx";
import { useToast } from "./ui/Toast.jsx";
import { DEMO_INDUSTRIES, buildDemoPayload } from "../lib/demoData.js";
import { todayISO } from "../lib/dates.js";
import { useData } from "../state/DataStore.jsx";
import { companyConfig } from "../../companyConfig.js";

/** Pick a trade, one tap loads a believable set of books. All marked DEMO. */
export default function DemoSheet({ onClose }) {
  const { loadDemo, invoices } = useData();
  const toast = useToast();
  const allowed = (companyConfig.demo?.industries ?? Object.keys(DEMO_INDUSTRIES)).filter((k) => DEMO_INDUSTRIES[k]);
  const [industry, setIndustry] = useState(allowed[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const realCount = (invoices ?? []).filter((i) => !i.is_demo).length;

  async function go() {
    setBusy(true); setError(null);
    try {
      const r = await loadDemo(buildDemoPayload(industry, todayISO()));
      toast(`Demo loaded: ${r.invoices_created} ${DEMO_INDUSTRIES[industry].label.toLowerCase()} invoices.`);
      onClose(true);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Sheet onClose={() => onClose(false)} title="Load demo data"
      footer={<button type="button" className="btn-primary w-full text-[17px]" disabled={busy} onClick={go} data-testid="demo-load">{busy ? "Loading…" : `Load ${DEMO_INDUSTRIES[industry].label.toLowerCase()} demo`}</button>}>
      <div className="space-y-4">
        <p className="text-[15px] text-ink-3">Twelve sample invoices for a South African {DEMO_INDUSTRIES[industry].label.toLowerCase()}: some not due yet, some at each nudge stage, one broken promise and one paid. Every row is marked DEMO and comes out again with one tap in Setup.</p>
        <div role="radiogroup" aria-label="Trade" className="grid grid-cols-3 gap-2">
          {allowed.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={industry === k} onClick={() => setIndustry(k)}
              className={`rounded-[12px] min-h-[52px] text-[15px] font-medium border transition-colors ${industry === k ? "border-[#0071e3] bg-info-soft text-info" : "border-hairline bg-white text-ink"}`}>
              {DEMO_INDUSTRIES[k].label}
            </button>
          ))}
        </div>
        <ul className="text-[14px] text-ink-2 space-y-1.5">
          <li className="flex gap-2"><Icon name="check" size={16} className="text-good mt-0.5 flex-shrink-0" />Names and jobs are invented; phone numbers are +27 00 000 00xx placeholders, emails use example.com. Nothing can reach a real person.</li>
          <li className="flex gap-2"><Icon name="check" size={16} className="text-good mt-0.5 flex-shrink-0" />Demo emails are shown and logged, never sent.</li>
        </ul>
        {realCount > 0 && <p className="rounded-[12px] bg-warn-soft text-warn px-3 py-2 text-[14px]">Your {realCount} real invoice{realCount === 1 ? "" : "s"} stay as they are. Demo rows sit alongside them until you remove them.</p>}
        {error && <p className="field-error" role="alert"><Icon name="alert" size={15} />{error}</p>}
      </div>
    </Sheet>
  );
}
