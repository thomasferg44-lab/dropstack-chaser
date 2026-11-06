// Every database call in the app goes through here. Tables are chaser_*.
// Amounts in and out are integer cents — this layer never converts them.
//
// Schema level: the 2026-11-05 patch adds columns and chaser_promises. Until
// it's applied the app runs in "v1" mode: everything v1 could do still works,
// and the new features say plainly that they need the database update rather
// than failing half-way. detectSchema() decides once per session.
import { supabase } from "./supabase.js";

function unwrap({ data, error }) {
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}

export const NEEDS_PATCH = "needs-patch";
const isMissing = (e) => ["PGRST204", "PGRST205", "PGRST200", "PGRST202", "42703", "42P01"].includes(e?.code);

let schemaLevel = null;
export async function detectSchema() {
  if (schemaLevel) return schemaLevel;
  const { error } = await supabase.from("chaser_promises").select("id").limit(0);
  if (!error) schemaLevel = "v2";
  else if (isMissing(error)) schemaLevel = "v1";
  else throw Object.assign(new Error(error.message), { code: error.code });
  return schemaLevel;
}
export const getSchemaLevel = () => schemaLevel;
export function resetSchemaLevel() { schemaLevel = null; }
function requireV2(what) {
  if (schemaLevel !== "v2") throw Object.assign(new Error(`${what} needs the November database update (supabase/patches/2026-11-05-compete-upgrades.sql).`), { code: NEEDS_PATCH });
}

// ---- customers -------------------------------------------------------------

export async function listCustomers() {
  return unwrap(await supabase.from("chaser_customers").select("*").order("name"));
}

export async function saveCustomer(customer) {
  const row = {
    name: customer.name.trim(),
    phone: customer.phone?.trim() || null,
    email: customer.email?.trim() || null,
  };
  if (customer.id) {
    return unwrap(await supabase.from("chaser_customers").update(row).eq("id", customer.id).select().single());
  }
  return unwrap(await supabase.from("chaser_customers").insert(row).select().single());
}

export async function deleteCustomer(id) {
  unwrap(await supabase.from("chaser_customers").delete().eq("id", id));
}

// ---- invoices --------------------------------------------------------------

const SELECT_V1 = "*, customer:chaser_customers(id, name, phone, email), nudges:chaser_nudges(id, tone, channel, sent_at)";
const SELECT_V2 = "*, customer:chaser_customers(id, name, phone, email, is_demo), nudges:chaser_nudges(id, tone, channel, stage, sent_at, is_demo), promises:chaser_promises(id, promised_on, note, created_at, created_by, is_demo)";
const invoiceSelect = () => (schemaLevel === "v2" ? SELECT_V2 : SELECT_V1);

export async function listInvoices() {
  await detectSchema();
  const rows = unwrap(await supabase.from("chaser_invoices").select(invoiceSelect()).order("due_on", { ascending: true }));
  return rows.map((r) => ({ promises: [], ...r }));
}

/** `invoice` fields are already parsed: amount_cents / amount_paid_cents are integers. */
export async function saveInvoice(invoice) {
  for (const k of ["amount_cents", "amount_paid_cents"]) {
    if (!Number.isInteger(invoice[k])) throw new Error(`${k} must be an integer (cents)`);
  }
  const row = {
    customer_id: invoice.customer_id,
    reference: invoice.reference?.trim() || null,
    description: invoice.description?.trim() || null,
    amount_cents: invoice.amount_cents,
    amount_paid_cents: invoice.amount_paid_cents,
    currency: invoice.currency,
    issued_on: invoice.issued_on,
    due_on: invoice.due_on,
    notes: invoice.notes?.trim() || null,
  };
  // status is derived by the trigger; only written_off is set by hand.
  if (invoice.status === "written_off" || invoice.clearWrittenOff) {
    row.status = invoice.status === "written_off" ? "written_off" : "unpaid";
  }
  if (invoice.id) {
    return unwrap(await supabase.from("chaser_invoices").update(row).eq("id", invoice.id).select(invoiceSelect()).single());
  }
  return unwrap(await supabase.from("chaser_invoices").insert(row).select(invoiceSelect()).single());
}

export async function deleteInvoice(id) {
  unwrap(await supabase.from("chaser_invoices").delete().eq("id", id));
}

/**
 * Record a payment by writing the new running total. The status trigger
 * recalculates status from the amounts, so it can never drift; on the
 * patched database it also stamps paid_at, and paid_by (sent here) records
 * who marked it paid. `clearWriteOff` un-writes-off an invoice that has now
 * been paid something.
 */
export async function recordPayment({ invoiceId, newPaidCents, clearWriteOff = false, paidBy = null }) {
  if (!Number.isInteger(newPaidCents)) throw new Error("newPaidCents must be an integer (cents)");
  const row = { amount_paid_cents: newPaidCents };
  if (clearWriteOff) row.status = "unpaid"; // the trigger re-derives it immediately
  if (schemaLevel === "v2" && paidBy) row.paid_by = paidBy;
  return unwrap(await supabase.from("chaser_invoices").update(row).eq("id", invoiceId).select(invoiceSelect()).single());
}

// ---- nudges and promises ---------------------------------------------------

/** Record that a nudge was sent. The message itself is never stored. */
export async function recordNudge({ invoiceId, channel, tone, stage = null, sentAt = null }) {
  const row = { invoice_id: invoiceId, channel, tone };
  if (schemaLevel === "v2" && stage) row.stage = stage;
  if (sentAt) row.sent_at = sentAt; // outbox replays keep the real send time
  return unwrap(await supabase.from("chaser_nudges").insert(row).select().single());
}

export async function logPromise({ invoiceId, promisedOn, note, createdBy = null, createdAt = null }) {
  requireV2("Promise-to-pay");
  const row = { invoice_id: invoiceId, promised_on: promisedOn, note: note || null, created_by: createdBy };
  if (createdAt) row.created_at = createdAt;
  return unwrap(await supabase.from("chaser_promises").insert(row).select().single());
}

// ---- import, demo, quote pull ------------------------------------------------

/** Atomic: all rows or none. See chaser_import_invoices in schema.sql. */
export async function importInvoices(payload) {
  return unwrap(await supabase.rpc("chaser_import_invoices", { payload }));
}

export async function loadDemo(payload) {
  requireV2("Demo mode");
  return unwrap(await supabase.rpc("chaser_load_demo", { payload }));
}

export async function removeDemo() {
  requireV2("Demo mode");
  return unwrap(await supabase.rpc("chaser_remove_demo"));
}

/**
 * Accepted/invoiced quotes from Quote & Invoice (same Supabase project). Read
 * only. RLS on `quotes` returns only this business's rows. Returns null when
 * this project has no quotes table (Quote & Invoice isn't part of this deploy).
 */
export async function listOutstandingQuotes(select, statuses) {
  const { data, error } = await supabase.from("quotes").select(select).in("status", statuses).order("accepted_at", { ascending: false });
  if (error && isMissing(error)) return null;
  return unwrap({ data, error });
}

export async function importFromQuotes(payload) {
  requireV2("Pulling from Quote & Invoice");
  return importInvoices(payload);
}
