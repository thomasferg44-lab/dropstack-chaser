// Device-side resilience for a cheap phone on flaky data:
//   - the last good invoice list, so the queue renders instantly and still
//     renders offline ("cached state")
//   - composer drafts, so a typed or edited message survives a dropped
//     connection, a reload or a closed tab
//   - an outbox for nudge/promise records that couldn't reach the database
//     (e.g. WhatsApp opened, then the signal dropped): retried later, never lost
// Everything here is per device and per signed-in login, and is wiped on
// sign-out (POPIA: no customer data lingers on a shared phone).
const PREFIX = "chaser:";
const store = {
  get(k) { try { return localStorage.getItem(PREFIX + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(PREFIX + k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(PREFIX + k); } catch { /* ignore */ } },
  keys() { try { return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length)); } catch { return []; } },
};
const readJson = (k, fallback) => { try { const v = store.get(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };

// ---- invoice snapshot ----------------------------------------------------------
export function saveSnapshot(userId, invoices, at = new Date().toISOString(), schema = null) {
  return store.set(`snap:${userId}`, JSON.stringify({ at, invoices, schema }));
}
export function loadSnapshot(userId) { return readJson(`snap:${userId}`, null); }

// ---- composer drafts -------------------------------------------------------------
const draftKey = (userId, invoiceId, channel, stage) => `draft:${userId}:${invoiceId}:${channel}:${stage}`;
export function saveDraft(userId, invoiceId, channel, stage, draft) {
  return store.set(draftKey(userId, invoiceId, channel, stage), JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
}
export function loadDraft(userId, invoiceId, channel, stage) { return readJson(draftKey(userId, invoiceId, channel, stage), null); }
export function clearDrafts(userId, invoiceId) {
  for (const k of store.keys()) if (k.startsWith(`draft:${userId}:${invoiceId}:`)) store.del(k);
}

// ---- outbox ----------------------------------------------------------------------
export function outbox(userId) { return readJson(`outbox:${userId}`, []); }
export function enqueue(userId, item) {
  const list = outbox(userId);
  list.push({ ...item, id: item.id ?? `ob-${Date.now()}-${list.length}`, queuedAt: new Date().toISOString() });
  store.set(`outbox:${userId}`, JSON.stringify(list));
  return list;
}
/** Try each queued write; keep the ones that still fail. Returns { sent, left }. */
export async function flushOutbox(userId, send) {
  const list = outbox(userId);
  const left = [];
  let sent = 0;
  for (const item of list) {
    try { await send(item); sent++; } catch { left.push(item); }
  }
  store.set(`outbox:${userId}`, JSON.stringify(left));
  return { sent, left: left.length };
}

/**
 * Sign-out: remove every cached customer detail, draft and queued write.
 * Small preferences (checklist dismissed, details confirmed) hold no customer
 * data and are kept, so the next sign-in doesn't nag again.
 */
export function wipeDevice() { for (const k of store.keys()) if (!k.startsWith("pref:")) store.del(k); }

// ---- small per-device preferences (onboarding) --------------------------------
export const prefs = {
  get: (k) => readJson(`pref:${k}`, null),
  set: (k, v) => store.set(`pref:${k}`, JSON.stringify(v)),
};
