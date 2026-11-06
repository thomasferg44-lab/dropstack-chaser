// Demo mode: a believable set of books for a South African trade business,
// so a prospect sees the tool working in one tap. Dates are relative to today,
// so the demo is always fresh: something is always due today, one promise is
// always broken, every ladder stage is represented.
//
// Honesty rules (Nov 5 directive):
//   - every row is marked is_demo by the database itself (chaser_load_demo
//     forces it), every reference starts DEMO-, and the app shows a DEMO
//     badge while any demo row exists
//   - phone numbers use the safe placeholder pattern +27 00 000 00xx and
//     emails use example.com, so nothing can ever reach a real person
//   - these are invoices OWED, not results: nothing here claims money was
//     recovered for anyone
import { addDays } from "./dates.js";

export const DEMO_INDUSTRIES = {
  plumber: {
    label: "Plumber",
    prefix: "PLB",
    customers: [
      "Thandi Mokoena", "Pieter van der Merwe", "Ayesha Patel", "Sipho Dlamini", "Karen Botha",
      "Lerato Nkosi", "Johan Pretorius", "Nomvula Khumalo", "Riaan Steyn", "Fatima Adams", "Bongani Zulu", "Elmarie Venter",
    ],
    jobs: [
      ["Geyser service and anode replacement", 165000], ["Burst pipe call-out, after hours", 145000],
      ["Blocked drain, high-pressure jetting", 95000], ["150L geyser replacement", 985000],
      ["Leak detection and repair", 230000], ["Toilet cistern replacement", 118000],
      ["Pressure valve and drip tray", 286000], ["Bathroom refit, labour and fittings", 3840000],
      ["Kitchen mixer and waste install", 127550], ["Geyser blanket and pipe lagging", 89000],
      ["Solar geyser conversion", 2450000], ["Water tank and pump install", 1675000],
    ],
  },
  landscaper: {
    label: "Landscaper",
    prefix: "LND",
    customers: [
      "Michelle Jacobs", "Andile Mthembu", "Charlene Smit", "Kagiso Molefe", "Hennie du Plessis",
      "Priya Naidoo", "Gerrit Joubert", "Zanele Ndlovu", "Wayne Carelse", "Busisiwe Sithole", "Annelie Kruger", "Tshepo Maseko",
    ],
    jobs: [
      ["October garden service", 180000], ["Hedge trimming and removal", 120000],
      ["Garden clean-up and green waste", 245000], ["Irrigation system install", 1420000],
      ["Instant lawn, 120 m²", 875000], ["Tree felling and stump grinding", 650000],
      ["Borehole pump service", 310000], ["Paving, 45 m² driveway", 2230000],
      ["Water-wise bed planting", 386050], ["Retaining wall, sleepers", 940000],
      ["Complex common-area landscaping", 2875000], ["Mulching and compost top-up", 96000],
    ],
  },
  electrician: {
    label: "Electrician",
    prefix: "ELC",
    customers: [
      "Nadia Hendricks", "Lwazi Mahlangu", "Corne Visser", "Mpho Radebe", "Shirley Daniels",
      "Thabo Sibiya", "Marelize Coetzee", "Yusuf Ebrahim", "Dineo Mabena", "Jacques le Roux", "Palesa Mofokeng", "Grant Fourie",
    ],
    jobs: [
      ["Certificate of compliance inspection", 220000], ["Fault finding, tripping circuit", 98000],
      ["Geyser timer install", 165000], ["DB board upgrade", 785000],
      ["Prepaid meter install", 345000], ["Outdoor and security lighting", 560000],
      ["Backup power install for load-shedding", 1890000], ["Solar inverter and battery install", 4850000],
      ["Plug and light points, kitchen", 412500], ["Earth leakage replacement", 135000],
      ["Gate motor wiring and surge protection", 287000], ["Stove isolator and circuit", 156000],
    ],
  },
};

export const DEMO_REF_PREFIX = "DEMO-";

