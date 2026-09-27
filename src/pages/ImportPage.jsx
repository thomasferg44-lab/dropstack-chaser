import { useEffect, useMemo, useState } from "react";
import { listCustomers, listInvoices, importInvoices } from "../lib/db.js";
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
 * CSV import. Flow: pick file → check column mapping → fix rows in the
 * preview → import. Every row from the file is visible here; nothing is
 * dropped without being counted and shown.
 */
export default function ImportPage({ onNavigate }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [existing, setExisting] = useState({ customers: [], invoices: [] });
  const [mapping, setMapping] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const today = todayISO();
  const { currency, locale } = companyConfig;

  useEffect(() => {
    Promise.all([listCustomers(), listInvoices()])
      .then(([customers, invoices]) => setExisting({ customers, invoices }))
      .catch((e) => setError(e.message));
  }, []);

  const custIdx = useMemo(() => indexCustomers(existing.customers), [existing.customers]);
  const headers = useMemo(() => (text ? parseCsv(text).headers : []), [text]);

  function loadText(t, name) {
    setText(t);
    setFileName(name);
    setResult(null);
    const m = guessMapping(parseCsv(t).headers);
    setMapping(m);
    rebuild(t, m);
  }

  function rebuild(t, m) {
    const p = buildPreview(t, {
      mapping: m,
      existingCustomers: existing.customers,
      existingInvoices: existing.invoices,
      today,
      defaultCurrency: currency,
    });
    for (const r of p.rows) if (r.alreadyExists) r.include = false;
    setPreview(p);
  }

  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((t) => loadText(t, f.name));
  }

  function changeMapping(idx, field) {
    const m = { ...mapping };
    // A field can only come from one column.
    for (const k of Object.keys(m)) if (m[k] === field && field !== null) m[k] = null;
    m[idx] = field;
    setMapping(m);
    rebuild(text, m);
  }

  function editCell(rowId, field, value) {
    const rows = preview.rows.map((r) => {
      if (r.id !== rowId) return r;
      const v = validateValues({ ...r.values, [field]: value }, { today });
      return { ...r, ...v };
    });
    annotateRows(rows, { custIdx, existingInvoices: existing.invoices });
    setPreview({ ...preview, rows });
  }

  function toggle(rowId, include) {
    setPreview({ ...preview, rows: preview.rows.map((r) => (r.id === rowId ? { ...r, include } : r)) });
  }

  const stats = useMemo(() => {
    if (!preview) return null;
    const rows = preview.rows;
    const errored = rows.filter((r) => Object.keys(r.errors).length > 0);
    const ready = rows.filter((r) => r.include && Object.keys(r.errors).length === 0);
    const payload = buildImportPayload(rows);
    return {
      total: rows.length,
      errored: errored.length,
      includedWithErrors: errored.filter((r) => r.include).length,
      ready: ready.length,
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
    setBusy(true);
    setError(null);
    try {
      const res = await importInvoices(stats.payload);
      setResult(res);
      setText("");
      setPreview(null);
      setMapping(null);
      const [customers, invoices] = await Promise.all([listCustomers(), listInvoices()]);
      setExisting({ customers, invoices });
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  const mappedFields = new Set(Object.values(mapping || {}).filter(Boolean));
  const missingRequired = FIELDS.filter((f) => f.required && !mappedFields.has(f.key));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Import CSV</h1>
        <p className="text-sm text-mute">
          Export what you're owed from wherever you keep it. Column names, date formats (including DD/MM/YYYY),
          currency symbols and thousands separators are all handled. You'll see a preview before anything is saved.
        </p>
      </div>

      {result && (
        <div className="card border-status-paid/40">
          <div className="font-semibold text-status-paid">Import complete</div>
          <div className="text-sm text-mute">
            {result.invoices_created} invoice{result.invoices_created === 1 ? "" : "s"} added,{" "}
            {result.customers_created} new customer{result.customers_created === 1 ? "" : "s"} created.
          </div>
          <button className="btn-secondary mt-3" onClick={() => onNavigate("dashboard")}>View invoices</button>
        </div>
      )}

      {!preview && (
        <div className="card flex flex-col gap-3">
          <label className="btn-primary cursor-pointer self-start">
            Choose CSV file
            <input type="file" accept=".csv,text/csv,.txt,.tsv" className="hidden" onChange={onFile} />
          </label>
          <p className="text-xs text-dim">
            Or paste CSV text below. Columns can be in any order. Need an example?{" "}
            <button className="underline" onClick={() => loadText(SAMPLE, "sample.csv")}>Load a sample</button>.
          </p>
          <textarea
            rows={5}
            placeholder={"Customer,Amount,Due Date\nDemo Landscaping,R1 500,30/09/2026"}
            className="font-mono text-xs"
            onBlur={(e) => e.target.value.trim() && loadText(e.target.value, "pasted")}
          />
        </div>
      )}

      {error && <p className="text-status-critical text-sm">{error}</p>}

      {preview && (
        <>
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm">
                <span className="font-medium">{fileName}</span>{" "}
                <span className="text-dim">· {preview.rows.length} rows{preview.blankRows > 0 && `, ${preview.blankRows} blank row${preview.blankRows === 1 ? "" : "s"} skipped`}</span>
              </div>
              <button className="btn-ghost text-xs" onClick={() => { setPreview(null); setText(""); setMapping(null); }}>Start over</button>
            </div>
            <div className="text-xs text-dim uppercase tracking-wider mb-2">Columns</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {headers.map((h, i) => (
                <div key={i} className="field">
                  <label className="truncate" title={h}>{h || `(column ${i + 1})`}</label>
                  <select value={mapping[i] || ""} onChange={(e) => changeMapping(i, e.target.value || null)}>
                    <option value="">ignore</option>
                    {FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {missingRequired.length > 0 && (
              <p className="text-status-critical text-sm mt-3">
                Missing required column{missingRequired.length > 1 ? "s" : ""}: {missingRequired.map((f) => f.label).join(", ")}. Pick which column holds it above.
              </p>
            )}
          </div>

          <div className="card p-0 overflow-x-auto">
            <table className="text-xs w-full min-w-[900px]">
              <thead className="text-dim uppercase">
                <tr className="border-b border-border">
                  <th className="p-2 text-left">Line</th>
                  <th className="p-2">Import</th>
                  {EDITABLE.map((f) => (
                    <th key={f} className="p-2 text-left whitespace-nowrap">{FIELDS.find((x) => x.key === f).label}</th>
                  ))}
                  <th className="p-2 text-left">Customer match</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => {
                  const hasErr = Object.keys(r.errors).length > 0;
                  return (
                    <RowEditor key={r.id} row={r} hasErr={hasErr} onEdit={editCell} onToggle={toggle} />
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <Stat label="Ready" value={stats.ready} tone={stats.ready > 0 ? "text-status-paid" : "text-mute"} />
            <Stat label="With errors" value={stats.errored} tone={stats.errored > 0 ? "text-status-critical" : "text-mute"} />
            <Stat label="Unticked" value={stats.excluded} />
            <Stat label="New customers" value={stats.newCustomers} />
            <Stat label="Matched customers" value={stats.matchedCustomers} />
            <Stat label="Total to import" value={formatCents(stats.amount, currency, locale)} />
            <Stat label="Outstanding" value={formatCents(stats.outstanding, currency, locale)} tone="text-accent-1" />
            <div className="ml-auto flex flex-col items-end gap-1">
              {stats.includedWithErrors > 0 && (
                <span className="text-xs text-status-critical">
                  {stats.includedWithErrors} ticked row{stats.includedWithErrors === 1 ? "" : "s"} still ha{stats.includedWithErrors === 1 ? "s" : "ve"} errors — fix or untick them
                </span>
              )}
              <button className="btn-primary" disabled={busy || stats.ready === 0 || stats.includedWithErrors > 0} onClick={commit}>
                {busy ? "Importing…" : `Import ${stats.ready} invoice${stats.ready === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-dim">{label}</div>
      <div className={`font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function RowEditor({ row, hasErr, onEdit, onToggle }) {
  const border = hasErr ? "border-l-2 border-l-status-critical" : row.warnings.length ? "border-l-2 border-l-status-due" : "";
  return (
    <>
      <tr className={`border-b border-border/40 ${border} ${!row.include ? "opacity-50" : ""}`}>
        <td className="p-2 text-dim">{row.line}</td>
        <td className="p-2 text-center">
          <input type="checkbox" checked={row.include} onChange={(e) => onToggle(row.id, e.target.checked)} />
        </td>
        {EDITABLE.map((f) => (
          <td key={f} className="p-1 align-top">
            <input
              value={row.values[f] ?? ""}
              onChange={(e) => onEdit(row.id, f, e.target.value)}
              title={row.errors[f] || ""}
              className={`px-2 py-1 min-w-[6rem] ${row.errors[f] ? "border-status-critical" : ""}`}
            />
            {row.errors[f] && <div className="text-status-critical mt-0.5 px-1">{row.errors[f]}</div>}
          </td>
        ))}
        <td className="p-2 whitespace-nowrap">
          {row.customer.existing ? (
            <span className={row.customer.matchedBy === "name" ? "text-status-due" : "text-status-paid"}>
              {row.customer.existing.name}
              <span className="text-dim"> · by {row.customer.matchedBy}</span>
            </span>
          ) : (
            <span className="text-mute">new</span>
          )}
        </td>
      </tr>
      {row.warnings.length > 0 && (
        <tr className={`border-b border-border/40 ${border} ${!row.include ? "opacity-50" : ""}`}>
          <td />
          <td />
          <td colSpan={EDITABLE.length + 1} className="px-2 pb-2 text-status-due">
            {row.warnings.join(" · ")}
          </td>
        </tr>
      )}
    </>
  );
}
