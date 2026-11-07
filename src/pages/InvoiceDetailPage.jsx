import { useMemo, useState } from "react";
import Icon from "../components/ui/Icon.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import { money, date, plural, StatusPill, PromisePill } from "../components/InvoiceBits.jsx";
import ComposerSheet from "../components/ComposerSheet.jsx";
import PaymentSheet from "../components/PaymentSheet.jsx";
import PromiseSheet from "../components/PromiseSheet.jsx";
import InvoiceFormSheet from "../components/InvoiceFormSheet.jsx";
import ConfirmSheet from "../components/ConfirmSheet.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { linkProps, navigate } from "../hooks/useRoute.js";
import { useData } from "../state/DataStore.jsx";
import { annotate } from "../lib/queue.js";
import { normaliseLadder } from "../lib/ladder.js";
import { promiseHistory, promiseLabel } from "../lib/promises.js";
import { todayISO, isoFromTimestamp } from "../lib/dates.js";
import { normalisePhone } from "../lib/phone.js";
import { companyConfig } from "../../companyConfig.js";

const OUTCOME = { pending: "Waiting", "due-today": "Due today", broken: "Broken", kept: "Kept", "kept-late": "Paid late", rescheduled: "Moved", closed: "Closed" };
const OUTCOME_PILL = { broken: "pill-bad", kept: "pill-good", "kept-late": "pill-warn", pending: "pill-info", "due-today": "pill-warn", rescheduled: "pill-neutral", closed: "pill-neutral" };

