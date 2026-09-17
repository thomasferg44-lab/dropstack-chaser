import { useMemo, useState } from "react";
import { parseAmountToCents, centsToInput, formatCents } from "../lib/money.js";
import { todayISO, addDays } from "../lib/dates.js";
import { deriveStatus, STATUS_LABELS } from "../lib/status.js";
import { companyConfig } from "../../companyConfig.js";
import CustomerForm from "./CustomerForm.jsx";

/**
 * Manual add/edit. Amount fields are text inputs parsed with the same
 * parser as the CSV importer, so "R1 500,00" works here too. Cents are
 * computed on submit — no float ever touches state.
 */
export default function InvoiceForm({ initial, customers, onSave, onCancel, onCreateCustomer }) {
  const today = todayISO();
  const [form, setForm] = useState({
    customer_id: initial?.customer_id || customers[0]?.id || "",
    reference: initial?.reference || "",
    description: initial?.description || "",
    amount: initial ? centsToInput(initial.amount_cents) : "",
    amount_paid: initial ? centsToInput(initial.amount_paid_cents) : "",
    currency: initial?.currency || companyConfig.currency,
    issued_on: initial?.issued_on || today,
    due_on: initial?.due_on || addDays(today, 30),
    notes: initial?.notes || "",
    written_off: initial?.status === "written_off",
  });
  const [newCustomer, setNewCustomer] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const amount = useMemo(() => parseAmountToCents(form.amount), [form.amount]);
  const paid = useMemo(() => parseAmountToCents(form.amount_paid), [form.amount_paid]);
  const previewStatus =
    amount.cents !== null && !amount.error && !paid.error
      ? deriveStatus(amount.cents, paid.cents ?? 0, form.written_off ? "written_off" : "unpaid")
      : null;

  async function submit(e) {
    e.preventDefault();
    if (!form.customer_id) return setError("Pick a customer");
    if (amount.error) return setError(`Amount: ${amount.error}`);
    if (amount.cents === null) return setError("Amount is required");
    if (amount.cents < 0) return setError("Amount cannot be negative");
    if (paid.error) return setError(`Amount paid: ${paid.error}`);
    if ((paid.cents ?? 0) < 0) return setError("Amount paid cannot be negative");
    if (form.due_on < form.issued_on) return setError("Due date is before the issued date");

    setBusy(true);
    setError(null);
    try {
      await onSave({
        id: initial?.id,
        customer_id: form.customer_id,
        reference: form.reference,
        description: form.description,
        amount_cents: amount.cents,
        amount_paid_cents: paid.cents ?? 0,
        currency: form.currency.toUpperCase(),
        issued_on: form.issued_on,
        due_on: form.due_on,
        notes: form.notes,
        status: form.written_off ? "written_off" : undefined,
        clearWrittenOff: initial?.status === "written_off" && !form.written_off,
      });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (newCustomer) {
    return (
      <div>
        <p className="text-sm text-mute mb-3">New customer</p>
        <CustomerForm
          onCancel={() => setNewCustomer(false)}
          onSave={async (c) => {
            const saved = await onCreateCustomer(c);
            setForm({ ...form, customer_id: saved.id });
            setNewCustomer(false);
          }}
        />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="field">
        <label>Customer</label>
        <div className="flex gap-2">
          <select value={form.customer_id} onChange={set("customer_id")} required>
            <option value="">— pick —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button type="button" className="btn-secondary shrink-0" onClick={() => setNewCustomer(true)}>+ New</button>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="field">
          <label>Reference (your invoice no.)</label>
          <input value={form.reference} onChange={set("reference")} placeholder="INV-001" />
        </div>
        <div className="field">
          <label>Description</label>
          <input value={form.description} onChange={set("description")} placeholder="Geyser replacement" />
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="field">
          <label>Amount</label>
          <input value={form.amount} onChange={set("amount")} placeholder="1500.00" inputMode="decimal" required autoFocus={!initial} />
          {amount.error && <span className="text-xs text-status-critical">{amount.error}</span>}
        </div>
        <div className="field">
          <label>Amount paid</label>
          <input value={form.amount_paid} onChange={set("amount_paid")} placeholder="0.00" inputMode="decimal" />
          {paid.error && <span className="text-xs text-status-critical">{paid.error}</span>}
        </div>
        <div className="field">
          <label>Currency</label>
          <input value={form.currency} onChange={set("currency")} maxLength={3} />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="field">
          <label>Issued on</label>
          <input type="date" value={form.issued_on} onChange={set("issued_on")} required />
        </div>
        <div className="field">
          <label>Due on</label>
          <input type="date" value={form.due_on} onChange={set("due_on")} required />
        </div>
      </div>
      <div className="field">
        <label>Notes</label>
        <textarea rows={2} value={form.notes} onChange={set("notes")} />
      </div>
      <div className="flex items-center justify-between text-sm">
        <label className="flex items-center gap-2 text-mute">
          <input type="checkbox" checked={form.written_off} onChange={set("written_off")} />
          Written off
        </label>
        {previewStatus && (
          <span className="text-mute">
            Status: <strong className="text-text">{STATUS_LABELS[previewStatus]}</strong>
            {amount.cents !== null && (
              <> · owed {formatCents(Math.max(0, amount.cents - (paid.cents ?? 0)), form.currency, companyConfig.locale)}</>
            )}
          </span>
        )}
      </div>
      {error && <p className="text-status-critical text-sm">{error}</p>}
      <div className="flex justify-end gap-2 mt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : initial ? "Save changes" : "Add invoice"}</button>
      </div>
    </form>
  );
}
