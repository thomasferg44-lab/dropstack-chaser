import { useMemo, useState } from "react";
import { planPayment, fullPaymentInput } from "../lib/payment.js";
import { formatCents, outstandingCents } from "../lib/money.js";
import { STATUS_LABELS } from "../lib/status.js";
import { companyConfig } from "../../companyConfig.js";
import Modal from "./Modal.jsx";

/**
 * Record what was just received. The effect is spelled out before confirming,
 * because a wrong balance is the one mistake that ends the client's trust in
 * the whole tool.
 */
export default function PaymentSheet({ invoice, onClose, onSaved }) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { locale } = companyConfig;
  const currency = invoice.currency || companyConfig.currency;

  const plan = useMemo(() => planPayment(invoice, amount), [invoice, amount]);
  const touched = amount.trim() !== "";
  const money = (c) => formatCents(c, currency, locale);

  async function save() {
    if (!plan.ok) return;
    setBusy(true);
    setError(null);
    try {
      await onSaved({
        invoiceId: invoice.id,
        newPaidCents: plan.newPaidCents,
        clearWriteOff: plan.clearsWriteOff,
      });
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Record payment · ${invoice.customer?.name || ""}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Figure label="Invoice total" value={money(invoice.amount_cents)} />
          <Figure label="Paid so far" value={money(invoice.amount_paid_cents || 0)} />
          <Figure label="Balance" value={money(outstandingCents(invoice))} tone="text-accent-1" />
        </div>

        <div className="field">
          <label htmlFor="payment-amount">Amount received now</label>
          <div className="flex gap-2">
            <input
              id="payment-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              autoFocus
            />
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={() => setAmount(fullPaymentInput(invoice))}
            >
              Paid in full
            </button>
          </div>
          <span className="text-[11px] text-dim">
            This is added to what was paid before. To correct the running total instead, edit the invoice.
          </span>
          {touched && !plan.ok && <span className="text-xs text-status-critical">{plan.errors[0]}</span>}
        </div>

        {plan.ok && (
          <div className="card bg-bg text-sm flex flex-col gap-1">
            <Line label="Paid after this" value={money(plan.newPaidCents)} />
            <Line label="Balance after this" value={money(plan.newBalanceCents)} strong />
            <Line label="Status becomes" value={STATUS_LABELS[plan.newStatus]} />
            {plan.overpaymentCents > 0 && (
              <p className="text-status-due text-xs mt-1">
                That is {money(plan.overpaymentCents)} more than the balance. The invoice will be marked paid.
              </p>
            )}
            {plan.clearsWriteOff && (
              <p className="text-status-due text-xs mt-1">
                This invoice is written off. Recording a payment brings it back so the amounts add up.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-status-critical text-sm">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!plan.ok || busy} onClick={save}>
            {busy ? "Saving…" : "Record payment"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Figure({ label, value, tone = "" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-dim">{label}</div>
      <div className={`font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function Line({ label, value, strong }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-mute">{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
