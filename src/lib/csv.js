// CSV import: forgiving parse → column guessing → per-row normalisation.
// Nothing here talks to the database. Every row in the file produces exactly
// one entry in the output (or is counted as blank) — rows are never dropped.

import { parseAmountToCents } from "./money.js";
import { parseFlexibleDate, addDays } from "./dates.js";

export const DEFAULT_TERMS_DAYS = 30;

// ---------------------------------------------------------------------------
// 1. Raw parsing
// ---------------------------------------------------------------------------

function detectDelimiter(firstLine) {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = -1;
  for (const c of candidates) {
    let count = 0;
    let inQ = false;
    for (const ch of firstLine) {
      if (ch === '"') inQ = !inQ;
      else if (ch === c && !inQ) count++;
    }
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Parse CSV text into { headers, rows, delimiter }.
 * Handles quoted fields, escaped quotes (""), CRLF, a UTF-8 BOM, and
 * comma / semicolon / tab / pipe delimiters (auto-detected from the header).
 * `rows` is an array of { line, cells } so errors can cite the original line.
 */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstNewline = text.search(/\r?\n/);
  const delimiter = detectDelimiter(firstNewline === -1 ? text : text.slice(0, firstNewline));

  const records = [];
  let cells = [];
  let cell = "";
  let inQ = false;
  let line = 1;
  let recordStartLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQ = true;
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (ch === "\r") {
      // swallow; \n handles the record
    } else if (ch === "\n") {
      cells.push(cell);
      records.push({ line: recordStartLine, cells });
      cells = [];
      cell = "";
      line++;
      recordStartLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || cells.length > 0) {
    cells.push(cell);
    records.push({ line: recordStartLine, cells });
  }

  if (records.length === 0) return { headers: [], rows: [], delimiter };
  const headers = records[0].cells.map((h) => h.trim());
  const rows = records.slice(1).map((r) => ({
    line: r.line,
    cells: r.cells.map((c) => c.trim()),
  }));
  return { headers, rows, delimiter };
}

// ---------------------------------------------------------------------------
// 2. Column guessing
// ---------------------------------------------------------------------------

export const FIELDS = [
  { key: "customer_name", label: "Customer name", required: true },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "reference", label: "Invoice reference" },
  { key: "description", label: "Description" },
  { key: "amount", label: "Amount", required: true },
  { key: "amount_paid", label: "Amount paid" },
  { key: "issued_on", label: "Issued date" },
  { key: "due_on", label: "Due date" },
  { key: "currency", label: "Currency" },
  { key: "notes", label: "Notes" },
];

// Aliases are compared after normalisation: lowercase, letters+digits only.
// Order matters: earlier fields claim a header first ("Amount Paid" must go
// to amount_paid, not amount — so amount_paid is checked before amount).
const ALIASES = [
  ["amount_paid", ["amountpaid", "paid", "paidamount", "paidtodate", "payments", "received", "amountreceived", "paymentreceived"]],
  ["amount", ["amount", "amountdue", "total", "totalamount", "invoiceamount", "invoicetotal", "grandtotal", "value", "invoicevalue", "balance", "balancedue", "outstanding", "amountoutstanding", "owing", "amountowing", "sum", "price"]],
  ["due_on", ["due", "duedate", "dueon", "datedue", "paymentdue", "paymentduedate", "payby", "duedatedate"]],
  ["issued_on", ["date", "issued", "issuedate", "issuedon", "dateissued", "invoicedate", "invoiced", "created", "createdon", "datecreated", "invdate", "transactiondate"]],
  ["reference", ["reference", "ref", "refno", "invoice", "invoiceno", "invoicenumber", "invoicenum", "invoiceid", "invno", "invnumber", "inv", "number", "no", "docnumber", "documentnumber", "docno"]],
  ["email", ["email", "emailaddress", "customeremail", "clientemail", "mail", "emailaddr"]],
  ["phone", ["phone", "phonenumber", "cell", "cellphone", "cellnumber", "mobile", "mobilenumber", "tel", "telephone", "contactnumber", "contactno", "whatsapp", "number"]],
  ["customer_name", ["customer", "customername", "client", "clientname", "name", "billto", "company", "companyname", "account", "accountname", "contact", "debtor"]],
  ["description", ["description", "desc", "details", "detail", "item", "items", "job", "service", "memo", "narrative", "lineitem"]],
  ["notes", ["notes", "note", "comments", "comment", "remarks"]],
  ["currency", ["currency", "ccy", "cur"]],
];

