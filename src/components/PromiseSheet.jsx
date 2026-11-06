import { useState } from "react";
import Sheet from "./ui/Sheet.jsx";
import Icon from "./ui/Icon.jsx";
import { TextField, Field } from "./ui/Field.jsx";
import { useToast } from "./ui/Toast.jsx";
import { validatePromise, PROMISE_NOTE_MAX } from "../lib/promises.js";
import { todayISO, addDays, formatDate } from "../lib/dates.js";
import { useData } from "../state/DataStore.jsx";
import { companyConfig } from "../../companyConfig.js";

// Next Friday, the 25th (payday), end of the month: the dates customers say.
function quickDates(today) {
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const friday = addDays(today, ((5 - dow + 7) % 7) || 7);
  const payday = d < 25 ? `${y}-${String(m).padStart(2, "0")}-25` : addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, 24);
  const endOfMonth = addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
  return [
    { label: "Friday", value: friday },
    { label: "Payday (25th)", value: payday },
    { label: "Month end", value: endOfMonth },
  ].filter((x, i, a) => a.findIndex((z) => z.value === x.value) === i);
}

/** "They said Friday": log it, and the ladder waits until Friday has passed. */
export default function PromiseSheet({ invoice, onClose }) {
  const { logPromise } = useData();
  const toast = useToast();
  const today = todayISO();
  const [promisedOn, setPromisedOn] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    const v = validatePromise({ promisedOn, note }, today);
    setErrors(v.errors);
    if (!v.ok) return;
    setBusy(true); setError(null);
    try {
      const { queued } = await logPromise({ invoice, promisedOn: v.value.promised_on, note: v.value.note });
      toast(queued ? "Saved on this phone. It will sync when you're back online." : `Promise logged. Nudges pause until after ${formatDate(v.value.promised_on, companyConfig.locale)}.`);
      onClose(true);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Sheet onClose={() => onClose(false)} title="Log a promise to pay"
      footer={<button type="button" className="btn-primary w-full text-[17px]" disabled={busy} onClick={save}>{busy ? "Saving…" : "Log promise"}</button>}>
      <div className="space-y-4">
        <p className="text-[15px] text-ink-3">{invoice.customer?.name} said they'd pay {invoice.reference ? `${invoice.reference} ` : ""}on a date. If it passes unpaid, it goes to the top of Today as a broken promise.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick dates">
          {quickDates(today).map((q) => (
            <button key={q.value} type="button" onClick={() => { setPromisedOn(q.value); setErrors({}); }}
              className={`btn !min-h-[44px] !text-[14px] ${promisedOn === q.value ? "bg-info-soft text-info" : "bg-fill text-ink"}`}>
              {q.label} · {formatDate(q.value, companyConfig.locale).replace(/ \d{4}$/, "")}
            </button>
          ))}
        </div>
        <TextField label="Promised date" type="date" min={today} value={promisedOn} onChange={(e) => setPromisedOn(e.target.value)} error={errors.promisedOn} />
        <Field label="Note" optional error={errors.note} help={`What they said, in a few words. Up to ${PROMISE_NOTE_MAX} characters.`}>
          {(a) => <textarea {...a} className="input" rows={2} value={note} maxLength={PROMISE_NOTE_MAX + 50} onChange={(e) => setNote(e.target.value)} placeholder="Paying after payday" />}
        </Field>
        {error && <p className="field-error" role="alert"><Icon name="alert" size={15} />{error}</p>}
      </div>
    </Sheet>
  );
}
