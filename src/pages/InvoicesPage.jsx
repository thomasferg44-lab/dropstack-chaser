import { useMemo, useState } from "react";
import Icon from "../components/ui/Icon.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import { Segmented } from "../components/ui/Field.jsx";
import { InvoiceRow, money, plural, PromisePill, StatusPill } from "../components/InvoiceBits.jsx";
import InvoiceFormSheet from "../components/InvoiceFormSheet.jsx";
import { navigate } from "../hooks/useRoute.js";
import { useData } from "../state/DataStore.jsx";
import { annotate } from "../lib/queue.js";
import { AGED_BUCKETS, agedBucketFor } from "../lib/aged.js";
import { matchesQuery } from "../lib/filters.js";
import { normaliseLadder } from "../lib/ladder.js";
import { todayISO } from "../lib/dates.js";
import { sumCents } from "../lib/money.js";
import { companyConfig } from "../../companyConfig.js";

const VIEWS = [
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "all", label: "All" },
];
const isOpen = (i) => i.status === "unpaid" || i.status === "partial";

/** Every invoice, most overdue first. Search, view, customer and age filters. */
export default function InvoicesPage() {
  const { invoices, customers } = useData();
  const today = todayISO();
  const params = new URLSearchParams(window.location.search);
  const [view, setView] = useState(params.get("view") ?? "open");
  const [bucket, setBucket] = useState(params.get("bucket") ?? "");
  const [customerId, setCustomerId] = useState("");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const ladder = useMemo(() => normaliseLadder(companyConfig.ladder), []);
  const annotated = useMemo(() => annotate(invoices ?? [], { ladder, today }), [invoices, ladder, today]);

  const rows = useMemo(() => annotated
    .filter((i) => view === "all" || (view === "open" && isOpen(i)) || (view === "overdue" && isOpen(i) && i.daysOverdue > 0) || (view === "paid" && i.status === "paid"))
    .filter((i) => !bucket || (isOpen(i) && agedBucketFor(i.daysOverdue) === bucket))
    .filter((i) => !customerId || i.customer_id === customerId)
    .filter((i) => matchesQuery(i, query))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.owedCents - a.owedCents), [annotated, view, bucket, customerId, query]);
  const hiddenPaid = useMemo(() => (view === "open" && query.trim() ? annotated.filter((i) => !isOpen(i) && matchesQuery(i, query)).length : 0), [annotated, view, query]);

  if (!invoices) return <div className="group-list">{[0, 1, 2, 3].map((i) => <div key={i} className="group-row"><div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-24" /></div><Skeleton className="h-5 w-20" /></div>)}</div>;

  const total = sumCents(rows.filter(isOpen).map((r) => r.owedCents));
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input type="search" className="search" placeholder="Search customer or invoice number" aria-label="Search invoices" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="btn-primary !py-2.5 flex-shrink-0" onClick={() => setAdding(true)}><Icon name="plus" size={18} /><span className="hidden sm:inline">New invoice</span><span className="sm:hidden">New</span></button>
      </div>
      <Segmented label="Show" value={view} onChange={(v) => { setView(v); if (v === "paid") setBucket(""); }} options={VIEWS} />
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0" role="group" aria-label="How long overdue">
        <Chip on={!bucket} onClick={() => setBucket("")}>Any age</Chip>
        {AGED_BUCKETS.map((b) => <Chip key={b.key} on={bucket === b.key} onClick={() => { setBucket(bucket === b.key ? "" : b.key); if (view === "paid") setView("open"); }}>{b.label}</Chip>)}
      </div>
      {customers.length > 1 && (
        <select className="input !min-h-[44px] !py-2" aria-label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">All customers</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}

      <div className="flex items-baseline justify-between px-1 text-[13px] text-ink-3">
        <span>{plural(rows.length, "invoice")}{view !== "paid" && rows.length > 0 ? ` · ${money(total)} outstanding` : ""}</span>
        {hiddenPaid > 0 && <button className="text-action min-h-[44px]" onClick={() => setView("all")}>{hiddenPaid} paid also match</button>}
      </div>

      {invoices.length === 0 ? (
        <EmptyState icon="invoice" title="No invoices yet" action={<button className="btn-primary w-full sm:w-auto" onClick={() => setAdding(true)}>Add an invoice</button>}>
          Add what you're owed by hand, or import a spreadsheet from the Import tab.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState icon="search" title="Nothing matches" action={<button className="btn-secondary w-full sm:w-auto" onClick={() => { setView("all"); setBucket(""); setCustomerId(""); setQuery(""); }}>Clear filters</button>}>
          Try a different search, or show all invoices.
        </EmptyState>
      ) : (
        <div className="group-list" data-testid="invoice-list">
          {rows.map((i) => (
            <InvoiceRow key={i.id} inv={i} to={`/invoices/${i.id}`} testId="invoice-row"
              right={<span className="inline-flex gap-1 justify-end">{i.promise.state === "broken" || i.promise.state === "pending" ? <PromisePill ps={i.promise} /> : <StatusPill inv={i} />}</span>} />
          ))}
        </div>
      )}
      {adding && <InvoiceFormSheet onClose={() => setAdding(false)} onSaved={(row) => row?.id && navigate(`/invoices/${row.id}`)} />}
    </div>
  );
}

function Chip({ on, onClick, children }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`flex-shrink-0 rounded-full px-3.5 min-h-[44px] text-[14px] font-medium transition-colors ${on ? "bg-chrome text-white" : "bg-white text-ink-2 shadow-card"}`}>
      {children}
    </button>
  );
}
