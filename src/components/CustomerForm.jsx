import { useState } from "react";

export default function CustomerForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", ...initial });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Name is required");
    setBusy(true);
    setError(null);
    try {
      await onSave(form);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="field">
        <label>Name</label>
        <input value={form.name} onChange={set("name")} autoFocus required />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="field">
          <label>Phone (for WhatsApp)</label>
          <input value={form.phone || ""} onChange={set("phone")} placeholder="082 123 4567" inputMode="tel" />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={form.email || ""} onChange={set("email")} placeholder="name@example.com" />
        </div>
      </div>
      {error && <p className="text-status-critical text-sm">{error}</p>}
      <div className="flex justify-end gap-2 mt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save customer"}</button>
      </div>
    </form>
  );
}
