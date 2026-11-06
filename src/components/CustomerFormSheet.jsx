import { useState } from "react";
import Sheet from "./ui/Sheet.jsx";
import Icon from "./ui/Icon.jsx";
import { TextField } from "./ui/Field.jsx";
import { isWhatsAppable } from "../lib/phone.js";
import { isEmail } from "../lib/nudgeEmail.js";

export function validateCustomer(form) {
  const errors = {};
  if (!form.name.trim()) errors.name = "Enter the customer's name";
  if (form.phone?.trim() && !isWhatsAppable(form.phone)) errors.phone = "Enter a mobile number, e.g. 082 123 4567";
  if (form.email?.trim() && !isEmail(form.email)) errors.email = "Enter an email like name@company.co.za";
  return errors;
}

/** Customer fields as a form body (used on its own sheet and inside the invoice sheet). */
export function CustomerFields({ form, setForm, errors, autoFocus = true }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="space-y-4">
      <TextField label="Name" value={form.name} onChange={set("name")} error={errors.name} data-autofocus={autoFocus || undefined} autoComplete="off" />
      <TextField label="Mobile (for WhatsApp)" optional value={form.phone || ""} onChange={set("phone")} error={errors.phone} inputMode="tel" placeholder="082 123 4567" help={!errors.phone ? "One consent-based contact per customer: their own number." : null} />
      <TextField label="Email" optional type="email" value={form.email || ""} onChange={set("email")} error={errors.email} placeholder="name@company.co.za" />
    </div>
  );
}

export default function CustomerFormSheet({ initial, onSave, onClose }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", ...initial });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    const e = validateCustomer(form);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true); setError(null);
    try { await onSave(form); onClose(true); } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <Sheet onClose={() => onClose(false)} title={initial?.id ? "Edit customer" : "New customer"}
      footer={<button type="button" className="btn-primary w-full text-[17px]" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save customer"}</button>}>
      <CustomerFields form={form} setForm={setForm} errors={errors} />
      {error && <p className="field-error mt-3" role="alert"><Icon name="alert" size={15} />{error}</p>}
    </Sheet>
  );
}