export function normaliseHeader(h) {
  return String(h).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Returns { headerIndex: fieldKey | null } — one field per header at most. */
export function guessMapping(headers) {
  const mapping = {};
  const claimedFields = new Set();
  const norm = headers.map(normaliseHeader);
  for (const [field, aliases] of ALIASES) {
    for (let i = 0; i < norm.length; i++) {
      if (mapping[i] !== undefined) continue;
      if (aliases.includes(norm[i])) {
        mapping[i] = field;
        claimedFields.add(field);
        break;
      }
    }
  }
  for (let i = 0; i < headers.length; i++) if (mapping[i] === undefined) mapping[i] = null;
  return mapping;
}

// ---------------------------------------------------------------------------
// 3. Row normalisation
// ---------------------------------------------------------------------------

/** Digits only; South African local "0xx…" becomes "27xx…". */
export function normalisePhone(raw) {
  if (!raw) return "";
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("0")) d = "27" + d.slice(1);
  return d;
}

export function normaliseEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

export function normaliseName(raw) {
  return String(raw || "").trim().replace(/\s+/g, " ");
}

function pick(cells, mapping, field) {
  for (const [idx, f] of Object.entries(mapping)) {
    if (f === field) return cells[Number(idx)] ?? "";
  }
  return "";
}

/**
 * Turn one raw row into a candidate invoice.
 * Returns { blank, values, errors, warnings } — never throws, never null.
 *   values : editable strings as the user should see them in the preview
 *   errors : { field: message } — row cannot be imported until fixed
 *   warnings: string[] — imported as-is unless the user changes something
 */
export function normaliseRow(cells, mapping, { today, defaultCurrency = "ZAR" }) {
  if (cells.every((c) => c === "")) return { blank: true, values: {}, errors: {}, warnings: [] };

  const values = {
    customer_name: normaliseName(pick(cells, mapping, "customer_name")),
    phone: String(pick(cells, mapping, "phone")).trim(),
    email: String(pick(cells, mapping, "email")).trim(),
    reference: String(pick(cells, mapping, "reference")).trim(),
    description: String(pick(cells, mapping, "description")).trim(),
    amount: String(pick(cells, mapping, "amount")).trim(),
    amount_paid: String(pick(cells, mapping, "amount_paid")).trim(),
    issued_on: String(pick(cells, mapping, "issued_on")).trim(),
    due_on: String(pick(cells, mapping, "due_on")).trim(),
    currency: String(pick(cells, mapping, "currency")).trim().toUpperCase() || defaultCurrency,
    notes: String(pick(cells, mapping, "notes")).trim(),
  };
  return validateValues(values, { today });
}

/**
 * Validate editable values (strings) → parsed fields. Re-run after the user
 * edits a cell in the preview. Sub-cent amounts, bad dates, missing names are
 * errors; defaulted dates and zero amounts are warnings.
 */
