import { useEffect, useState } from "react";
import { listCustomers, saveCustomer, deleteCustomer } from "../lib/db.js";
import CustomerForm from "../components/CustomerForm.jsx";
import Modal from "../components/Modal.jsx";

export default function CustomersPage() {
  const [customers, setCustomers] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try { setCustomers(await listCustomers()); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function handleSave(c) {
    await saveCustomer(c);
    setEditing(null);
    await load();
  }
  async function handleDelete(c) {
    if (!window.confirm(`Delete ${c.name}? This also deletes all their invoices.`)) return;
    await deleteCustomer(c.id);
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Customers</h1>
        <button className="btn-primary" onClick={() => setEditing("new")}>+ Add customer</button>
      </div>
      {error && <p className="text-status-critical text-sm">{error}</p>}
      {customers && customers.length === 0 && <p className="card text-mute text-center py-8">No customers yet.</p>}
      {customers && customers.length > 0 && (
        <div className="card p-0 divide-y divide-border/60">
          {customers.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{c.name}</div>
                <div className="text-xs text-dim truncate">{[c.phone, c.email].filter(Boolean).join(" · ") || "no contact details"}</div>
              </div>
              <button className="btn-ghost px-2 py-1" onClick={() => setEditing(c)}>Edit</button>
              <button className="btn-ghost px-2 py-1 hover:text-status-critical" onClick={() => handleDelete(c)}>Delete</button>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <Modal title={editing === "new" ? "Add customer" : "Edit customer"} onClose={() => setEditing(null)}>
          <CustomerForm initial={editing === "new" ? null : editing} onSave={handleSave} onCancel={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}
