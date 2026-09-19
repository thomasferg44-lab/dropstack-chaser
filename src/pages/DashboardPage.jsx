import { useEffect, useMemo, useState } from "react";
import { listCustomers, listInvoices, saveInvoice, deleteInvoice, saveCustomer, recordNudge } from "../lib/db.js";
import { formatCents } from "../lib/money.js";
import { formatDate, todayISO } from "../lib/dates.js";
import { summariseNudges, nudgeLabel } from "../lib/nudgeHistory.js";
import { BUCKETS, summarise, enrich, sortMostOverdue } from "../lib/aging.js";
import { STATUS_FILTERS, DEFAULT_FILTERS, filterInvoices, countHiddenByStatus } from "../lib/filters.js";
import { companyConfig } from "../../companyConfig.js";
import InvoiceForm from "../components/InvoiceForm.jsx";
import NudgeSheet from "../components/NudgeSheet.jsx";
import Modal from "../components/Modal.jsx";
import StatusPill from "../components/StatusPill.jsx";

const TEXT = {
  current: "text-status-current",
  due: "text-status-due",
  late: "text-status-late",
  critical: "text-status-critical",
};
const RING = {
  current: "border-status-current",
  due: "border-status-due",
  late: "border-status-late",
  critical: "border-status-critical",
};

/**
 * The product: one big number, four buckets, the list sorted by pain.
 * Everything is derived from stored cents on each render.
 */