export function validateValues(values, { today }) {
  const errors = {};
  const warnings = [];
  const parsed = {};

  if (!values.customer_name) errors.customer_name = "Customer name is required";

  const amt = parseAmountToCents(values.amount);
  if (amt.error) errors.amount = amt.error;
  else if (amt.cents === null) errors.amount = "Amount is required";
  else if (amt.cents < 0) errors.amount = "Amount cannot be negative";
  else {
    parsed.amount_cents = amt.cents;
    if (amt.cents === 0) warnings.push("Amount is zero");
  }

  const paid = parseAmountToCents(values.amount_paid);
  if (paid.error) errors.amount_paid = paid.error;
  else if (paid.cents === null) parsed.amount_paid_cents = 0;
  else if (paid.cents < 0) errors.amount_paid = "Paid amount cannot be negative";
  else {
    parsed.amount_paid_cents = paid.cents;
    if (parsed.amount_cents !== undefined && paid.cents > parsed.amount_cents) {
      warnings.push("Paid more than the invoice amount — will be marked paid");
    }
  }

  let issued = null;
  let due = null;
  if (values.issued_on) {
    issued = parseFlexibleDate(values.issued_on);
    if (!issued) errors.issued_on = `Can't read date "${values.issued_on}"`;
  }
  if (values.due_on) {
    due = parseFlexibleDate(values.due_on);
    if (!due) errors.due_on = `Can't read date "${values.due_on}"`;
  }
  if (!errors.issued_on && !errors.due_on) {
    if (!issued && !due) {
      errors.due_on = "Needs an issued or due date";
    } else if (issued && !due) {
      due = addDays(issued, DEFAULT_TERMS_DAYS);
      warnings.push(`No due date — set to ${DEFAULT_TERMS_DAYS} days after issue (${due})`);
    } else if (!issued && due) {
      issued = due <= today ? due : today;
      warnings.push(`No issued date — set to ${issued}`);
    }
    if (issued && due && due < issued) {
      errors.due_on = "Due date is before the issued date";
    }
  }
  parsed.issued_on = issued;
  parsed.due_on = due;

  if (values.phone && normalisePhone(values.phone).length < 7) {
    warnings.push("Phone number looks too short");
  }
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = "Email doesn't look valid";
  }
  if (!/^[A-Z]{3}$/.test(values.currency)) errors.currency = "Currency must be a 3-letter code";

  return { blank: false, values, parsed, errors, warnings };
}

// ---------------------------------------------------------------------------
// 4. Customer matching (in-file + against existing customers)
// ---------------------------------------------------------------------------

/**
 * Key used to decide two rows refer to the same customer: phone first, then
 * email, then exact (case-insensitive) name. Existing customers are matched
 * the same way so a re-import doesn't duplicate anyone.
 */
export function customerKey(values) {
  const p = normalisePhone(values.phone);
  if (p) return `phone:${p}`;
  const e = normaliseEmail(values.email);
  if (e) return `email:${e}`;
  const n = normaliseName(values.customer_name).toLowerCase();
  return n ? `name:${n}` : "";
}

/** Build lookup { key → customer } from existing DB customers (all keys). */
export function indexCustomers(customers) {
  const idx = new Map();
  for (const c of customers) {
    const p = normalisePhone(c.phone);
    const e = normaliseEmail(c.email);
    const n = normaliseName(c.name).toLowerCase();
    if (p && !idx.has(`phone:${p}`)) idx.set(`phone:${p}`, c);
    if (e && !idx.has(`email:${e}`)) idx.set(`email:${e}`, c);
    if (n && !idx.has(`name:${n}`)) idx.set(`name:${n}`, c);
  }
  return idx;
}

/** Try phone, then email, then name against the index. */
export function findExistingCustomer(values, idx) {
  const p = normalisePhone(values.phone);
  if (p && idx.has(`phone:${p}`)) return idx.get(`phone:${p}`);
  const e = normaliseEmail(values.email);
  if (e && idx.has(`email:${e}`)) return idx.get(`email:${e}`);
  const n = normaliseName(values.customer_name).toLowerCase();
  if (n && idx.has(`name:${n}`)) return idx.get(`name:${n}`);
  return null;
}

// ---------------------------------------------------------------------------
// 5. Whole-file pipeline
// ---------------------------------------------------------------------------

