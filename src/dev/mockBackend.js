// LOCAL TEST BACKEND. Never used in a real deploy.
//
// An in-memory stand-in for the slice of supabase-js this app uses, so every
// flow can be driven in a browser (gate runs, screenshots, laptop demos)
// without a network and without touching any real database. Active only when
// the build sets VITE_MOCK_BACKEND=1 (see src/lib/supabase.js); otherwise the
// import is dead code and is dropped from the bundle.
//
// It mirrors the real access model closely enough to exercise the UI:
//   * no session -> every table and RPC is denied (anon has nothing in v1)
//   * authenticated -> full access to chaser_* (same as the RLS policies)
//   * quotes (Quote & Invoice's table) is scoped to owner_id, like its RLS
//   * the status trigger, the paid stamp, check constraints, FK cascades and
//     the unique source_quote_id come from supabase/schema.sql, re-expressed
// The SQL itself is verified separately (supabase/local-test, verify-*.sql);
// a pass here proves the UI and the pure logic, not the database.
//
// Persisted in localStorage so reloads keep state.
// Test switches (localStorage):
//   dropstack-mock-latency  ms per call (default 120)
//   dropstack-mock-fail     "all" -> every call fails like a dropped network
//   dropstack-mock-schema   "legacy" -> the database BEFORE the 2026-11-05
//                           patch (no new columns, no chaser_promises, no
//                           demo RPCs)
//   dropstack-mock-quotes   "absent" -> no quotes table in this project
import { deriveStatus } from "../lib/status.js";

const DB_KEY = "dropstack-mock-db-v1";
const SESSION_KEY = "dropstack-mock-session-v1";
export const MOCK_OWNER_ID = "00000000-0000-4000-8000-00000000c4a5";

// localStorage when the browser has it; an in-memory map otherwise (Node
// unit tests, private windows with storage blocked).
const mem = new Map();
const hasLs = () => { try { return typeof localStorage !== "undefined" && localStorage !== null && typeof localStorage.getItem === "function"; } catch { return false; } };
const ls = {
  get(k) { if (hasLs()) { try { return localStorage.getItem(k); } catch { /* fall through */ } } return mem.has(k) ? mem.get(k) : null; },
  set(k, v) { if (hasLs()) { try { localStorage.setItem(k, v); return; } catch { /* fall through */ } } mem.set(k, v); },
  del(k) { if (hasLs()) { try { localStorage.removeItem(k); return; } catch { /* fall through */ } } mem.delete(k); },
};
const legacy = () => ls.get("dropstack-mock-schema") === "legacy";
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const err = (code, message) => ({ data: null, error: { code, message } });

// ---- schema ------------------------------------------------------------------
const V1 = {
  chaser_customers: ["id", "name", "phone", "email", "created_at"],
  chaser_invoices: ["id", "customer_id", "reference", "description", "amount_cents", "amount_paid_cents", "currency",
    "issued_on", "due_on", "status", "notes", "created_at", "updated_at"],
  chaser_nudges: ["id", "invoice_id", "channel", "tone", "sent_at"],
};
const V2_EXTRA = {
  chaser_customers: ["is_demo"],
  chaser_invoices: ["is_demo", "source_quote_id", "paid_at", "paid_by"],
  chaser_nudges: ["stage", "is_demo"],
  chaser_promises: ["id", "invoice_id", "promised_on", "note", "created_at", "created_by", "is_demo"],
};
const QUOTE_COLS = ["id", "owner_id", "customer_name", "customer_phone", "customer_email", "line_items", "subtotal",
  "total", "status", "accepted_at", "invoiced_at", "paid_at", "created_at", "updated_at"];

function columns(table) {
  if (table === "quotes") return ls.get("dropstack-mock-quotes") === "absent" ? null : QUOTE_COLS;
  if (legacy()) return V1[table] ?? null;
  if (table === "chaser_promises") return V2_EXTRA.chaser_promises;
  return V1[table] ? [...V1[table], ...(V2_EXTRA[table] ?? [])] : null;
}

const DEFAULTS = {
  chaser_customers: () => ({ phone: null, email: null, is_demo: false }),
  chaser_invoices: () => ({ reference: null, description: null, amount_paid_cents: 0, currency: "ZAR", status: "unpaid",
    notes: null, is_demo: false, source_quote_id: null, paid_at: null, paid_by: null }),
  chaser_nudges: () => ({ stage: null, is_demo: false }),
  chaser_promises: () => ({ note: null, created_by: null, is_demo: false }),
  quotes: () => ({ owner_id: null, customer_phone: null, customer_email: null, line_items: [], subtotal: 0, total: 0,
    status: "draft", accepted_at: null, invoiced_at: null, paid_at: null }),
};
const TIME_COL = { chaser_nudges: "sent_at" };
// child table -> [fk column, parent table]
const FKS = {
  chaser_invoices: ["customer_id", "chaser_customers"],
  chaser_nudges: ["invoice_id", "chaser_invoices"],
  chaser_promises: ["invoice_id", "chaser_invoices"],
};

