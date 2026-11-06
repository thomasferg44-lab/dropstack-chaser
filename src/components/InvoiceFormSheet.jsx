import { useMemo, useState } from "react";
import Sheet from "./ui/Sheet.jsx";
import Icon from "./ui/Icon.jsx";
import { TextField, NumberField, Field } from "./ui/Field.jsx";
import { CustomerFields, validateCustomer } from "./CustomerFormSheet.jsx";
import { parseAmountToCents, centsToInput, formatCents } from "../lib/money.js";
import { todayISO, addDays } from "../lib/dates.js";
import { deriveStatus, STATUS_LABELS } from "../lib/status.js";
import { useData } from "../state/DataStore.jsx";
import { companyConfig } from "../../companyConfig.js";

/**
 * Manual add/edit. Amounts are text parsed by the same parser as the CSV
 * importer ("R1 500,00" works), turned into integer cents on save. Errors sit
 * under the field they belong to, and the owner's input is kept.
 */
export default function InvoiceFormSheet({ initial, onClose, onSaved }) {
  const { customers, saveInvoice, saveCustomer } = useData();
  const today = todayISO();
  const [form, setForm] = useState({
    customer_id: initial?.customer_id || "",
    reference: initial?.reference || "",
    description: initial?.description || "",
    amount: initial ? centsToInput(initial.amount_cents) : "",
    amount_paid: initial && initial.amount_paid_cents ? centsToInput(initial.amount_paid_cents) : "",
    issued_on: initial?.issued_on || today,
    due_on: initial?.due_on || addDays(today, 7),
    notes: initial?.notes || "",
    written_off: initial?.status === "written_off",
  });
  const [newCust, setNewCust] = useState(customers.length === 0 && !initial);
  const [cust, setCust] = useState({ name: "", phone: "", email: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const currency = initial?.currency || companyConfig.currency;

  const amount = useMemo(() => parseAmountToCents(form.amount), [form.amount]);
  const paid = useMemo(() => parseAmountToCents(form.amount_paid), [form.amount_paid]);
  const preview = amount.cents !== null && !amount.error && !paid.error
    ? deriveStatus(amount.cents, paid.cents ?? 0, form.written_off ? "written_off" : "unpaid") : null;

  function validate() {
    const e = {};
    if (newCust) Object.assign(e, Object.fromEntries(Object.entries(validateCustomer(cust)).map(([k, v]) => [`cust_${k}`, v])));
    else if (!form.customer_id) e.customer_id = "Pick who owes this, or add a new customer";
    if (amount.error) e.amount = `${amount.error}. Try 1500 or 1 500,00`;
    else if (amount.cents === null) e.amount = "Enter the invoice amount";
    else if (amount.cents <= 0) e.amount = "Enter an amount above 0";
    if (paid.error) e.amount_paid = `${paid.error}. Try 500 or 500,00`;
    else if ((paid.cents ?? 0) < 0) e.amount_paid = "Amount paid can't be negative";
    if (!form.issued_on) e.issued_on = "Pick the invoice date";
    if (!form.due_on) e.due_on = "Pick the due date";
    else if (form.issued_on && form.due_on < form.issued_on) e.due_on = "The due date can't be before the invoice date";
    return e;
  }

  async function submit() {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true); setError(null);
    try {
      let customerId = form.customer_id;
      if (newCust) {
        const saved = await saveCustomer(cust);
        customerId = saved.id;
        setForm((f) => ({ ...f, customer_id: saved.id }));
        setNewCust(false); // a retry after an invoice error won't create the customer twice
      }
      const saved = await saveInvoice({
        id: initial?.id, customer_id: customerId, reference: form.reference, description: form.description,
        amount_cents: amount.cents, amount_paid_cents: paid.cents ?? 0, currency,
        issued_on: form.issued_on, due_on: form.due_on, notes: form.notes,
        status: form.written_off ? "written_off" : undefined,
        clearWrittenOff: initial?.status === "written_off" && !form.written_off,
      });
      onSaved?.(saved);
      onClose(true);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Sheet onClose={() => onClose(false)} title={initial ? "Edit invoice" : "New invoice"} wide
      footer={<button type="button" className="btn-primary w-full text-[17px]" disabled={busy} onClick={submit}>{busy ? "Saving…" : initial ? "Save changes" : "Add invoice"}</button>}>
      <div className="space-y-4">
        {newCust ? (
          <div className="rounded-[14px] bg-fill p-4 space-y-3">
            <div className="flex items-center justify-between"><span className="text-[15px] font-semibold">New customer</span>
              {customers.length > 0 && <button type="button" className="btn-plain !min-h-[36px] text-[14px]" onClick={() => setNewCust(false)}>Pick existing</button>}</div>
            <CustomerFields form={cust} setForm={setCust} errors={{ name: errors.cust_name, phone: errors.cust_phone, email: errors.cust_email }} />
          </div>
        ) : (
          <Field label="Customer" error={errors.customer_id}>
            {(a) => (
              <div className="flex gap-2">
                <select {...a} className="input" value={form.customer_id} onChange={set("customer_id")}>
                  <option value="">Choose a customer</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button type="button" className="btn-secondary flex-shrink-0" onClick={() => setNewCust(true)}><Icon name="plus" size={18} />New</button>
              </div>
            )}
          </Field>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          <TextField label="Your invoice number" optional value={form.reference} onChange={set("reference")} placeholder="INV-1042" />
          <TextField label="What it was for" optional value={form.description} onChange={set("description")} placeholder="Geyser replacement" help="Goes into the nudge: “for the geyser replacement”." />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <NumberField label="Amount" prefix="R" value={form.amount} onChange={set("amount")} error={errors.amount} placeholder="1 500,00" />
          <NumberField label="Already paid" prefix="R" value={form.amount_paid} onChange={set("amount_paid")} error={errors.amount_paid} placeholder="0,00" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Invoice date" type="date" value={form.issued_on} onChange={set("issued_on")} error={errors.issued_on} />
          <TextField label="Due date" type="date" value={form.due_on} onChange={set("due_on")} error={errors.due_on} />
        </div>
        <Field label="Notes" optional>{(a) => <textarea {...a} className="input" rows={2} value={form.notes} onChange={set("notes")} />}</Field>
        <label className="flex items-center justify-between gap-3 min-h-[44px] text-[15px]">
          <span>Written off</span>
          <input type="checkbox" className="h-5 w-5 accent-[#0071e3]" checked={form.written_off} onChange={set("written_off")} />
        </label>
        {preview && amount.cents !== null && (
          <p className="text-[14px] text-ink-3" data-testid="invoice-preview">
            Status: <strong className="text-ink">{STATUS_LABELS[preview]}</strong> · outstanding{" "}
            <strong className="text-ink tabular">{formatCents(Math.max(0, amount.cents - (paid.cents ?? 0)), currency, companyConfig.locale)}</strong>
          </p>
        )}
        {error && <p className="field-error" role="alert"><Icon name="alert" size={15} />{error}</p>}
      </div>
    </Sheet>
  );
}
