import { useMemo, useState } from "react";
import Icon from "../components/ui/Icon.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import { InvoiceRow, money, plural, PromisePill } from "../components/InvoiceBits.jsx";
import ComposerSheet from "../components/ComposerSheet.jsx";
import DemoSheet from "../components/DemoSheet.jsx";
import InvoiceFormSheet from "../components/InvoiceFormSheet.jsx";
import Checklist from "../components/Checklist.jsx";
import useCountUp from "../hooks/useCountUp.js";
import { navigate, linkProps } from "../hooks/useRoute.js";
import { useData } from "../state/DataStore.jsx";
import { annotate, buildTodayQueue, brokenPromises, ladderFinished, sentToday, queueReason } from "../lib/queue.js";
import { agedSummary, AGED_BUCKETS, bucketShares } from "../lib/aged.js";
import { normaliseLadder } from "../lib/ladder.js";
import { todayISO } from "../lib/dates.js";
import { normalisePhone } from "../lib/phone.js";
import { companyConfig } from "../../companyConfig.js";

const BAR = { current: "bg-[#64d2ff]", d1_30: "bg-[#ffcc00]", d31_60: "bg-[#ff9f0a]", d61_90: "bg-[#ff6b3d]", d90p: "bg-[#ff3b30]" };

/**
 * Today: the 3-second rule applied to debt. How much am I owed, what's
 * overdue, who do I chase right now. The queue is the primary list: broken
 * promises first, then the biggest balance. One tap opens the nudge, written.
 */