let memory = null;
function db() {
  const raw = ls.get(DB_KEY);
  if (raw) { try { memory = JSON.parse(raw); } catch { /* keep memory */ } }
  if (!memory) memory = {};
  for (const t of ["chaser_customers", "chaser_invoices", "chaser_nudges", "chaser_promises", "quotes"]) memory[t] ??= [];
  return memory;
}
function save(state) { memory = state; ls.set(DB_KEY, JSON.stringify(state)); }

async function delay() {
  const ms = Number(ls.get("dropstack-mock-latency") ?? 120);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  if (ls.get("dropstack-mock-fail") === "all") throw Object.assign(new TypeError("Failed to fetch"), { name: "TypeError" });
}

// ---- trigger + constraints (schema.sql) ---------------------------------------
function invoiceTrigger(row, old, actorEmail) {
  if (row.status !== "written_off") row.status = deriveStatus(row.amount_cents, row.amount_paid_cents, "unpaid");
  row.updated_at = nowIso();
  if (!legacy()) {
    if (row.status === "paid") {
      if (!row.paid_at) row.paid_at = nowIso();
      if (!row.paid_by) row.paid_by = actorEmail ?? null;
    } else {
      row.paid_at = null;
      row.paid_by = null;
    }
  }
  return row;
}
function checkRow(table, row, state) {
  if (table === "chaser_invoices") {
    if (!Number.isInteger(Number(row.amount_cents)) || row.amount_cents < 0) return "chaser_invoices_amount_nonneg";
    if (row.amount_paid_cents < 0) return "chaser_invoices_paid_nonneg";
    if (row.due_on < row.issued_on) return "chaser_invoices_due_after_issued";
    if (!state.chaser_customers.some((c) => c.id === row.customer_id)) return "chaser_invoices_customer_id_fkey";
    if (row.source_quote_id && state.chaser_invoices.some((i) => i.id !== row.id && i.source_quote_id === row.source_quote_id)) {
      return "duplicate key value violates unique constraint \"chaser_invoices_source_quote_uq\"";
    }
  }
  if (table === "chaser_nudges") {
    if (!["whatsapp", "email"].includes(row.channel)) return "chaser_nudges_channel_valid";
    if (!["gentle", "firm", "final"].includes(row.tone)) return "chaser_nudges_tone_valid";
    if (!state.chaser_invoices.some((i) => i.id === row.invoice_id)) return "chaser_nudges_invoice_id_fkey";
  }
  if (table === "chaser_promises" && !state.chaser_invoices.some((i) => i.id === row.invoice_id)) {
    return "chaser_promises_invoice_id_fkey";
  }
  return null;
}
function cascadeDelete(state, table, ids) {
  for (const [child, [fk, parent]] of Object.entries(FKS)) {
    if (parent !== table) continue;
    const gone = state[child].filter((r) => ids.includes(r[fk])).map((r) => r.id);
    if (gone.length) { cascadeDelete(state, child, gone); state[child] = state[child].filter((r) => !gone.includes(r.id)); }
  }
}

