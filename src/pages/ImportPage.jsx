import { useMemo, useState } from "react";
import Icon from "../components/ui/Icon.jsx";
import PullSheet from "../components/PullSheet.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { linkProps } from "../hooks/useRoute.js";
import { useData } from "../state/DataStore.jsx";
import {
  FIELDS, parseCsv, guessMapping, buildPreview, validateValues, annotateRows, indexCustomers, buildImportPayload,
} from "../lib/csv.js";
import { formatCents, sumCents } from "../lib/money.js";
import { todayISO } from "../lib/dates.js";
import { companyConfig } from "../../companyConfig.js";

// Invented sample data. Emails use the permanently reserved example.com and
// phone numbers use an all-zero body, so nothing here can reach a real person.
const SAMPLE = `Customer,Phone,Email,Invoice No,Description,Amount,Paid,Invoice Date,Due Date
Sample Plumbing Co,082 000 0000,billing@example.com,INV-001,Geyser,"R1,500.00",,01/08/2026,31/08/2026
Demo Landscaping,,hello@example.com,INV-002,Garden,"1 200",200,15 Aug 2026,14/09/2026`;

const EDITABLE = ["customer_name", "phone", "email", "reference", "description", "amount", "amount_paid", "issued_on", "due_on", "currency", "notes"];

/**
 * Bring the books in: pull straight from Quote & Invoice, or import a
 * spreadsheet. CSV flow unchanged from v1: pick file → check the column
 * mapping → fix flagged rows inline → one atomic import. Every row from the
 * file is visible; nothing is dropped without being counted and shown.
 */