export default function DashboardPage({ onNavigate }) {
  const [invoices, setInvoices] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const bucket = filters.bucket;
  const setBucket = (b) => setFilters((f) => ({ ...f, bucket: b }));
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const filtersActive = filters.status !== "open" || filters.customerId || filters.query.trim();
  const [editing, setEditing] = useState(null);
  const [nudging, setNudging] = useState(null);
  const [error, setError] = useState(null);
  const today = todayISO();
  const { currency, locale } = companyConfig;

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

  const summary = useMemo(() => summarise(invoices || [], today), [invoices, today]);
  const enriched = useMemo(() => enrich(invoices || [], today), [invoices, today]);
  const rows = useMemo(() => sortMostOverdue(filterInvoices(enriched, filters)), [enriched, filters]);
  const hidden = useMemo(() => countHiddenByStatus(enriched, filters), [enriched, filters]);

  async function handleSave(inv) {
    await saveInvoice(inv);
    setEditing(null);
    await load();
  }
  async function handleDelete(inv) {
    if (!window.confirm(`Delete invoice ${inv.reference || ""} for ${inv.customer?.name}?`)) return;
    await deleteInvoice(inv.id);
    await load();
  }
  async function handleNudgeSent({ invoiceId, channel, tone }) {
    await recordNudge({ invoiceId, channel, tone });
    await load();
  }
  async function handleCreateCustomer(c) {
    const saved = await saveCustomer(c);
    setCustomers(await listCustomers());
    return saved;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Headline */}
      <section className="card py-6 sm:py-8">
        <div className="text-xs uppercase tracking-wider text-mute">You are owed</div>
        <div className="text-4xl sm:text-6xl font-semibold tracking-tight tabular-nums mt-1 break-all">
          {invoices ? formatCents(summary.outstanding, currency, locale) : "…"}
        </div>
        {invoices && (
          <div className="text-sm text-mute mt-2">
            {summary.count === 0 ? (
              "Nothing outstanding."
            ) : (
              <>
                across <span className="text-text">{summary.count}</span> unpaid invoice{summary.count === 1 ? "" : "s"}
                {summary.oldestDays > 0 && (
                  <>
                    {" · "}oldest is <span className={TEXT[summary.oldestDays > 60 ? "critical" : summary.oldestDays > 30 ? "late" : "due"]}>
                      {summary.oldestDays} day{summary.oldestDays === 1 ? "" : "s"} overdue
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <button className="btn-primary" onClick={() => setEditing("new")}>+ Add invoice</button>
          <button className="btn-secondary" onClick={() => onNavigate("import")}>Import CSV</button>
        </div>
      </section>

      {error && <p className="text-status-critical text-sm">{error}</p>}

      {/* Aging buckets */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {BUCKETS.map((b) => {
          const v = summary.buckets[b.key];
          const active = bucket === b.key;
          return (
            <button
              key={b.key}
              onClick={() => setBucket(active ? null : b.key)}
              className={`card text-left transition border-l-4 ${RING[b.key]} ${active ? "bg-border/60" : "hover:bg-border/30"}`}
              aria-pressed={active}
            >
              <div className={`text-xs font-medium ${TEXT[b.key]}`}>{b.label}</div>
              <div className="text-[10px] text-dim">{b.hint}</div>
              <div className="text-lg font-semibold tabular-nums mt-1">{formatCents(v.total, currency, locale)}</div>
              <div className="text-xs text-mute">{v.count} invoice{v.count === 1 ? "" : "s"}</div>
            </button>
          );
        })}
      </section>

      {/* Filters + search */}
      <section className="flex flex-col sm:flex-row gap-2">
        <input
          type="search"
          placeholder="Search customer or reference"
          value={filters.query}
          onChange={(e) => setFilter("query", e.target.value)}
          className="sm:flex-1"
          aria-label="Search"
        />
        <select value={filters.status} onChange={(e) => setFilter("status", e.target.value)} className="sm:w-40" aria-label="Status">
          {STATUS_FILTERS.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <select value={filters.customerId} onChange={(e) => setFilter("customerId", e.target.value)} className="sm:w-48" aria-label="Customer">
          <option value="">All customers</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </section>

      {/* List */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="text-mute">
            {bucket ? (
              <>
                Showing <span className={TEXT[bucket]}>{BUCKETS.find((b) => b.key === bucket).label}</span>{" "}
                <button className="underline text-dim" onClick={() => setBucket(null)}>clear</button>
              </>
            ) : (
              "Most overdue first"
            )}
            {(filtersActive || bucket) && (
              <>
                {" · "}
                <button className="underline text-dim" onClick={() => setFilters(DEFAULT_FILTERS)}>reset filters</button>
              </>
            )}
          </div>
          <div className="text-xs text-dim">
            {rows.length} shown
            {hidden > 0 && filters.status === "open" && (
              <>
                {" · "}
                <button className="underline" onClick={() => setFilter("status", "all")}>
                  {hidden} paid / written-off hidden
                </button>
              </>
            )}
          </div>
        </div>

        {invoices && rows.length === 0 && (
          <div className="card text-center py-10 text-mute">
            {invoices.length === 0 ? "No invoices yet. Import a CSV or add one." : "Nothing matches these filters."}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {rows.map((inv) => (
            <InvoiceRow
              key={inv.id}
              inv={inv}
              today={today}
              locale={locale}
              onEdit={() => setEditing(inv)}
              onDelete={() => handleDelete(inv)}
              onNudge={() => setNudging(inv)}
            />
          ))}
        </div>
      </section>

      {nudging && (
        <NudgeSheet invoice={nudging} onClose={() => setNudging(null)} onSent={handleNudgeSent} />
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

function InvoiceRow({ inv, today, locale, onEdit, onDelete, onNudge }) {
  const overdue = inv.daysOverdue > 0;
  const nudges = summariseNudges(inv.nudges, today);
  const nudged = nudgeLabel(nudges);
  return (
    <div className={`card flex flex-wrap items-center gap-x-4 gap-y-2 border-l-4 ${RING[inv.bucket]}`}>
      <div className="flex-1 min-w-[10rem]">
        <div className="font-medium truncate">{inv.customer?.name}</div>
        <div className="text-xs text-dim truncate">
          {[inv.reference, inv.description].filter(Boolean).join(" · ") || "no reference"}
        </div>
      </div>
      <div className="text-right">
        <div className="font-semibold tabular-nums">{formatCents(inv.owedCents, inv.currency, locale)}</div>
        {inv.status === "partial" && (
          <div className="text-[11px] text-dim tabular-nums">of {formatCents(inv.amount_cents, inv.currency, locale)}</div>
        )}
      </div>
      <div className="w-full sm:w-auto sm:min-w-[9rem] text-sm">
        <div className={`${TEXT[inv.bucket]} font-medium`}>
          {overdue
            ? `${inv.daysOverdue} day${inv.daysOverdue === 1 ? "" : "s"} overdue`
            : inv.daysOverdue === 0
              ? "due today"
              : `due in ${-inv.daysOverdue} day${inv.daysOverdue === -1 ? "" : "s"}`}
        </div>
        <div className="text-[11px] text-dim">
          due {formatDate(inv.due_on, locale)}
          {nudged && (
            <>
              {" · "}
              <span className={nudges.recent ? "text-status-due" : ""}>{nudged}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 ml-auto">
        <StatusPill status={inv.status} />
        <button className="btn-ghost px-2 py-1" onClick={onEdit}>Edit</button>
        <button className="btn-ghost px-2 py-1 hover:text-status-critical" onClick={onDelete}>Delete</button>
        <button className="btn-secondary px-3 py-1" onClick={onNudge}>Nudge</button>
      </div>
    </div>
  );
}
