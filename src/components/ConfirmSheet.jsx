import { useState } from "react";
import Sheet from "./ui/Sheet.jsx";
import Icon from "./ui/Icon.jsx";

// Destructive confirmations as a real sheet with the consequence in plain
// words (spec §4). Never window.confirm().
export default function ConfirmSheet({ title, children, confirmLabel, danger = false, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function go() {
    setBusy(true); setError(null);
    try { await onConfirm(); onClose(true); } catch (e) { setError(e.message); setBusy(false); }
  }
  return (
    <Sheet onClose={() => onClose(false)} title={title}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-secondary" onClick={() => onClose(false)}>Cancel</button>
          <button type="button" className={danger ? "btn-danger" : "btn-primary"} disabled={busy} onClick={go}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      }>
      <div className="text-[15px] text-ink-2 space-y-2">{children}</div>
      {error && <p className="field-error mt-3" role="alert"><Icon name="alert" size={15} />{error}</p>}
    </Sheet>
  );
}
