// "Pull from Quote & Invoice": accepted quotes nobody has paid yet, read
// from the Quote tool's `quotes` table in the same Supabase project, become
// chaser invoices with one tap. Nothing is re-typed.
//
// - Reads only; never writes to `quotes` (the Quote repo owns that table).
//   Its RLS returns only the signed-in business's own rows.
// - Outstanding = status accepted or invoiced. `paid` quotes are excluded.
//   Marking an invoice paid HERE does not write back to Quote (flagged as a
//   Quote pass-2 item: it needs a write path Quote has to own).
// - Due date = invoiced date (else accepted date) + paymentTermsDays from
//   config. Only past-due ones are offered by default.
// - Dedupe: the quote id is stored on the imported invoice
//   (chaser_invoices.source_quote_id, unique). Already-imported quotes are
//   hidden here AND the database skips them, so re-running never duplicates.
// - The customer is the same person across tools: matched on phone number
//   first (normalised), then email, else created.
// Money: Quote stores rand as Postgres numeric; it's read as text
// (`total::text`) and parsed to integer cents, never through a float.
import { parseAmountToCents } from "./money.js";
import { addDays, daysOverdue, isoFromTimestamp } from "./dates.js";
import { normalisePhone } from "./phone.js";

export const QUOTE_SELECT =
  "id, status, customer_name, customer_phone, customer_email, line_items, total_text:total::text, accepted_at, invoiced_at, created_at";
export const OUTSTANDING_STATUSES = ["accepted", "invoiced"];

/** The reference the customer saw on the quote/invoice PDF (Quote's docRef). */
export function quoteRef(q) {
  const inv = q.status === "invoiced" || q.status === "paid";
  return `${inv ? "INV" : "Q"}-${String(q.id).slice(0, 6).toUpperCase()}`;
}

/** "Lawn and edging, plus 2 more" from the line items. */
export function quoteDescription(q) {
  const items = Array.isArray(q.line_items) ? q.line_items.filter((x) => x && String(x.description ?? "").trim()) : [];
  if (!items.length) return "From Quote & Invoice";
  const first = String(items[0].description).trim().slice(0, 80);
  return items.length > 1 ? `${first}, plus ${items.length - 1} more` : first;
}

/**
 * One quote → a candidate row for the pull sheet.
 * { quoteId, reference, description, amount_cents, issued_on, due_on,
 *   daysOverdue, pastDue, eligible, reason, customer: { name, phone, email } }
 */
export function quoteToCandidate(q, { termsDays = 7, today }) {
  const { cents, error } = parseAmountToCents(q.total_text ?? q.total);
  const issued = isoFromTimestamp(q.invoiced_at ?? q.accepted_at ?? q.created_at);
  const due = issued ? addDays(issued, Math.max(0, Number(termsDays) || 0)) : null;
  const days = due ? daysOverdue(due, today) : 0;
  let reason = null;
  if (!OUTSTANDING_STATUSES.includes(q.status)) reason = q.status === "paid" ? "Already paid in Quote & Invoice" : "Not accepted yet";
  else if (error || cents === null || cents <= 0) reason = "No usable total on the quote";
  else if (!issued) reason = "No acceptance date";
  else if (!String(q.customer_name ?? "").trim()) reason = "No customer name";
  return {
    quoteId: q.id,
    reference: quoteRef(q),
    description: quoteDescription(q),
    amount_cents: cents ?? 0,
    issued_on: issued,
    due_on: due,
    daysOverdue: days,
    pastDue: days > 0,
    eligible: reason === null,
    reason,
    customer: {
      name: String(q.customer_name ?? "").trim(),
      phone: q.customer_phone?.trim() || null,
      email: q.customer_email?.trim() || null,
    },
  };
}

/**
 * Candidates for the sheet: eligible, not already imported. Past-due first
 * (most overdue first); `includeNotDue` adds the ones still within terms.
 */
export function pullCandidates(quotes, { importedQuoteIds = [], termsDays, today, includeNotDue = false }) {
  const seen = new Set(importedQuoteIds.filter(Boolean));
  const all = (quotes || []).map((q) => quoteToCandidate(q, { termsDays, today }));
  const fresh = all.filter((c) => c.eligible && !seen.has(c.quoteId));
  return {
    offered: fresh.filter((c) => includeNotDue || c.pastDue).sort((a, b) => b.daysOverdue - a.daysOverdue),
    notYetDue: fresh.filter((c) => !c.pastDue).length,
    alreadyImported: all.filter((c) => seen.has(c.quoteId)).length,
    // Accepted but unusable (no total, no name...): shown so nothing vanishes silently.
    skipped: all.filter((c, i) => !c.eligible && OUTSTANDING_STATUSES.includes(quotes[i].status)),
  };
}

/** Match a quote's customer to an existing chaser customer: phone, then email. */
export function matchCustomer(customer, existing) {
  const phone = normalisePhone(customer.phone);
  if (phone) {
    const byPhone = existing.find((c) => normalisePhone(c.phone) === phone);
    if (byPhone) return { id: byPhone.id, by: "phone" };
  }
  const email = String(customer.email ?? "").trim().toLowerCase();
  if (email) {
    const byEmail = existing.find((c) => String(c.email ?? "").trim().toLowerCase() === email);
    if (byEmail) return { id: byEmail.id, by: "email" };
  }
  return null;
}

/** Selected candidates → the chaser_import_invoices payload (one atomic call). */
export function buildPullPayload(selected, existingCustomers, currency = "ZAR") {
  const customers = [];
  const invoices = [];
  const keyFor = new Map();
  for (const c of selected) {
    const m = matchCustomer(c.customer, existingCustomers);
    let key;
    if (m) {
      key = `id:${m.id}`;
      if (!keyFor.has(key)) { keyFor.set(key, true); customers.push({ key, id: m.id }); }
    } else {
      // Same person twice in one pull (by phone, else email, else name) → one customer.
      const ident = normalisePhone(c.customer.phone) || c.customer.email?.toLowerCase() || `name:${c.customer.name.toLowerCase()}`;
      key = `new:${ident}`;
      if (!keyFor.has(key)) {
        keyFor.set(key, true);
        customers.push({ key, id: null, name: c.customer.name, phone: c.customer.phone, email: c.customer.email });
      }
    }
    invoices.push({
      customer_key: key,
      reference: c.reference,
      description: c.description,
      amount_cents: c.amount_cents,
      amount_paid_cents: 0,
      currency,
      issued_on: c.issued_on,
      due_on: c.due_on,
      notes: "Pulled from Quote & Invoice",
      source_quote_id: c.quoteId,
    });
  }
  return { customers, invoices };
}
