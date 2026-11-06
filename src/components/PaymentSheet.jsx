import { useMemo, useState } from "react";
import Sheet from "./ui/Sheet.jsx";
import Icon from "./ui/Icon.jsx";
import { NumberField } from "./ui/Field.jsx";
import { useToast } from "./ui/Toast.jsx";
import { planPayment, fullPaymentInput } from "../lib/payment.js";
import { formatCents, outstandingCents } from "../lib/money.js";
import { STATUS_LABELS } from "../lib/status.js";
import { useData } from "../state/DataStore.jsx";
import { companyConfig } from "../../companyConfig.js";

/**
 * Record what was just received. The effect is spelled out before confirming
 * (this sheet IS the mark-paid confirmation): a wrong balance is the one
 * mistake that ends the client's trust in the whole tool. Paid in full takes
 * the invoice off the ladder and out of every queue at once (auto-stop).
 */
export default function PaymentSheet({ invoice, onClose }) {
  const { recordPayment } = useData();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { locale } = companyConfig;
  const currency = invoice.currency || companyConfig.currency;
  const money = (c) => formatCents(c, currency, locale);
  const plan = useMemo(() => planPayment(invoice, amount), [invoice, amount]);
  const showErr = touched && amount.trim() !== "" && !plan.ok;

  async function save() {
    setTouched(true);
    if (!plan.ok) return;
    setBusy(true); setError(null);
    try {
      await recordPayment({ invoiceId: invoice.id, newPaidCents: plan.newPaidCents, clearWriteOff: plan.clearsWriteOff });
      toast(plan.newStatus === "paid" ? "Marked paid. Off the ladder and out of every queue." : `Payment recorded. ${money(plan.newBalanceCents)} still outstanding.`);
      onClose(true);
    } catch (e) {
      setError(e.message); setBusy(false);
    }
  }

  const footer = (
    <button type="button" className="btn-primary w-full text-[17px]" disabled={!plan.ok || busy} onClick={save}>
      {busy ? "Saving…" : plan.ok && plan.newStatus === "paid" ? "Mark as paid" : "Record payment"}
    </button>
  );

  return (
    <Sheet onClose={() => onClose(false)} title={`Payment from ${invoice.customer?.name ?? ""}`} footer={footer}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Figure label="Invoice total" value={money(invoice.amount_cents)} />
          <Figure label="Paid so far" value={money(invoice.amount_paid_cents || 0)} />
          <Figure label="Outstanding" value={money(outstandingCents(invoice))} strong />
        </div>
        <div className="flex items-end gap-2">
          <NumberField className="flex-1" id="payment-amount" label="Amount received now" prefix="R" value={amount} data-autofocus
            onChange={(e) => setAmount(e.target.value)} onBlur={() => setTouched(true)} placeholder="0,00"
            error={showErr ? plan.errors[0] : null} help={!showErr ? "Added to what was paid before." : null} />
          <button type="button" className="btn-secondary mb-[26px]" onClick={() => { setAmount(fullPaymentInput(invoice)); setTouched(true); }}>Paid in full</button>
        </div>
        {plan.ok && (
          <div className="rounded-[14px] bg-fill px-4 py-3 text-[15px] space-y-1" data-testid="payment-preview">
            <Line label="Paid after this" value={money(plan.newPaidCents)} />
            <Line label="Outstanding after this" value={money(plan.newBalanceCents)} strong />
            <Line label="Status becomes" value={STATUS_LABELS[plan.newStatus]} />
            {plan.newStatus === "paid" && <p className="text-[13px] text-good pt-1 flex gap-1.5"><Icon name="check" size={15} />It leaves the ladder and every queue straight away. No more nudges.</p>}
            {plan.overpaymentCents > 0 && <p className="text-[13px] text-warn pt-1">That's {money(plan.overpaymentCents)} more than the outstanding amount. The invoice will be marked paid.</p>}
            {plan.clearsWriteOff && <p className="text-[13px] text-warn pt-1">This invoice is written off. Recording a payment brings it back so the amounts add up.</p>}
          </div>
        )}
        {error && <p className="field-error" role="alert"><Icon name="alert" size={15} />{error}</p>}
        <p className="text-[13px] text-ink-3">To correct the running total instead (say, a typo), edit the invoice.</p>
      </div>
    </Sheet>
  );
}

function Figure({ label, value, strong }) {
  return (
    <div className="rounded-[12px] bg-fill px-2 py-2.5">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className={`tabular text-[15px] ${strong ? "font-semibold" : ""}`}>{value}</div>
    </div>
  );
}
function Line({ label, value, strong }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-3">{label}</span>
      <span className={`tabular ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