export default function TodayPage({ schema }) {
  const { invoices, status } = useData();
  const today = todayISO();
  const ladder = useMemo(() => normaliseLadder(companyConfig.ladder), []);
  const annotated = useMemo(() => annotate(invoices ?? [], { ladder, today }), [invoices, ladder, today]);
  const queue = useMemo(() => buildTodayQueue(annotated), [annotated]);
  const broken = useMemo(() => brokenPromises(annotated), [annotated]);
  const finished = useMemo(() => ladderFinished(annotated), [annotated]);
  const aged = useMemo(() => agedSummary(invoices ?? [], today), [invoices, today]);
  const done = sentToday(invoices ?? [], today);
  const [composing, setComposing] = useState(null);
  const [sheet, setSheet] = useState(null);

  if (!invoices && status !== "error") return <TodaySkeleton />;
  if (!invoices) {
    return <EmptyState icon="wifiOff" title="Can't reach your books right now" action={<button className="btn-primary w-full sm:w-auto" onClick={() => window.location.reload()}>Try again</button>}>Check your connection. Nothing is lost: anything you sent will sync when you're back.</EmptyState>;
  }

  const empty = invoices.length === 0;
  const canDemo = companyConfig.demo?.allowed !== false;
  return (
    <div className="space-y-6">
      <Checklist onLoadDemo={() => setSheet("demo")} onAddInvoice={() => setSheet("invoice")} queueFirst={queue[0]} onNudgeFirst={() => setComposing(queue[0])} />

      {empty ? (
        <EmptyState icon="inbox" title="Nothing to chase yet"
          action={canDemo && schema === "v2"
            ? <button className="btn-primary w-full sm:w-auto" onClick={() => setSheet("demo")} data-testid="empty-load-demo">Load demo data</button>
            : <button className="btn-primary w-full sm:w-auto" onClick={() => setSheet("invoice")}>Add your first invoice</button>}
          secondary={<span className="text-[14px] text-ink-3">or <a className="text-action" {...linkProps("/import")}>import a spreadsheet</a>{canDemo && schema === "v2" && <> · <button className="text-action min-h-[44px]" onClick={() => setSheet("invoice")}>add one by hand</button></>}</span>}>
          See exactly who owes you and nudge them in one tap. Start with sample books, or add what you're owed.
        </EmptyState>
      ) : (
        <>
          <Hero aged={aged} queueCount={queue.length} done={done} />

          {broken.length > 0 && (
            <section className="rounded-card bg-bad-soft px-4 py-3.5 flex items-start gap-3 animate-rise" role="alert" data-testid="broken-alert">
              <Icon name="alert" className="text-bad mt-0.5 flex-shrink-0" />
              <div className="text-[15px] text-bad">
                <strong>{plural(broken.length, "broken promise")}.</strong>{" "}
                {broken.slice(0, 3).map((b) => b.customer?.name).join(", ")}{broken.length > 3 ? " and others" : ""} said they'd pay and haven't. They're at the top of your list.
              </div>
            </section>
          )}

          <section aria-labelledby="queue-h">
            <div className="flex items-baseline justify-between px-1 mb-2">
              <h2 id="queue-h" className="text-[20px] font-semibold">To chase today</h2>
              <span className="text-[13px] text-ink-3">{done > 0 ? `${done} sent today` : "Tap one to send"}</span>
            </div>
            {queue.length === 0 ? (
              <EmptyState icon="check" title="All caught up for today"
                action={<a className="btn-secondary w-full sm:w-auto" {...linkProps("/invoices")}>See all invoices</a>}>
                {aged.count > 0 ? `${plural(aged.count, "invoice")} still open, but none is due a nudge today. The ladder will bring them back when it's time.` : "Nobody owes you anything right now."}
              </EmptyState>
            ) : (
              <div className="group-list" data-testid="today-queue">
                {queue.map((item) => (
                  <InvoiceRow key={item.id} inv={item} testId="queue-row" onClick={() => setComposing(item)}
                    sub={queueReason(item, today)}
                    right={item.promise.state === "broken" ? <PromisePill ps={item.promise} /> : <span className={item.ladder.nextStage.tone === "final" ? "pill-bad" : item.ladder.nextStage.tone === "firm" ? "pill-warn" : "pill-info"}>{item.ladder.nextStage.label}</span>} />
                ))}
              </div>
            )}
          </section>

          {finished.length > 0 && (
            <section aria-labelledby="call-h">
              <h2 id="call-h" className="section-label">Ladder finished: time for a call</h2>
              <div className="group-list">
                {finished.map((i) => (
                  <div key={i.id} className="group-row">
                    <a className="flex-1 min-w-0" {...linkProps(`/invoices/${i.id}`)}>
                      <div className="text-[16px] font-semibold truncate">{i.customer?.name}</div>
                      <div className="text-[13px] text-ink-3 truncate">{money(i.owedCents)} · {plural(i.daysOverdue, "day")} overdue · final notice sent</div>
                    </a>
                    {i.customer?.phone && <a className="btn-secondary" href={`tel:+${normalisePhone(i.customer.phone)}`} aria-label={`Call ${i.customer.name}`}><Icon name="phone" size={18} />Call</a>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {composing && <ComposerSheet invoice={composing} initialStage={composing.ladder?.nextStage?.key} onClose={() => setComposing(null)} />}
      {sheet === "demo" && <DemoSheet onClose={() => setSheet(null)} />}
      {sheet === "invoice" && <InvoiceFormSheet onClose={() => setSheet(null)} onSaved={(row) => row?.id && navigate(`/invoices/${row.id}`)} />}
    </div>
  );
}

function Hero({ aged, queueCount, done }) {
  const total = useCountUp(aged.outstanding);
  const shares = bucketShares(aged.buckets);
  return (
    <section className="card aura-wash p-5 sm:p-6 animate-rise" aria-label="Summary" data-testid="hero">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-5 gap-x-4">
        <div className="col-span-2 sm:col-span-1">
          <div className="text-[13px] text-ink-3">You are owed</div>
          <div className="stat-figure mt-1.5" data-testid="hero-outstanding">{money(total)}</div>
          <div className="text-[13px] text-ink-3 mt-1">{plural(aged.count, "open invoice")}</div>
        </div>
        <div>
          <div className="text-[13px] text-ink-3">Overdue</div>
          <div className="stat-figure mt-1.5 text-bad" data-testid="hero-overdue">{aged.overdueCount}</div>
          <div className="text-[13px] text-ink-3 mt-1 tabular">{money(aged.overdueCents)}</div>
        </div>
        <div>
          <div className="text-[13px] text-ink-3">Chase today</div>
          <div className="stat-figure mt-1.5" data-testid="hero-today">{queueCount}</div>
          <div className="text-[13px] text-ink-3 mt-1">{done ? `${done} done` : aged.fallingDueToday ? `${aged.fallingDueToday} falling due today` : "nudges due"}</div>
        </div>
      </div>

      <div className="mt-6" data-testid="aged">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-[13px] font-medium text-ink-2">How long it's been owed</span>
          {aged.oldestDays > 0 && <span className="text-[12px] text-ink-3">oldest {plural(aged.oldestDays, "day")}</span>}
        </div>
        <div className="flex h-2.5 rounded-full overflow-hidden bg-fill-2" aria-hidden>
          {AGED_BUCKETS.map((b) => shares[b.key] > 0 && <span key={b.key} className={BAR[b.key]} style={{ width: `${shares[b.key]}%` }} />)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-5 sm:gap-1 mt-2 sm:mt-3">
          {AGED_BUCKETS.map((b) => (
            <a key={b.key} {...linkProps(`/invoices?bucket=${b.key}`)} data-testid={`bucket-${b.key}`}
              className="flex sm:block items-center justify-between gap-3 rounded-[10px] px-1.5 py-1.5 -mx-1.5 sm:mx-0 hover:bg-white/70 min-h-[44px]">
              <div className="flex items-center gap-1.5 text-[13px] sm:text-[12px] text-ink-2 sm:text-ink-3"><span className={`h-2 w-2 rounded-full ${BAR[b.key]}`} aria-hidden />{b.label}<span className="sm:hidden text-ink-3">· {aged.buckets[b.key].count}</span></div>
              <div className="text-[15px] font-semibold tabular sm:truncate">{money(aged.buckets[b.key].total)}</div>
              <div className="hidden sm:block text-[11px] text-ink-3">{plural(aged.buckets[b.key].count, "invoice")}</div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function TodaySkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="card p-6 space-y-4"><Skeleton className="h-4 w-24" /><Skeleton className="h-9 w-48" /><Skeleton className="h-2.5 w-full" /></div>
      <div className="group-list">{[0, 1, 2].map((i) => <div key={i} className="group-row"><div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div><Skeleton className="h-5 w-20" /></div>)}</div>
    </div>
  );
}
