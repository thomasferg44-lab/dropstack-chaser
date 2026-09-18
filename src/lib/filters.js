// Dashboard list filtering. Pure: takes enriched invoices (see aging.js),
// returns the subset to show. Status "open" (unpaid + partial) is the default
// so paid and written-off invoices drop out of view but stay searchable.

export const STATUS_FILTERS = [
  { key: "open", label: "Open" },
  { key: "unpaid", label: "Unpaid" },
  { key: "partial", label: "Partial" },
  { key: "paid", label: "Paid" },
  { key: "written_off", label: "Written off" },
  { key: "all", label: "All" },
];

export const DEFAULT_FILTERS = { status: "open", customerId: "", bucket: null, query: "" };

export function matchesStatus(inv, status) {
  if (status === "all") return true;
  if (status === "open") return inv.status === "unpaid" || inv.status === "partial";
  return inv.status === status;
}

/** Case-insensitive substring match on customer name, reference or description. */
export function matchesQuery(inv, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  return [inv.customer?.name, inv.reference, inv.description]
    .filter(Boolean)
    .some((s) => s.toLowerCase().includes(q));
}

export function filterInvoices(invoices, filters) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  return invoices.filter(
    (inv) =>
      matchesStatus(inv, f.status) &&
      (!f.customerId || inv.customer_id === f.customerId) &&
      (!f.bucket || inv.bucket === f.bucket) &&
      matchesQuery(inv, f.query),
  );
}

/**
 * How many invoices match everything EXCEPT the status filter, so the UI can
 * say "3 paid invoices also match — show them". Only meaningful when the
 * status filter is narrower than "all".
 */
export function countHiddenByStatus(invoices, filters) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  if (f.status === "all") return 0;
  return filterInvoices(invoices, { ...f, status: "all" }).length - filterInvoices(invoices, f).length;
}
