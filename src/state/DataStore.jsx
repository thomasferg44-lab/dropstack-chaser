import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as db from "../lib/db.js";
import { saveSnapshot, loadSnapshot, enqueue, flushOutbox, outbox } from "../lib/cache.js";

// One live copy of the books for every screen. Renders instantly from the
// last good snapshot on this device, then refreshes in place (no full-page
// reloads, no spinner page). If the network drops, the cached books stay on
// screen with an "offline" line, and nudge/promise records go to an outbox
// that is replayed when the connection is back. Nothing composed or sent is
// ever lost to a dropped signal.
const Ctx = createContext(null);
export const useData = () => useContext(Ctx);

const isNetworkError = (e) => e?.name === "TypeError" || /failed to fetch|network|load failed|fetch/i.test(String(e?.message ?? ""));

export function DataProvider({ user, children }) {
  const uid = user.id;
  const snap = useRef(loadSnapshot(uid));
  const [invoices, setInvoices] = useState(snap.current?.invoices ?? null);
  const [customers, setCustomers] = useState([]);
  const [schema, setSchema] = useState(db.getSchemaLevel());
  const [status, setStatus] = useState(snap.current ? "cached" : "loading");
  const [offline, setOffline] = useState(false);
  const [lastSync, setLastSync] = useState(snap.current?.at ?? null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(outbox(uid).length);
  const pendingRef = useRef(false); // a replay happened: refetch so the list includes it

  const replay = useCallback(async () => {
    if (!outbox(uid).length) return;
    const r = await flushOutbox(uid, async (item) => {
      try {
        if (item.kind === "nudge") await db.recordNudge(item.payload);
        else if (item.kind === "promise") await db.logPromise(item.payload);
      } catch (e) {
        if (isNetworkError(e)) throw e; // keep it queued
        // a non-network failure (e.g. invoice deleted) can never succeed: drop it
      }
    });
    setPending(r.left);
    if (r.sent) pendingRef.current = true;
  }, [uid]);

  const refresh = useCallback(async () => {
    try {
      // One round trip, not two: with a schema level remembered on this
      // device, the probe runs alongside the data fetch (refetched only if
      // the database was upgraded in between).
      // First visit assumes the patched schema; an unpatched database costs
      // one extra fetch, never a wrong answer.
      const hint = !db.getSchemaLevel() ? (snap.current?.schema ?? "v2") : null;
      if (hint) db.assumeSchema(hint);
      let [level, inv, cust] = await Promise.all([hint ? db.probeSchema() : db.detectSchema(), db.listInvoices().catch((e) => e), db.listCustomers()]);
      if (inv instanceof Error) {
        if (!hint || level === hint) throw inv;
        inv = await db.listInvoices();
      } else if (hint && level !== hint) inv = await db.listInvoices();
      setSchema(level);
      await replay();
      if (outbox(uid).length === 0 && pendingRef.current) { inv = await db.listInvoices(); pendingRef.current = false; }
      setInvoices(inv);
      setCustomers(cust);
      setStatus("ready");
      setOffline(false);
      setError(null);
      const at = new Date().toISOString();
      setLastSync(at);
      saveSnapshot(uid, inv, at, level);
    } catch (e) {
      if (isNetworkError(e)) {
        setOffline(true);
        setStatus((s) => (s === "loading" && !snap.current ? "error" : s === "loading" ? "cached" : s));
      } else {
        setStatus((s) => (s === "loading" ? "error" : s));
      }
      setError(e.message);
    }
  }, [uid, replay]);

  useEffect(() => { refresh(); }, [refresh]);
  // Keep the device snapshot in step with every local change (a nudge or
  // promise logged offline must still be there after a reload).
  useEffect(() => { if (invoices && status === "ready") saveSnapshot(uid, invoices, lastSync ?? new Date().toISOString(), schema); }, [invoices, status, uid, lastSync, schema]);
  useEffect(() => {
    const back = () => refresh();
    const vis = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("online", back);
    document.addEventListener("visibilitychange", vis);
    return () => { window.removeEventListener("online", back); document.removeEventListener("visibilitychange", vis); };
  }, [refresh]);

  const patchInvoice = (id, fn) => setInvoices((list) => (list ?? []).map((i) => (i.id === id ? fn(i) : i)));

  /** Record a sent nudge. Optimistic; queued if the network is down. */
  const recordNudge = useCallback(async ({ invoice, channel, tone, stage }) => {
    const sentAt = new Date().toISOString();
    const local = { id: `local-${Date.now()}`, channel, tone, stage, sent_at: sentAt, is_demo: invoice.is_demo };
    patchInvoice(invoice.id, (i) => ({ ...i, nudges: [...(i.nudges ?? []), local] }));
    const payload = { invoiceId: invoice.id, channel, tone, stage, sentAt };
    try {
      await db.recordNudge(payload);
      return { queued: false };
    } catch (e) {
      if (!isNetworkError(e)) { patchInvoice(invoice.id, (i) => ({ ...i, nudges: i.nudges.filter((n) => n !== local) })); throw e; }
      setPending(enqueue(uid, { kind: "nudge", payload }).length);
      setOffline(true);
      return { queued: true };
    }
  }, [uid]);

  const logPromise = useCallback(async ({ invoice, promisedOn, note }) => {
    const createdAt = new Date().toISOString();
    const local = { id: `local-${Date.now()}`, promised_on: promisedOn, note, created_at: createdAt, created_by: user.email };
    const payload = { invoiceId: invoice.id, promisedOn, note, createdBy: user.email, createdAt };
    try {
      await db.logPromise(payload);
      patchInvoice(invoice.id, (i) => ({ ...i, promises: [...(i.promises ?? []), local] }));
      return { queued: false };
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      patchInvoice(invoice.id, (i) => ({ ...i, promises: [...(i.promises ?? []), local] }));
      setPending(enqueue(uid, { kind: "promise", payload }).length);
      setOffline(true);
      return { queued: true };
    }
  }, [uid, user.email]);

  /** Payments are never queued: a balance must come from the database. */
  const recordPayment = useCallback(async (p) => {
    const row = await db.recordPayment({ ...p, paidBy: user.email });
    patchInvoice(row.id, (i) => ({ ...i, ...row }));
    return row;
  }, [user.email]);

  const run = useCallback(async (fn) => { const out = await fn(); await refresh(); return out; }, [refresh]);

  const value = useMemo(() => ({
    user, invoices, customers, schema, status, offline, lastSync, error, pending,
    refresh, recordNudge, logPromise, recordPayment,
    saveInvoice: (inv) => run(() => db.saveInvoice(inv)),
    deleteInvoice: (id) => run(() => db.deleteInvoice(id)),
    saveCustomer: (c) => run(() => db.saveCustomer(c)),
    deleteCustomer: (id) => run(() => db.deleteCustomer(id)),
    importInvoices: (p) => run(() => db.importInvoices(p)),
    importFromQuotes: (p) => run(() => db.importFromQuotes(p)),
    loadDemo: (p) => run(() => db.loadDemo(p)),
    removeDemo: () => run(() => db.removeDemo()),
  }), [user, invoices, customers, schema, status, offline, lastSync, error, pending, refresh, recordNudge, logPromise, recordPayment, run]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