export default function ImportPage({ schema }) {
  const { customers, invoices, importInvoices } = useData();
  const toast = useToast();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [pulling, setPulling] = useState(false);
  const today = todayISO();
  const { currency, locale } = companyConfig;
  const existing = useMemo(() => ({ customers: customers ?? [], invoices: invoices ?? [] }), [customers, invoices]);
  const custIdx = useMemo(() => indexCustomers(existing.customers), [existing.customers]);
  const headers = useMemo(() => (text ? parseCsv(text).headers : []), [text]);

  function loadText(t, name) {
    setText(t); setFileName(name); setResult(null);
    const m = guessMapping(parseCsv(t).headers);
    setMapping(m);
    rebuild(t, m);
  }
  function rebuild(t, m) {
    const p = buildPreview(t, { mapping: m, existingCustomers: existing.customers, existingInvoices: existing.invoices, today, defaultCurrency: currency });
    for (const r of p.rows) if (r.alreadyExists) r.include = false;
    setPreview(p);
  }
  function onFile(e) {
    const f = e.target.files?.[0];
    if (f) f.text().then((t) => loadText(t, f.name));
  }
  function changeMapping(idx, field) {
    const m = { ...mapping };
    for (const k of Object.keys(m)) if (m[k] === field && field !== null) m[k] = null;
    m[idx] = field;
    setMapping(m);
    rebuild(text, m);
  }
  function editCell(rowId, field, value) {
    const rows = preview.rows.map((r) => (r.id !== rowId ? r : { ...r, ...validateValues({ ...r.values, [field]: value }, { today }) }));
    annotateRows(rows, { custIdx, existingInvoices: existing.invoices });
    setPreview({ ...preview, rows });
  }
  const toggle = (rowId, include) => setPreview({ ...preview, rows: preview.rows.map((r) => (r.id === rowId ? { ...r, include } : r)) });

  const stats = useMemo(() => {
    if (!preview) return null;
    const rows = preview.rows;
    const errored = rows.filter((r) => Object.keys(r.errors).length > 0);
    const payload = buildImportPayload(rows);
    return {
      errored: errored.length,
      includedWithErrors: errored.filter((r) => r.include).length,
      ready: rows.filter((r) => r.include && Object.keys(r.errors).length === 0).length,
      excluded: rows.filter((r) => !r.include).length,
      newCustomers: payload.customers.filter((c) => c.id === null).length,
      matchedCustomers: payload.customers.filter((c) => c.id !== null).length,
      amount: sumCents(payload.invoices.map((i) => i.amount_cents)),
      outstanding: sumCents(payload.invoices.map((i) => i.amount_cents - i.amount_paid_cents).map((n) => (n > 0 ? n : 0))),
      payload,
    };
  }, [preview]);

  async function commit() {
    if (!stats || stats.ready === 0) return;
    setBusy(true); setError(null);
    try {
      const res = await importInvoices(stats.payload);
      setResult(res);
      toast(`${res.invoices_created} invoice${res.invoices_created === 1 ? "" : "s"} imported.`);
      setText(""); setPreview(null); setMapping(null);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  const mappedFields = new Set(Object.values(mapping || {}).filter(Boolean));
  const missingRequired = FIELDS.filter((f) => f.required && !mappedFields.has(f.key));
  const money = (c) => formatCents(c, currency, locale);
  const pullOn = companyConfig.quotePull?.enabled !== false;

  return (
    <div className="space-y-5">
      {pullOn && !preview && (
        <section className="card p-5 flex items-start gap-4" data-testid="pull-card">
          <span className="h-11 w-11 rounded-[12px] bg-info-soft text-info inline-flex items-center justify-center flex-shrink-0"><Icon name="layers" /></span>
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <h2 className="text-[17px] font-semibold">Pull from Quote &amp; Invoice</h2>
              <p className="text-[15px] text-ink-3">Accepted quotes that haven't been paid and are past due come straight in. No re-typing, and pulling twice never doubles anything.</p>
            </div>
            <button className="btn-primary w-full sm:w-auto" onClick={() => setPulling(true)} disabled={schema !== "v2"} data-testid="pull-open">Check for unpaid quotes</button>
            {schema !== "v2" && <p className="text-[13px] text-ink-3">Needs the November database update.</p>}
          </div>
        </section>
      )}

      {result && (
        <section className="card p-5 flex items-start gap-3" role="status">
          <span className="h-10 w-10 rounded-full bg-good-soft text-good inline-flex items-center justify-center flex-shrink-0"><Icon name="check" /></span>
          <div className="flex-1">
            <h2 className="text-[17px] font-semibold">Import complete</h2>
            <p className="text-[15px] text-ink-3">{result.invoices_created} invoice{result.invoices_created === 1 ? "" : "s"} added, {result.customers_created} new customer{result.customers_created === 1 ? "" : "s"}.</p>
            <a className="btn-secondary mt-3" {...linkProps("/")}>See who to chase today</a>
          </div>
        </section>
      )}

      {!preview && (
        <section className="card p-5 space-y-4">
          <div>
            <h2 className="text-[17px] font-semibold">Import a spreadsheet</h2>
            <p className="text-[15px] text-ink-3">Export what you're owed from wherever you keep it. Any column order; DD/MM/YYYY dates, R symbols and spaces in amounts are all fine. You'll check every row before anything is saved.</p>
          </div>
          <label className="btn-primary w-full sm:w-auto cursor-pointer">
            <Icon name="upload" size={18} />Choose CSV file
            <input type="file" accept=".csv,text/csv,.txt,.tsv" className="sr-only" onChange={onFile} />
          </label>
          <div>
            <label htmlFor="csv-paste" className="field-label">Or paste the rows</label>
            <textarea id="csv-paste" rows={4} className="input font-mono text-[14px]" placeholder={"Customer,Amount,Due Date\nDemo Landscaping,R1 500,30/09/2026"}
              onBlur={(e) => e.target.value.trim() && loadText(e.target.value, "pasted")} />
            <p className="field-help">Need an example? <button className="text-action min-h-[44px]" onClick={() => loadText(SAMPLE, "sample.csv")}>Load a sample</button></p>
          </div>
        </section>
      )}

      {error && <p className="field-error" role="alert"><Icon name="alert" size={15} />{error}</p>}

      {preview && (
        <>
          <section className="card p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[15px] min-w-0"><span className="font-semibold">{fileName}</span> <span className="text-ink-3">· {preview.rows.length} rows{preview.blankRows > 0 && `, ${preview.blankRows} blank row${preview.blankRows === 1 ? "" : "s"} skipped`}</span></div>
              <button className="btn-plain" onClick={() => { setPreview(null); setText(""); setMapping(null); }}>Start over</button>
            </div>
            <div className="field-label !mb-0">Which column is which</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {headers.map((h, i) => (
                <div key={i}>
                  <label htmlFor={`map-${i}`} className="block text-[13px] text-ink-3 truncate mb-1" title={h}>{h || `(column ${i + 1})`}</label>
                  <select id={`map-${i}`} className="input !min-h-[44px] !py-2 !text-[15px]" value={mapping[i] || ""} onChange={(e) => changeMapping(i, e.target.value || null)}>
                    <option value="">Ignore</option>
                    {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {missingRequired.length > 0 && (
              <p className="field-error"><Icon name="alert" size={15} />Missing required column{missingRequired.length > 1 ? "s" : ""}: {missingRequired.map((f) => f.label).join(", ")}. Pick which column holds it above.</p>
            )}
          </section>

          <section className="card p-0 overflow-x-auto">
            <table className="text-[13px] w-full min-w-[980px]">
              <thead className="text-ink-3">
                <tr className="border-b border-hairline">
                  <th className="p-2 text-left font-medium">Line</th>
                  <th className="p-2 font-medium">Import</th>
                  {EDITABLE.map((f) => <th key={f} className="p-2 text-left whitespace-nowrap font-medium">{FIELDS.find((x) => x.key === f).label}</th>)}
                  <th className="p-2 text-left font-medium">Customer match</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => <RowEditor key={r.id} row={r} hasErr={Object.keys(r.errors).length > 0} onEdit={editCell} onToggle={toggle} />)}
              </tbody>
            </table>
          </section>

          <section className="card p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[15px]">
              <Stat label="Ready" value={stats.ready} tone={stats.ready ? "text-good" : ""} />
              <Stat label="With errors" value={stats.errored} tone={stats.errored ? "text-bad" : ""} />
              <Stat label="Unticked" value={stats.excluded} />
              <Stat label="New customers" value={stats.newCustomers} />
              <Stat label="Matched customers" value={stats.matchedCustomers} />
              <Stat label="Total to import" value={money(stats.amount)} />
              <Stat label="Outstanding" value={money(stats.outstanding)} />
            </div>
            {stats.includedWithErrors > 0 && (
              <p className="field-error"><Icon name="alert" size={15} />{stats.includedWithErrors} ticked row{stats.includedWithErrors === 1 ? " still has" : "s still have"} errors. Fix or untick {stats.includedWithErrors === 1 ? "it" : "them"}.</p>
            )}
            <button className="btn-primary w-full sm:w-auto" disabled={busy || stats.ready === 0 || stats.includedWithErrors > 0} onClick={commit}>
              {busy ? "Importing…" : `Import ${stats.ready} invoice${stats.ready === 1 ? "" : "s"}`}
            </button>
          </section>
        </>
      )}
      {pulling && <PullSheet onClose={() => setPulling(false)} />}
    </div>
  );
}

function Stat({ label, value, tone = "" }) {
  return (
    <div>
      <div className="text-[13px] text-ink-3">{label}</div>
      <div className={`font-semibold tabular ${tone}`}>{value}</div>
    </div>
  );
}

function RowEditor({ row, hasErr, onEdit, onToggle }) {
  const border = hasErr ? "border-l-[3px] border-l-bad" : row.warnings.length ? "border-l-[3px] border-l-[#ff9f0a]" : "";
  return (
    <>
      <tr className={`border-b border-hairline ${border} ${!row.include ? "opacity-50" : ""}`}>
        <td className="p-2 text-ink-3">{row.line}</td>
        <td className="p-2 text-center"><input type="checkbox" className="h-5 w-5 accent-[#0071e3]" aria-label={`Import line ${row.line}`} checked={row.include} onChange={(e) => onToggle(row.id, e.target.checked)} /></td>
        {EDITABLE.map((f) => (
          <td key={f} className="p-1 align-top">
            <input value={row.values[f] ?? ""} onChange={(e) => onEdit(row.id, f, e.target.value)} aria-label={`${f} line ${row.line}`} aria-invalid={row.errors[f] ? "true" : undefined}
              className={`w-full min-w-[6.5rem] rounded-[8px] border px-2 py-1.5 text-[14px] ${row.errors[f] ? "border-error" : "border-field"}`} />
            {row.errors[f] && <div className="text-error mt-0.5 px-1">{row.errors[f]}</div>}
          </td>
        ))}
        <td className="p-2 whitespace-nowrap">
          {row.customer.existing
            ? <span className={row.customer.matchedBy === "name" ? "text-warn" : "text-good"}>{row.customer.existing.name}<span className="text-ink-3"> · by {row.customer.matchedBy}</span></span>
            : <span className="text-ink-3">new</span>}
        </td>
      </tr>
      {row.warnings.length > 0 && (
        <tr className={`border-b border-hairline ${border} ${!row.include ? "opacity-50" : ""}`}>
          <td /><td />
          <td colSpan={EDITABLE.length + 1} className="px-2 pb-2 text-warn">{row.warnings.join(" · ")}</td>
        </tr>
      )}
    </>
  );
}
