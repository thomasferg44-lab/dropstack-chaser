import { useMemo, useState } from "react";
import Icon from "../components/ui/Icon.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import CustomerFormSheet from "../components/CustomerFormSheet.jsx";
import ConfirmSheet from "../components/ConfirmSheet.jsx";
import { money, plural } from "../components/InvoiceBits.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { useData } from "../state/DataStore.jsx";
import { outstandingCents, sumCents } from "../lib/money.js";

const isOpen = (i) => i.status === "unpaid" || i.status === "partial";

/** Customers with what each one owes, biggest first. */
export default function CustomersPage() {
  const { customers, invoices, saveCustomer, deleteCustomer } = useData();
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const owed = new Map();
    const count = new Map();
    for (const i of invoices ?? []) {
      count.set(i.customer_id, (count.get(i.customer_id) ?? 0) + 1);
      if (isOpen(i)) owed.set(i.customer_id, sumCents([owed.get(i.customer_id) ?? 0, outstandingCents(i)]));
    }
    const q = query.trim().toLowerCase();
    return customers
      .filter((c) => !q || [c.name, c.phone, c.email].filter(Boolean).some((s) => s.toLowerCase().includes(q)))
      .map((c) => ({ ...c, owed: owed.get(c.id) ?? 0, invoices: count.get(c.id) ?? 0 }))
      .sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name));
  }, [customers, invoices, query]);

  if (!invoices) return <div className="group-list">{[0, 1, 2].map((i) => <div key={i} className="group-row"><Skeleton className="h-4 w-40" /></div>)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input type="search" className="search" placeholder="Search name, number or email" aria-label="Search customers" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="btn-primary !py-2.5 flex-shrink-0" onClick={() => setEditing("new")}><Icon name="plus" size={18} />New</button>
      </div>
      {customers.length === 0 ? (
        <EmptyState icon="users" title="No customers yet" action={<button className="btn-primary w-full sm:w-auto" onClick={() => setEditing("new")}>Add a customer</button>}>
          Customers are added with their invoices too, or from a spreadsheet on the Import tab.
        </EmptyState>
      ) : (
        <div className="group-list" data-testid="customer-list">
          {rows.map((c) => (
            <div key={c.id} className="group-row">
              <button className="flex-1 min-w-0 text-left min-h-[44px]" onClick={() => setEditing(c)}>
                <div className="flex items-center gap-2"><span className="text-[16px] font-semibold truncate">{c.name}</span>{c.is_demo && <span className="pill-neutral !h-[20px] !text-[11px]">Demo</span>}</div>
                <div className="text-[13px] text-ink-3 truncate">{[c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"}</div>
              </button>
              <div className="text-right flex-shrink-0">
                <div className="text-[16px] font-semibold tabular">{money(c.owed)}</div>
                <div className="text-[12px] text-ink-3">{plural(c.invoices, "invoice")}</div>
              </div>
              <button className="h-11 w-11 inline-flex items-center justify-center rounded-full text-ink-3 hover:bg-fill flex-shrink-0" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}><Icon name="trash" size={18} /></button>
            </div>
          ))}
        </div>
      )}
      {editing && <CustomerFormSheet initial={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSave={async (c) => { await saveCustomer(c); toast(c.id ? "Customer saved." : "Customer added."); }} />}
      {deleting && (
        <ConfirmSheet title={`Delete ${deleting.name}?`} confirmLabel="Delete" danger onClose={() => setDeleting(null)}
          onConfirm={async () => { await deleteCustomer(deleting.id); toast("Customer deleted."); }}>
          <p>This also deletes {plural(rows.find((r) => r.id === deleting.id)?.invoices ?? 0, "invoice")} and their nudge history. This can't be undone.</p>
        </ConfirmSheet>
      )}
    </div>
  );
}
