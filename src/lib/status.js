// Mirrors the Postgres trigger chaser_derive_invoice_status so the UI can
// preview status before a write. The database remains the source of truth.
export function deriveStatus(amountCents, amountPaidCents, current = "unpaid") {
  if (current === "written_off") return "written_off";
  const paid = Number(amountPaidCents || 0);
  const amount = Number(amountCents);
  if (paid <= 0) return "unpaid";
  if (paid < amount) return "partial";
  return "paid";
}

export const STATUS_LABELS = {
  unpaid: "Unpaid",
  partial: "Partial",
  paid: "Paid",
  written_off: "Written off",
};
