// Recording a payment. All arithmetic is on integer cents.
//
// The amount entered here is what was JUST RECEIVED, and it is added to what
// was paid before. Correcting the running total instead (e.g. fixing a typo)
// is done on the invoice edit form, where "Amount paid" is absolute. Keeping
// those two separate is what stops a second R500 payment from silently
// overwriting the first.

import { parseAmountToCents, centsToInput, outstandingCents } from "./money.js";
import { deriveStatus } from "./status.js";

/** What the "Paid in full" shortcut should put in the box. */
export function fullPaymentInput(invoice) {
  return centsToInput(outstandingCents(invoice));
}

/**
 * Work out the effect of a payment without applying it.
 * { ok, errors, amountCents, newPaidCents, newBalanceCents, overpaymentCents,
 *   newStatus, clearsWriteOff }
 */
export function planPayment(invoice, input) {
  const errors = [];
  const { cents, error } = parseAmountToCents(input);

  if (error) errors.push(error);
  else if (cents === null) errors.push("Enter an amount");
  else if (cents === 0) errors.push("Amount must be more than zero");
  else if (cents < 0) errors.push("Amount cannot be negative");

  const total = Number(invoice.amount_cents);
  const currentPaid = Number(invoice.amount_paid_cents || 0);
  const ok = errors.length === 0;
  const amountCents = ok ? cents : null;
  const newPaidCents = ok ? currentPaid + cents : currentPaid;

  return {
    ok,
    errors,
    amountCents,
    newPaidCents,
    newBalanceCents: Math.max(0, total - newPaidCents),
    overpaymentCents: Math.max(0, newPaidCents - total),
    // Receiving money means the invoice is not written off any more, so the
    // status is always re-derived from the amounts rather than preserved.
    newStatus: deriveStatus(total, newPaidCents, "unpaid"),
    clearsWriteOff: invoice.status === "written_off",
  };
}