/**
 * Parse + normalise + match. Returns:
 * {
 *   headers, mapping, delimiter,
 *   rows: [{ id, line, include, values, parsed, errors, warnings, customer: {existing|null, key} }],
 *   blankRows: number
 * }
 * `existingCustomers` and `existingInvoices` come from the DB (may be empty).
 */
export function buildPreview(text, { mapping, existingCustomers = [], existingInvoices = [], today, defaultCurrency }) {
  const { headers, rows: raw, delimiter } = parseCsv(text);
  const map = mapping || guessMapping(headers);
  const custIdx = indexCustomers(existingCustomers);

  const rows = [];
  let blankRows = 0;
  for (const r of raw) {
    const n = normaliseRow(r.cells, map, { today, defaultCurrency });
    if (n.blank) {
      blankRows++;
      continue;
    }
    rows.push({ id: `row-${r.line}`, line: r.line, include: true, ...n });
  }
  annotateRows(rows, { custIdx, existingInvoices });
  return { headers, mapping: map, delimiter, rows, blankRows };
}

/**
 * (Re)compute customer matches, in-file duplicate warnings and "already
 * exists" flags. Mutates rows. Call after any edit.
 */
export function annotateRows(rows, { custIdx, existingInvoices = [] }) {
  const existingRefs = new Set(
    existingInvoices
      .filter((i) => i.reference)
      .map((i) => `${i.customer_id}|${i.reference.trim().toLowerCase()}`),
  );
  const seenRefs = new Map();

  for (const row of rows) {
    row.warnings = row.warnings.filter((w) => !w.startsWith("Duplicate") && !w.startsWith("Already"));
    row.customer = { key: customerKey(row.values), existing: findExistingCustomer(row.values, custIdx) };
    row.alreadyExists = false;

    const ref = (row.values.reference || "").trim().toLowerCase();
    if (ref) {
      const fileKey = `${row.customer.key}|${ref}`;
      if (seenRefs.has(fileKey)) {
        row.warnings.push(`Duplicate of line ${seenRefs.get(fileKey)} (same customer + reference)`);
      } else seenRefs.set(fileKey, row.line);

      if (row.customer.existing && existingRefs.has(`${row.customer.existing.id}|${ref}`)) {
        row.alreadyExists = true;
        row.warnings.push("Already imported (same customer + reference) — unticked");
      }
    }
  }
}

/**
 * Convert the previewed rows into the payload for the chaser_import_invoices
 * RPC. Only included rows with no errors are sent. New customers are
 * de-duplicated by key so one customer appearing on five lines is created once.
 */
export function buildImportPayload(rows) {
  const customers = new Map();
  const invoices = [];
  for (const row of rows) {
    if (!row.include || Object.keys(row.errors).length > 0) continue;
    const key = row.customer.key || `row:${row.line}`;
    if (!customers.has(key)) {
      const ex = row.customer.existing;
      customers.set(key, {
        key,
        id: ex ? ex.id : null,
        name: ex ? ex.name : row.values.customer_name,
        phone: ex ? ex.phone : row.values.phone || null,
        email: ex ? ex.email : row.values.email || null,
      });
    } else if (!customers.get(key).id) {
      // Fill in phone/email from later rows for the same new customer.
      const c = customers.get(key);
      if (!c.phone && row.values.phone) c.phone = row.values.phone;
      if (!c.email && row.values.email) c.email = row.values.email;
    }
    invoices.push({
      customer_key: key,
      reference: row.values.reference || null,
      description: row.values.description || null,
      amount_cents: row.parsed.amount_cents,
      amount_paid_cents: row.parsed.amount_paid_cents,
      currency: row.values.currency,
      issued_on: row.parsed.issued_on,
      due_on: row.parsed.due_on,
      notes: row.values.notes || null,
    });
  }
  return { customers: [...customers.values()], invoices };
}