/** One invoice: summary first, then the one action that matters, then history. */
export default function InvoiceDetailPage({ id, schema }) {
  const { invoices, deleteInvoice } = useData();
  const toast = useToast();
  const today = todayISO();
  const ladder = useMemo(() => normaliseLadder(companyConfig.ladder), []);
  const raw = invoices?.find((i) => i.id === id);
  const inv = useMemo(() => (raw ? annotate([raw], { ladder, today })[0] : null), [raw, ladder, today]);
  const [sheet, setSheet] = useState(null);

  if (!invoices) return <div className="card p-6 space-y-3"><Skeleton className="h-5 w-40" /><Skeleton className="h-10 w-56" /><Skeleton className="h-4 w-full" /></div>;
  if (!inv) return <EmptyState icon="search" title="This invoice isn't here" action={<a className="btn-primary w-full sm:w-auto" {...linkProps("/invoices")}>See all invoices</a>}>It may have been deleted, or the link is from another business.</EmptyState>;

  const open = inv.status === "unpaid" || inv.status === "partial";
  const L = inv.ladder;
  const phone = inv.customer?.phone ? normalisePhone(inv.customer.phone) : null;
  const history = buildHistory(inv, today);
  const promises = promiseHistory(inv, inv.promises, today);

  let primary = null;
  if (open && !L.complete) {
    primary = <button className="btn-primary w-full text-[17px]" onClick={() => setSheet("nudge")} data-testid="detail-nudge"><Icon name="chat" />Send {L.nextStage.label.toLowerCase()} nudge{L.dueNow ? "" : ` (due ${date(L.nextDueOn)})`}</button>;
  } else if (open && L.complete) {
    primary = phone
      ? <a className="btn-primary w-full text-[17px]" href={`tel:+${phone}`}><Icon name="phone" />Call {inv.customer.name}</a>
      : <button className="btn-primary w-full text-[17px]" onClick={() => setSheet("nudge")}><Icon name="chat" />Send another final reminder</button>;
  }

  return (
    <div className="space-y-5">
      <section className="card p-5" data-testid="detail-summary">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] text-ink-3">{open ? "Outstanding" : inv.status === "paid" ? "Paid in full" : "Written off"}</div>
            <div className="stat-figure mt-1">{money(open ? inv.owedCents : inv.amount_cents, inv.currency)}</div>
            {inv.status === "partial" && <div className="text-[13px] text-ink-3 mt-1 tabular">{money(inv.amount_paid_cents)} of {money(inv.amount_cents)} paid</div>}
          </div>
          <div className="flex flex-col items-end gap-1.5"><StatusPill inv={inv} /><PromisePill ps={inv.promise} />{inv.is_demo && <span className="pill-neutral">Demo</span>}</div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-y-3 gap-x-4 text-[15px]">
          <Item label="Customer" value={inv.customer?.name} />
          <Item label="Invoice" value={inv.reference || "No number"} />
          <Item label="Issued" value={date(inv.issued_on)} />
          <Item label="Due" value={date(inv.due_on)} />
          {inv.description && <Item label="For" value={inv.description} wide />}
          <Item label="Contact" value={[inv.customer?.phone, inv.customer?.email].filter(Boolean).join(" · ") || "No contact details"} wide />
          {inv.source_quote_id && <Item label="From" value="Quote & Invoice" />}
        </dl>
      </section>

      {(primary || open) && (
        <section className="space-y-2">
          {primary}
          {open && (
            <div className="grid grid-cols-3 gap-2">
              <button className="btn-secondary" onClick={() => setSheet("pay")} data-testid="detail-pay"><Icon name="cash" size={18} />Payment</button>
              <button className="btn-secondary" onClick={() => setSheet("promise")} disabled={schema !== "v2"} title={schema !== "v2" ? "Needs the November database update" : undefined} data-testid="detail-promise"><Icon name="calendar" size={18} />Promise</button>
              <button className="btn-secondary" onClick={() => setSheet("edit")}><Icon name="edit" size={18} />Edit</button>
            </div>
          )}
          {open && schema !== "v2" && <p className="text-[13px] text-ink-3 text-center">Promise-to-pay needs the November database update.</p>}
        </section>
      )}

      <section aria-labelledby="ladder-h">
        <h2 id="ladder-h" className="section-label">Nudge ladder</h2>
        <div className="card p-4" data-testid="detail-ladder">
          <ol className="space-y-0">
            {L.stages.map((s, i) => (
              <li key={s.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`h-7 w-7 rounded-full inline-flex items-center justify-center text-[12px] font-semibold ${s.state === "sent" ? "bg-good-soft text-good" : s.state === "next" ? (L.dueNow ? "bg-bad-soft text-bad" : "bg-info-soft text-info") : "bg-fill text-ink-3"}`}>
                    {s.state === "sent" ? <Icon name="check" size={15} /> : i + 1}
                  </span>
                  {i < L.stages.length - 1 && <span className="w-px flex-1 bg-hairline min-h-[18px]" />}
                </div>
                <div className="pb-4 min-w-0">
                  <div className="text-[15px] font-medium">{s.label} <span className="text-ink-3 font-normal">· day {s.day}</span></div>
                  <div className="text-[13px] text-ink-3">
                    {s.state === "sent" && `Sent ${date(s.sentOn)}`}
                    {s.state === "next" && (L.dueNow ? `Due now${L.nextDueOn < today ? ` (since ${date(L.nextDueOn)})` : ""}` : `Next nudge ${date(L.nextDueOn)}${L.pausedUntil ? " · paused for a promise" : ""}`)}
                    {s.state === "skipped" && "Skipped (the invoice was already past this stage)"}
                    {s.state === "upcoming" && `From ${date(s.dueOn)}`}
                    {s.state === "stopped" && "Stopped: invoice closed"}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <p className="text-[13px] text-ink-3 border-t border-hairline pt-3">
            {!open ? `Off the ladder: ${inv.status === "paid" ? "paid" : "written off"}. No more nudges.` : L.complete ? "Final notice sent. A phone call usually works better than another message now." : "You send every nudge yourself, with one tap. Nothing goes out automatically."}
          </p>
        </div>
      </section>

      {promises.length > 0 && (
        <section aria-labelledby="promise-h">
          <h2 id="promise-h" className="section-label">Promises to pay</h2>
          <div className="group-list" data-testid="detail-promises">
            {promises.map((p) => (
              <div key={p.id ?? p.created_at} className="group-row">
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium">Pay by {date(p.promised_on)}</div>
                  <div className="text-[13px] text-ink-3 truncate">Logged {date(isoFromTimestamp(p.created_at))}{p.note ? ` · “${p.note}”` : ""}</div>
                </div>
                <span className={OUTCOME_PILL[p.outcome] ?? "pill-neutral"}>{OUTCOME[p.outcome] ?? p.outcome}</span>
              </div>
            ))}
          </div>
          {inv.promise.state === "broken" && <p className="text-[13px] text-bad mt-2 px-1">{promiseLabel(inv.promise, companyConfig.locale)}. It's at the top of Today.</p>}
        </section>
      )}

      <section aria-labelledby="history-h">
        <h2 id="history-h" className="section-label">History</h2>
        <div className="group-list" data-testid="detail-history">
          {history.map((h, i) => (
            <div key={i} className="group-row !min-h-[52px]">
              <Icon name={h.icon} size={18} className="text-ink-3 flex-shrink-0" />
              <div className="flex-1 min-w-0 text-[15px]">{h.text}</div>
              <span className="text-[13px] text-ink-3 flex-shrink-0">{h.when}</span>
            </div>
          ))}
        </div>
      </section>

      <button className="btn-plain text-bad w-full" onClick={() => setSheet("delete")}><Icon name="trash" size={18} />Delete invoice</button>

      {sheet === "nudge" && <ComposerSheet invoice={inv} initialStage={L.nextStage?.key} onClose={() => setSheet(null)} />}
      {sheet === "pay" && <PaymentSheet invoice={inv} onClose={() => setSheet(null)} />}
      {sheet === "promise" && <PromiseSheet invoice={inv} onClose={() => setSheet(null)} />}
      {sheet === "edit" && <InvoiceFormSheet initial={inv} onClose={() => setSheet(null)} />}
      {sheet === "delete" && (
        <ConfirmSheet title="Delete this invoice?" confirmLabel="Delete" danger onClose={() => setSheet(null)}
          onConfirm={async () => { await deleteInvoice(inv.id); toast("Invoice deleted."); navigate("/invoices", { replace: true }); }}>
          <p>{inv.reference || "This invoice"} for {inv.customer?.name} ({money(inv.owedCents)} outstanding) and its nudge history will be removed. This can't be undone.</p>
          <p className="text-[14px] text-ink-3">If they paid, record a payment instead so your totals stay right.</p>
        </ConfirmSheet>
      )}
    </div>
  );
}

function Item({ label, value, wide }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <dt className="text-[13px] text-ink-3">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}

function buildHistory(inv, today) {
  const out = [];
  const day = (ts) => isoFromTimestamp(ts);
  const stages = normaliseLadder(companyConfig.ladder).stages;
  for (const n of inv.nudges ?? []) {
    const label = stages.find((s) => s.key === n.stage)?.label ?? stages.filter((s) => s.tone === n.tone).at(-1)?.label ?? n.tone;
    out.push({ at: n.sent_at, icon: n.channel === "email" ? "mail" : "chat", text: `${label} nudge sent by ${n.channel === "email" ? "email" : "WhatsApp"}`, when: date(day(n.sent_at)) });
  }
  for (const p of inv.promises ?? []) out.push({ at: p.created_at, icon: "calendar", text: `Promised to pay by ${date(p.promised_on)}`, when: date(day(p.created_at)) });
  if (inv.status === "paid") {
    out.push({ at: inv.paid_at ?? inv.updated_at, icon: "check", text: `Marked paid${inv.paid_by ? ` by ${inv.paid_by}` : ""}`, when: inv.paid_at ? date(day(inv.paid_at)) : "Date not recorded" });
  } else if (Number(inv.amount_paid_cents) > 0) {
    out.push({ at: inv.updated_at, icon: "cash", text: `${money(inv.amount_paid_cents)} paid so far`, when: "" });
  }
  out.push({ at: inv.created_at, icon: "invoice", text: inv.source_quote_id ? "Pulled from Quote & Invoice" : "Added to Invoice Chaser", when: date(day(inv.created_at)) });
  return out.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
}