// ---- select parsing: "*, customer:chaser_customers(id, name), total::text" ----
function splitTop(s) {
  const out = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseSelect(s) {
  return splitTop(s || "*").map((item) => {
    const m = /^(?:(\w+):)?(\w+)\((.*)\)$/s.exec(item);
    if (m) return { embed: true, alias: m[1] ?? m[2], table: m[2], inner: parseSelect(m[3]) };
    const [colPart, cast] = item.split("::");
    const [alias, col] = colPart.includes(":") ? colPart.split(":") : [colPart, colPart];
    return { col: col.trim(), alias: alias.trim(), cast: cast?.trim() };
  });
}
function project(state, table, row, sel) {
  const cols = columns(table);
  const out = {};
  for (const s of sel) {
    if (s.embed) {
      const tcols = columns(s.table);
      if (!tcols) throw { code: "PGRST200", message: `Could not find a relationship between '${table}' and '${s.table}'` };
      if (FKS[s.table]?.[1] === table) {
        const fk = FKS[s.table][0];
        out[s.alias] = state[s.table].filter((r) => r[fk] === row.id).map((r) => project(state, s.table, r, s.inner));
      } else if (FKS[table]?.[1] === s.table) {
        const parent = state[s.table].find((r) => r.id === row[FKS[table][0]]);
        out[s.alias] = parent ? project(state, s.table, parent, s.inner) : null;
      }
    } else if (s.col === "*") {
      for (const c of cols) out[c] = clone(row[c] ?? null);
    } else {
      if (!cols.includes(s.col)) throw { code: "42703", message: `column ${table}.${s.col} does not exist` };
      const v = clone(row[s.col] ?? null);
      out[s.alias] = s.cast === "text" && v !== null ? String(v) : v;
    }
  }
  return out;
}

// ---- query builder -------------------------------------------------------------
class Query {
  constructor(client, table) {
    Object.assign(this, { client, table, op: "select", sel: "*", filters: [], orderBy: [], lim: null, singleMode: null });
  }
  select(cols = "*", opts = {}) { this.sel = cols; this.head = opts.head; this.countMode = opts.count; return this; }
  insert(rows) { this.op = "insert"; this.payload = rows; return this; }
  update(patch) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }
  eq(k, v) { this.filters.push([k, (r) => r[k] === v]); return this; }
  neq(k, v) { this.filters.push([k, (r) => r[k] !== v]); return this; }
  in(k, arr) { this.filters.push([k, (r) => arr.includes(r[k])]); return this; }
  is(k, v) { this.filters.push([k, (r) => (r[k] ?? null) === v]); return this; }
  not(k, op, v) { if (op === "is") this.filters.push([k, (r) => (r[k] ?? null) !== v]); return this; }
  lt(k, v) { this.filters.push([k, (r) => r[k] < v]); return this; }
  lte(k, v) { this.filters.push([k, (r) => r[k] <= v]); return this; }
  gt(k, v) { this.filters.push([k, (r) => r[k] > v]); return this; }
  gte(k, v) { this.filters.push([k, (r) => r[k] >= v]); return this; }
  order(k, { ascending = true } = {}) { this.orderBy.push({ k, ascending }); return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.singleMode = "one"; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  then(resolve, reject) { return this.run().then(resolve, reject); }

  async run() {
    try { await delay(); } catch (e) { return { data: null, error: { message: e.message } }; }
    const session = this.client.session();
    if (!session) return err("42501", `permission denied for table ${this.table}`);
    const cols = columns(this.table);
    if (!cols) return err("PGRST205", `Could not find the table 'public.${this.table}' in the schema cache`);
    for (const [k] of this.filters) if (!cols.includes(k)) return err("42703", `column ${this.table}.${k} does not exist`);
    for (const p of [].concat(this.op === "insert" || this.op === "update" ? this.payload : [])) {
      const bad = Object.keys(p ?? {}).find((k) => !cols.includes(k));
      if (bad) return err("PGRST204", `Could not find the '${bad}' column of '${this.table}' in the schema cache`);
    }
    const state = db();
    const uid = session.user.id;
    const scoped = this.table === "quotes";
    const visible = (r) => !scoped || r.owner_id === uid;
    let result = [];

    if (this.op === "insert") {
      for (const p of [].concat(this.payload)) {
        const row = { ...DEFAULTS[this.table](), id: uuid(), created_at: nowIso(), ...(TIME_COL[this.table] ? { [TIME_COL[this.table]]: nowIso() } : {}), ...clone(p) };
        if (scoped) row.owner_id = p.owner_id ?? uid;
        if (this.table === "chaser_invoices") invoiceTrigger(row, null, session.user.email);
        if (!legacy() && (this.table === "chaser_nudges" || this.table === "chaser_promises")) {
          // chaser_inherit_demo(): a nudge/promise on a demo invoice is demo too
          row.is_demo = Boolean(row.is_demo) || Boolean(state.chaser_invoices.find((i) => i.id === row.invoice_id)?.is_demo);
        }
        // Only the columns this schema level has (legacy: no v2 defaults).
        for (const k of Object.keys(row)) if (!cols.includes(k)) delete row[k];
        const bad = checkRow(this.table, row, state);
        if (bad) return err("23514", bad);
        result.push(row);
        state[this.table].push(row);
      }
    } else {
      const matched = state[this.table].filter((r) => visible(r) && this.filters.every(([, f]) => f(r)));
      if (this.op === "update") {
        for (const r of matched) {
          const next = { ...r, ...clone(this.payload) };
          if (this.table === "chaser_invoices") invoiceTrigger(next, r, session.user.email);
          const bad = checkRow(this.table, next, state);
          if (bad) return err("23514", bad);
          Object.assign(r, next);
          result.push(r);
        }
      } else if (this.op === "delete") {
        const ids = matched.map((r) => r.id);
        cascadeDelete(state, this.table, ids);
        state[this.table] = state[this.table].filter((r) => !ids.includes(r.id));
        result = matched;
      } else {
        result = matched;
      }
    }
    if (this.op !== "select") save(state);

    for (const { k, ascending } of [...this.orderBy].reverse()) {
      result = [...result].sort((a, b) => {
        const x = a[k], y = b[k];
        const c = x == null ? 1 : y == null ? -1 : typeof x === "number" ? x - y : String(x).localeCompare(String(y));
        return c * (ascending ? 1 : -1);
      });
    }
    if (this.lim != null) result = result.slice(0, this.lim);
    let data;
    try { data = result.map((r) => project(state, this.table, r, parseSelect(this.sel))); }
    catch (e) { return { data: null, error: e }; }
    if (this.singleMode === "one") {
      if (data.length !== 1) return err("PGRST116", "JSON object requested, multiple (or no) rows returned");
      return { data: data[0], error: null };
    }
    if (this.singleMode === "maybe") return { data: data[0] ?? null, error: null };
    if (this.head) return { data: null, count: data.length, error: null };
    return { data, error: null, count: this.countMode ? data.length : null };
  }
}

// ---- RPCs (mirror supabase/schema.sql) ------------------------------------------
function importInvoices(state, payload, { forceDemo = false, actorEmail } = {}) {
  const keyToId = {};
  let customersCreated = 0, invoicesCreated = 0, skipped = 0;
  const createdIds = [];
  const work = clone(state);
  const demo = (v) => (forceDemo ? true : legacy() ? undefined : Boolean(v));
  for (const c of payload.customers ?? []) {
    if (c.id == null) {
      const row = { ...DEFAULTS.chaser_customers(), id: uuid(), created_at: nowIso(), name: c.name, phone: c.phone || null, email: c.email || null };
      if (!legacy()) row.is_demo = demo(c.is_demo);
      work.chaser_customers.push(row);
      keyToId[c.key] = row.id;
      createdIds.push(row.id);
      customersCreated++;
    } else keyToId[c.key] = c.id;
  }
  const invIds = {};
  for (const i of payload.invoices ?? []) {
    const cid = keyToId[i.customer_key];
    if (!cid) throw new Error(`Unknown customer key ${i.customer_key}`);
    if (!legacy() && i.source_quote_id && work.chaser_invoices.some((x) => x.source_quote_id === i.source_quote_id)) { skipped++; continue; }
    const row = {
      ...DEFAULTS.chaser_invoices(), id: uuid(), created_at: nowIso(), customer_id: cid,
      reference: i.reference || null, description: i.description || null, amount_cents: Number(i.amount_cents),
      amount_paid_cents: Number(i.amount_paid_cents ?? 0), currency: i.currency || "ZAR", issued_on: i.issued_on, due_on: i.due_on,
      notes: i.notes || null,
    };
    if (!legacy()) { row.is_demo = demo(i.is_demo); row.source_quote_id = i.source_quote_id || null; }
    else { delete row.is_demo; delete row.source_quote_id; delete row.paid_at; delete row.paid_by; }
    invoiceTrigger(row, null, actorEmail);
    const bad = checkRow("chaser_invoices", row, work);
    if (bad) throw new Error(bad);
    work.chaser_invoices.push(row);
    if (i.key) invIds[i.key] = row.id;
    invoicesCreated++;
  }
  // A customer created in this call only for skipped invoices is removed again.
  const shells = work.chaser_customers.filter((c) => createdIds.includes(c.id) && !work.chaser_invoices.some((i) => i.customer_id === c.id));
  work.chaser_customers = work.chaser_customers.filter((c) => !shells.includes(c));
  customersCreated -= shells.length;
  return { work, invIds, result: { customers_created: customersCreated, invoices_created: invoicesCreated, ...(legacy() ? {} : { invoices_skipped: skipped }) } };
}

async function rpc(client, fn, args = {}) {
  try { await delay(); } catch (e) { return { data: null, error: { message: e.message } }; }
  const session = client.session();
  if (!session) return err("42501", `permission denied for function ${fn}`);
  const state = db();
  try {
    if (fn === "chaser_import_invoices") {
      const { work, result } = importInvoices(state, args.payload ?? {}, { actorEmail: session.user.email });
      save(work);
      return { data: result, error: null };
    }
    if (legacy()) return err("PGRST202", `Could not find the function public.${fn}(payload) in the schema cache`);
    if (fn === "chaser_load_demo") {
      const p = args.payload ?? {};
      const { work, invIds, result } = importInvoices(state, p, { forceDemo: true, actorEmail: session.user.email });
      let nudges = 0, promises = 0;
      for (const n of p.nudges ?? []) {
        const inv = invIds[n.invoice_key];
        if (!inv) throw new Error(`Unknown invoice key ${n.invoice_key}`);
        const row = { id: uuid(), invoice_id: inv, channel: n.channel, tone: n.tone, stage: n.stage ?? null, sent_at: n.sent_at, is_demo: true };
        const bad = checkRow("chaser_nudges", row, work);
        if (bad) throw new Error(bad);
        work.chaser_nudges.push(row); nudges++;
      }
      for (const pr of p.promises ?? []) {
        const inv = invIds[pr.invoice_key];
        if (!inv) throw new Error(`Unknown invoice key ${pr.invoice_key}`);
        work.chaser_promises.push({ id: uuid(), invoice_id: inv, promised_on: pr.promised_on, note: pr.note ?? null, created_at: pr.created_at ?? nowIso(), created_by: null, is_demo: true });
        promises++;
      }
      // paid demo invoices: the trigger stamped paid_at=now; the seed may backdate it
      for (const [key, paidAt] of Object.entries(p.paid_at ?? {})) {
        const row = work.chaser_invoices.find((r) => r.id === invIds[key]);
        if (row && row.status === "paid") row.paid_at = paidAt;
      }
      save(work);
      return { data: { customers_created: result.customers_created, invoices_created: result.invoices_created, nudges_created: nudges, promises_created: promises }, error: null };
    }
    if (fn === "chaser_remove_demo") {
      const counts = {
        nudges_removed: state.chaser_nudges.filter((r) => r.is_demo).length,
        promises_removed: state.chaser_promises.filter((r) => r.is_demo).length,
        invoices_removed: state.chaser_invoices.filter((r) => r.is_demo).length,
        customers_removed: state.chaser_customers.filter((r) => r.is_demo).length,
      };
      for (const t of ["chaser_nudges", "chaser_promises"]) state[t] = state[t].filter((r) => !r.is_demo);
      const invIds = state.chaser_invoices.filter((r) => r.is_demo).map((r) => r.id);
      cascadeDelete(state, "chaser_invoices", invIds);
      state.chaser_invoices = state.chaser_invoices.filter((r) => !r.is_demo);
      // A demo customer the owner has since given a real invoice is kept, un-marked.
      let kept = 0;
      for (const c of state.chaser_customers) {
        if (c.is_demo && state.chaser_invoices.some((i) => i.customer_id === c.id)) { c.is_demo = false; kept++; }
      }
      counts.customers_removed = state.chaser_customers.filter((r) => r.is_demo).length;
      const custIds = state.chaser_customers.filter((r) => r.is_demo).map((r) => r.id);
      cascadeDelete(state, "chaser_customers", custIds);
      state.chaser_customers = state.chaser_customers.filter((r) => !r.is_demo);
      save(state);
      return { data: { ...counts, customers_kept: kept }, error: null };
    }
    return err("PGRST202", `Could not find the function public.${fn} in the schema cache`);
  } catch (e) {
    return { data: null, error: { code: "P0001", message: e.message } };
  }
}

// ---- client --------------------------------------------------------------------
export function createMockClient() {
  const authListeners = new Set();
  const session = () => {
    const raw = ls.get(SESSION_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  };
  const notify = (event) => { for (const l of authListeners) l(event, session()); };
  const client = {
    session,
    auth: {
      async getSession() { return { data: { session: session() }, error: null }; },
      async getUser() { const s = session(); return { data: { user: s?.user ?? null }, error: null }; },
      onAuthStateChange(cb) {
        authListeners.add(cb);
        return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
      },
      async signInWithPassword({ email, password }) {
        await new Promise((r) => setTimeout(r, 300));
        if (ls.get("dropstack-mock-fail") === "all") {
          return { data: null, error: { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 } };
        }
        if (!email || password === "wrong") {
          return { data: null, error: { code: "invalid_credentials", message: "Invalid login credentials", status: 400 } };
        }
        const s = { access_token: "mock", user: { id: MOCK_OWNER_ID, email } };
        ls.set(SESSION_KEY, JSON.stringify(s));
        notify("SIGNED_IN");
        return { data: { session: s }, error: null };
      },
      async signOut() { ls.del(SESSION_KEY); notify("SIGNED_OUT"); return { error: null }; },
    },
    from: (table) => new Query(client, table),
    rpc: (fn, args) => rpc(client, fn, args),
  };
  return client;
}