// The scenarios every dataset covers. Offsets are days relative to today
// (negative = in the past). Nudges: [stageKey, daysAgo, channel].
const SCENARIOS = [
  { name: "current", due: 12, issued: -2 },
  { name: "due-soon", due: 2, issued: -12 },
  { name: "falls-due-today", due: 0, issued: -14 },
  { name: "friendly-due", due: -3, issued: -17 },
  { name: "firm-due", due: -9, issued: -23, nudges: [["friendly", 8, "whatsapp"]] },
  { name: "final-due", due: -16, issued: -30, nudges: [["friendly", 15, "whatsapp"], ["firm", 9, "whatsapp"]] },
  { name: "broken-promise", due: -24, issued: -38, nudges: [["friendly", 23, "whatsapp"], ["firm", 17, "email"]],
    promise: { promisedIn: -2, loggedAgo: 12, note: "Said they'd pay after payday on the 25th" } },
  { name: "promise-pending", due: -11, issued: -25, nudges: [["friendly", 10, "whatsapp"]],
    promise: { promisedIn: 3, loggedAgo: 2, note: "Paying on Friday" } },
  { name: "part-paid-ladder-done", due: -38, issued: -52, paidPct: 40,
    nudges: [["friendly", 37, "whatsapp"], ["firm", 31, "whatsapp"], ["final", 24, "email"]] },
  { name: "61-90", due: -72, issued: -86, nudges: [["friendly", 71, "whatsapp"], ["firm", 64, "whatsapp"]] },
  { name: "90-plus", due: -104, issued: -134, nudges: [["friendly", 103, "whatsapp"], ["firm", 96, "email"], ["final", 89, "email"]] },
  { name: "paid", due: -20, issued: -34, paidPct: 100, paidAgo: 6, nudges: [["friendly", 19, "whatsapp"]],
    promise: { promisedIn: -5, loggedAgo: 15, note: "Will pay end of the week" } },
];

const TONE = { friendly: "gentle", firm: "firm", final: "final" };

/** A local 09:30 timestamp `daysAgo` days before `today`, as ISO. */
function at(today, daysAgo, hour = 9, minute = 30) {
  const [y, m, d] = addDays(today, -daysAgo).split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute).toISOString();
}

const slug = (name) => name.toLowerCase().normalize("NFD").replace(/[^a-z ]/g, "").trim().replace(/\s+/g, ".");

/**
 * The payload for chaser_load_demo. Shape documented on that function in
 * supabase/schema.sql. Integer cents throughout.
 */
export function buildDemoPayload(industryKey, today) {
  const ind = DEMO_INDUSTRIES[industryKey];
  if (!ind) throw new Error(`Unknown demo industry "${industryKey}"`);
  const customers = ind.customers.slice(0, SCENARIOS.length).map((name, i) => ({
    key: `c${i}`,
    name,
    // Placeholder pattern: +27 00 000 00xx. Never a real subscriber number.
    phone: i === 4 ? null : `+27 00 000 00${String(i + 1).padStart(2, "0")}`,
    // Most tradespeople's customers are WhatsApp-only; some have email too.
    email: i % 3 === 0 || i === 4 ? `${slug(name)}@example.com` : null,
    is_demo: true,
  }));
  const invoices = [];
  const nudges = [];
  const promises = [];
  const paidAt = {};
  SCENARIOS.forEach((s, i) => {
    const [description, amount] = ind.jobs[i];
    const key = `i${i}`;
    // Part-payments are whole rand: integer cents in, integer cents out
    // (amount * pct is an integer; truncating to whole rand is exact here).
    const paid = s.paidPct === 100 ? amount : s.paidPct ? Math.trunc((amount * s.paidPct) / 10000) * 100 : 0;
    invoices.push({
      key,
      customer_key: `c${i}`,
      reference: `${DEMO_REF_PREFIX}${ind.prefix}-${1040 + i}`,
      description,
      amount_cents: amount,
      amount_paid_cents: paid,
      currency: "ZAR",
      issued_on: addDays(today, s.issued),
      due_on: addDays(today, s.due),
      notes: "Demo data",
      is_demo: true,
    });
    for (const [stage, ago, channel] of s.nudges ?? []) {
      nudges.push({ invoice_key: key, stage, tone: TONE[stage], channel, sent_at: at(today, ago) });
    }
    if (s.promise) {
      promises.push({ invoice_key: key, promised_on: addDays(today, s.promise.promisedIn), note: s.promise.note, created_at: at(today, s.promise.loggedAgo, 14, 10) });
    }
    if (s.paidAgo != null) paidAt[key] = at(today, s.paidAgo, 11, 5);
  });
  return { customers, invoices, nudges, promises, paid_at: paidAt };
}

/** Any demo row present? Drives the DEMO badge. */
export function hasDemo(invoices) {
  return (invoices || []).some((i) => i.is_demo === true || String(i.reference ?? "").startsWith(DEMO_REF_PREFIX));
}

/** Which industry's demo is loaded (from the reference prefix), or null. */
export function demoIndustryOf(invoices) {
  for (const i of invoices || []) {
    const m = /^DEMO-([A-Z]{3})-/.exec(i.reference ?? "");
    if (m) {
      const found = Object.entries(DEMO_INDUSTRIES).find(([, v]) => v.prefix === m[1]);
      if (found) return found[0];
    }
  }
  return null;
}

/** Scenario names, for tests and the report. */
export const DEMO_SCENARIOS = SCENARIOS.map((s) => s.name);
