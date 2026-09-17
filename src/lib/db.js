// Every database call in the app goes through here. Tables are chaser_*.
// Amounts in and out are integer cents — this layer never converts them.
import { supabase } from "./supabase.js";

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
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
    return unwrap(
      await supabase.from("chaser_customers").update(row).eq("id", customer.id).select().single(),
    );
  }
  return unwrap(await supabase.from("chaser_customers").insert(row).select().single());
}

export async function deleteCustomer(id) {
  unwrap(await supabase.from("chaser_customers").delete().eq("id", id));
}

// ---- invoices --------------------------------------------------------------

const INVOICE_SELECT = "*, customer:chaser_customers(id, name, phone, email)";

export async function listInvoices() {
  return unwrap(
    await supabase.from("chaser_invoices").select(INVOICE_SELECT).order("due_on", { ascending: true }),
  );
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
    return unwrap(
      await supabase.from("chaser_invoices").update(row).eq("id", invoice.id).select(INVOICE_SELECT).single(),
    );
  }
  return unwrap(await supabase.from("chaser_invoices").insert(row).select(INVOICE_SELECT).single());
}

export async function deleteInvoice(id) {
  unwrap(await supabase.from("chaser_invoices").delete().eq("id", id));
}

// ---- import ----------------------------------------------------------------

/** Atomic: all rows or none. See chaser_import_invoices in schema.sql. */
export async function importInvoices(payload) {
  return unwrap(await supabase.rpc("chaser_import_invoices", { payload }));
}
