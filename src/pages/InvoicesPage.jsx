import { useEffect, useState } from "react";
import { listCustomers, listInvoices, saveInvoice, deleteInvoice, saveCustomer } from "../lib/db.js";
import { formatCents, outstandingCents, sumCents } from "../lib/money.js";
import { formatDate, daysOverdue } from "../lib/dates.js";
import { companyConfig } from "../../companyConfig.js";
import InvoiceForm from "../components/InvoiceForm.jsx";
import Modal from "../components/Modal.jsx";
import StatusPill from "../components/StatusPill.jsx";

/**
 * Stage 1: a plain list with manual add/edit. The real dashboard (headline
 * outstanding number, aging buckets, sorting, filters) is Stage 4 and will
 * replace this page.
 */
export default function InvoicesPage({ onNavigate }) {
  const [invoices, setInvoices] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [editing, setEditing] = useState(null); // null | "new" | invoice
  const [error, setError] = useState(null);

  async function load() {
    try {
      const [inv, cust] = await Promise.all([listInvoices(), listCustomers()]);
      setInvoices(inv);
      setCustomers(cust);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function handleSave(invoice) {
    await saveInvoice(invoice);
    setEditing(null);
    await load();
  }

  async function handleDelete(inv) {
    if (!window.confirm(`Delete invoice ${inv.reference || ""} for ${inv.customer?.name}?`)) return;
    await deleteInvoice(inv.id);
    await load();
  }

  async function handleCreateCustomer(c) {
    const saved = await saveCustomer(c);
    setCustomers(await listCustomers());
    return saved;
  }

  const open = (invoices || []).filter((i) => i.status !== "paid" && i.status !== "written_off");
  const outstanding = sumCents(open.map(outstandingCents));
  const { currency, locale } = companyConfig;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-dim">Outstanding</div>
          <div className="text-3xl font-semibold">{invoices ? formatCents(outstanding, currency, locale) : "…"}</div>
          <div className="text-xs text-mute">{open.length} unpaid invoice{open.length === 1 ? "" : "s"}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => onNavigate("import")}>Import CSV</button>
          <button className="btn-primary" onClick={() => setEditing("new")}>+ Add invoice</button>
        </div>
      </div>

      {error && <p className="text-status-critical text-sm">{error}</p>}

      {invoices && invoices.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-mute mb-3">No invoices yet.</p>
          <p className="text-sm text-dim">Import a CSV of what you're owed, or add one by hand.</p>
        </div>
      )}

      {invoices && invoices.length > 0 && (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-dim uppercase">
              <tr className="border-b border-border">
                <th className="text-left p-3">Customer</th>
                <th className="text-left p-3">Ref</th>
                <th className="text-right p-3">Amount</th>
                <th className="text-right p-3">Owed</th>
                <th className="text-left p-3">Due</th>
                <th className="text-left p-3">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const over = daysOverdue(inv.due_on);
                const isOpen = inv.status !== "paid" && inv.status !== "written_off";
                return (
                  <tr key={inv.id} className="border-b border-border/60 last:border-0">
                    <td className="p-3">
                      <div className="font-medium">{inv.customer?.name}</div>
                      {inv.description && <div className="text-xs text-dim">{inv.description}</div>}
                    </td>
                    <td className="p-3 text-mute">{inv.reference || "—"}</td>
                    <td className="p-3 text-right tabular-nums">{formatCents(inv.amount_cents, inv.currency, locale)}</td>
                    <td className="p-3 text-right tabular-nums">{formatCents(outstandingCents(inv), inv.currency, locale)}</td>
                    <td className="p-3 whitespace-nowrap">
                      {formatDate(inv.due_on, locale)}
                      {isOpen && over > 0 && <div className="text-xs text-status-due">{over}d overdue</div>}
                    </td>
                    <td className="p-3"><StatusPill status={inv.status} /></td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <button className="btn-ghost px-2 py-1" onClick={() => setEditing(inv)}>Edit</button>
                      <button className="btn-ghost px-2 py-1 hover:text-status-critical" onClick={() => handleDelete(inv)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal title={editing === "new" ? "Add invoice" : "Edit invoice"} onClose={() => setEditing(null)}>
          <InvoiceForm
            initial={editing === "new" ? null : editing}
            customers={customers}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
            onCreateCustomer={handleCreateCustomer}
          />
        </Modal>
      )}
    </div>
  );
}
