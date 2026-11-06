import { useEffect, useMemo, useState } from "react";
import Sheet from "./ui/Sheet.jsx";
import Icon from "./ui/Icon.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import { useToast } from "./ui/Toast.jsx";
import { money, date, plural } from "./InvoiceBits.jsx";
import { listOutstandingQuotes } from "../lib/db.js";
import { QUOTE_SELECT, OUTSTANDING_STATUSES, pullCandidates, buildPullPayload, matchCustomer } from "../lib/quotePull.js";
import { todayISO } from "../lib/dates.js";
import { navigate } from "../hooks/useRoute.js";
import { useData } from "../state/DataStore.jsx";
import { companyConfig } from "../../companyConfig.js";

/** Accepted, unpaid, past-due quotes → one tap → chaser invoices on the ladder. */
export default function PullSheet({ onClose }) {
  const { invoices, customers, importFromQuotes } = useData();
  const toast = useToast();
  const today = todayISO();
  const termsDays = companyConfig.quotePull?.paymentTermsDays ?? 7;
  const [quotes, setQuotes] = useState(undefined); // undefined loading, null no table
  const [error, setError] = useState(null);
  const [includeNotDue, setIncludeNotDue] = useState(false);
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listOutstandingQuotes(QUOTE_SELECT, OUTSTANDING_STATUSES).then(setQuotes).catch((e) => { setError(e.message); setQuotes([]); });
  }, []);

  const imported = useMemo(() => (invoices ?? []).map((i) => i.source_quote_id).filter(Boolean), [invoices]);
  const result = useMemo(() => (quotes ? pullCandidates(quotes, { importedQuoteIds: imported, termsDays, today, includeNotDue }) : null), [quotes, imported, termsDays, today, includeNotDue]);
  const selected = useMemo(() => (result ? result.offered.filter((c) => (picked ?? new Set(result.offered.map((x) => x.quoteId))).has(c.quoteId)) : []), [result, picked]);
  const toggle = (id) => {
    const s = new Set(picked ?? result.offered.map((x) => x.quoteId));
    s.has(id) ? s.delete(id) : s.add(id);
    setPicked(s);
  };

  async function go() {
    setBusy(true); setError(null);
    try {
      const r = await importFromQuotes(buildPullPayload(selected, customers, companyConfig.currency));
      toast(`${plural(r.invoices_created, "invoice")} pulled in${r.invoices_skipped ? `, ${r.invoices_skipped} already here` : ""}.`);
      onClose(true);
      navigate("/");
    } catch (e) { setError(e.message); setBusy(false); }
  }

  const footer = result && result.offered.length > 0 && (
    <button type="button" className="btn-primary w-full text-[17px]" disabled={busy || selected.length === 0} onClick={go} data-testid="pull-import">
      {busy ? "Pulling in…" : `Import ${plural(selected.length, "invoice")}`}
    </button>
  );

  return (
    <Sheet onClose={() => onClose(false)} title="Pull from Quote & Invoice" footer={footer} wide>
      <div className="space-y-4">
        {quotes === undefined && <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>}
        {quotes === null && <p className="text-[15px] text-ink-3">Quote &amp; Invoice isn't connected to this account's database, so there's nothing to pull. Use a spreadsheet import instead.</p>}
        {result && (
          <>
            <p className="text-[15px] text-ink-3">Accepted quotes not marked paid, due {termsDays} days after acceptance. Customers are matched to yours by mobile number, then email.</p>
            {result.offered.length === 0 ? (
              <div className="rounded-[14px] bg-fill px-4 py-5 text-center text-[15px]" data-testid="pull-empty">
                <Icon name="check" className="mx-auto text-good mb-1" />
                Nothing new to pull. {result.alreadyImported ? `${plural(result.alreadyImported, "quote")} already here.` : ""}
              </div>
            ) : (
              <ul className="group-list" data-testid="pull-list">
                {result.offered.map((c) => {
                  const on = selected.some((s) => s.quoteId === c.quoteId);
                  const match = matchCustomer(c.customer, customers);
                  return (
                    <li key={c.quoteId}>
                      <label className="group-row cursor-pointer">
                        <input type="checkbox" className="h-5 w-5 accent-[#0071e3] flex-shrink-0" checked={on} onChange={() => toggle(c.quoteId)} aria-label={`Import ${c.reference}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[16px] font-semibold truncate">{c.customer.name}</div>
                          <div className="text-[13px] text-ink-3 truncate">{c.reference} · {c.description}</div>
                          <div className="text-[12px] text-ink-3">{c.pastDue ? `${plural(c.daysOverdue, "day")} overdue` : `due ${date(c.due_on)}`} · {match ? `existing customer (by ${match.by})` : "new customer"}</div>
                        </div>
                        <div className="text-[16px] font-semibold tabular">{money(c.amount_cents)}</div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {result.notYetDue > 0 && (
              <label className="flex items-center justify-between gap-3 min-h-[44px] text-[15px]">
                <span>Also show {plural(result.notYetDue, "quote")} not due yet</span>
                <input type="checkbox" className="h-5 w-5 accent-[#0071e3]" checked={includeNotDue} onChange={(e) => { setIncludeNotDue(e.target.checked); setPicked(null); }} />
              </label>
            )}
            {result.skipped.length > 0 && <p className="text-[13px] text-warn">{plural(result.skipped.length, "accepted quote")} can't be pulled ({[...new Set(result.skipped.map((s) => s.reason.toLowerCase()))].join(", ")}). Fix {result.skipped.length === 1 ? "it" : "them"} in Quote &amp; Invoice.</p>}
            <p className="text-[13px] text-ink-3">Marking an invoice paid here doesn't update Quote &amp; Invoice yet.</p>
          </>
        )}
        {error && <p className="field-error" role="alert"><Icon name="alert" size={15} />{error}</p>}
      </div>
    </Sheet>
  );
}
