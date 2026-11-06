import Icon from "./ui/Icon.jsx";
import { formatCents } from "../lib/money.js";
import { formatDate } from "../lib/dates.js";
import { linkProps } from "../hooks/useRoute.js";
import { companyConfig } from "../../companyConfig.js";

export const money = (cents, currency = companyConfig.currency) => formatCents(cents, currency, companyConfig.locale);
export const date = (iso) => formatDate(iso, companyConfig.locale);
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Status as a soft pill, always with the word (never colour alone). */
export function StatusPill({ inv }) {
  if (inv.status === "paid") return <span className="pill-good">Paid</span>;
  if (inv.status === "written_off") return <span className="pill-neutral">Written off</span>;
  const d = inv.daysOverdue;
  if (d > 0) return <span className={d > 60 ? "pill-bad" : "pill-warn"}>{plural(d, "day")} overdue</span>;
  if (d === 0) return <span className="pill-warn">Due today</span>;
  return <span className="pill-info">Due in {plural(-d, "day")}</span>;
}

export function PromisePill({ ps }) {
  if (ps.state === "broken") return <span className="pill-bad">Broken promise</span>;
  if (ps.state === "pending" || ps.state === "due-today") return <span className="pill-info">Promised {ps.state === "due-today" ? "today" : date(ps.promise.promised_on).replace(/ \d{4}$/, "")}</span>;
  return null;
}

/** One iOS grouped-list row for an invoice. The amount owed reads first. */
export function InvoiceRow({ inv, sub, to, onClick, right, testId }) {
  const Tag = to ? "a" : "button";
  const props = to ? linkProps(to) : { type: "button", onClick };
  return (
    <Tag {...props} data-testid={testId} className="group-row w-full text-left hover:bg-fill/60 active:bg-fill transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[16px] font-semibold truncate">{inv.customer?.name ?? "Unknown customer"}</span>
        </div>
        <div className="text-[13px] text-ink-3 line-clamp-2">{sub ?? [inv.reference, inv.description].filter(Boolean).join(" · ")}</div>
      </div>
      <div className="text-right flex-shrink-0 space-y-1">
        <div className="text-[16px] font-semibold tabular">{money(inv.owedCents ?? 0, inv.currency)}</div>
        {right ?? <StatusPill inv={inv} />}
      </div>
      <Icon name="chevronRight" size={18} className="text-ink-4 flex-shrink-0 -mr-1" />
    </Tag>
  );
}
