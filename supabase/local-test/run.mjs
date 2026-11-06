// Local SQL harness: schema.sql, the 2026-11-05 patch and the verify scripts
// on a throwaway in-memory Postgres (PGlite/WASM). Nothing here can reach a
// real database. PGlite is borrowed from another local project; it is not a
// dependency of this app.
//   node supabase/local-test/run.mjs <repo> <schema-main.sql> <verify-rls-main.sql>
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(process.env.PGLITE_FROM ?? `${process.env.HOME}/dropstack-outreachv2/package.json`);
const { PGlite } = await import(require.resolve("@electric-sql/pglite"));
const [REPO, MAIN_SCHEMA, MAIN_VERIFY] = process.argv.slice(2);
const here = new URL(".", import.meta.url).pathname;
const read = (p) => readFileSync(p, "utf8");
let failures = 0;
const summary = [];

async function fresh() { const db = new PGlite(); await db.exec(read(here + "stubs.sql")); return db; }
async function verify(db, file, label) {
  const out = await db.exec(read(file));
  const rows = out.at(-1).rows;
  const bad = rows.filter((r) => !String(r.result).startsWith("PASS"));
  failures += bad.length;
  summary.push(`${label}: ${rows.length - bad.length}/${rows.length} PASS`);
  console.log(`\n== ${label}: ${rows.length - bad.length}/${rows.length} PASS`);
  for (const r of rows) {
    const name = r.test ?? [r.role, r.table, r.operation].join(" / ");
    console.log(`  ${String(r.result).startsWith("PASS") ? "ok  " : "FAIL"} ${name} -> ${r.detail ?? r.outcome ?? ""}`);
  }
}
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label} ${detail}`); if (!ok) failures++; };

// A. Fresh project from the folded schema.sql, then re-pasted
{
  const db = await fresh();
  await db.exec(read(REPO + "/supabase/schema.sql"));
  await verify(db, REPO + "/supabase/verify-rls.sql", "A. fresh schema.sql / verify-rls.sql");
  await verify(db, REPO + "/supabase/verify-compete-upgrades.sql", "A. fresh schema.sql / verify-compete-upgrades.sql");
  await db.exec(read(REPO + "/supabase/schema.sql"));
  await verify(db, REPO + "/supabase/verify-rls.sql", "A2. schema.sql re-pasted / verify-rls.sql");
  await verify(db, REPO + "/supabase/verify-compete-upgrades.sql", "A2. schema.sql re-pasted / verify-compete-upgrades.sql");
  const left = (await db.query("select (select count(*) from chaser_customers) + (select count(*) from chaser_invoices) as n")).rows[0].n;
  check("verify scripts leave no rows behind", Number(left) === 0, `(${left} rows)`);
}

// B. Upgrade path: the live (v1) schema with existing rows, then the patch twice
{
  const db = await fresh();
  await db.exec(read(MAIN_SCHEMA));
  await verify(db, MAIN_VERIFY, "B0. v1 schema (as live today) / v1 verify-rls.sql");
  const c = (await db.query(`insert into chaser_customers (name, phone) values ('Legacy Customer', '+27000000003') returning id`)).rows[0].id;
  await db.query(`insert into chaser_invoices (customer_id, reference, amount_cents, amount_paid_cents, issued_on, due_on) values
    ($1, 'L-1', 150000, 0, '2026-09-01', '2026-09-30'), ($1, 'L-2', 99999, 99999, '2026-09-01', '2026-09-30'),
    ($1, 'L-3', 50000, 10000, '2026-10-01', '2026-10-31')`, [c]);
  await db.query(`insert into chaser_nudges (invoice_id, channel, tone) select id, 'whatsapp', 'gentle' from chaser_invoices where reference = 'L-1'`);
  const before = (await db.query(`select reference, amount_cents::text, amount_paid_cents::text, status from chaser_invoices order by reference`)).rows;

  const patch = read(REPO + "/supabase/patches/2026-11-05-compete-upgrades.sql");
  await db.exec(patch);
  await db.exec(patch); // idempotent
  await verify(db, REPO + "/supabase/verify-rls.sql", "B1. v1 + patch x2 / verify-rls.sql");
  await verify(db, REPO + "/supabase/verify-compete-upgrades.sql", "B1. v1 + patch x2 / verify-compete-upgrades.sql");

  console.log("\n== B2. existing rows after the patch");
  const after = (await db.query(`select reference, amount_cents::text, amount_paid_cents::text, status, is_demo, source_quote_id, paid_at from chaser_invoices order by reference`)).rows;
  check("every pre-patch amount and status unchanged", JSON.stringify(before) === JSON.stringify(after.map(({ reference, amount_cents, amount_paid_cents, status }) => ({ reference, amount_cents, amount_paid_cents, status }))));
  check("existing rows are not demo and have no quote link", after.every((r) => r.is_demo === false && r.source_quote_id === null));
  check("existing paid invoice: paid_at not invented (null until the next payment write)", after.find((r) => r.reference === "L-2").paid_at === null);
  const nudge = (await db.query(`select is_demo, stage from chaser_nudges`)).rows[0];
  check("existing nudge kept, not demo, no stage", nudge.is_demo === false && nudge.stage === null);
  await db.query(`update chaser_invoices set amount_paid_cents = 50000 where reference = 'L-3'`);
  const l3 = (await db.query(`select status, paid_at from chaser_invoices where reference = 'L-3'`)).rows[0];
  check("an existing partial invoice paid after the patch gets status paid + paid_at", l3.status === "paid" && l3.paid_at !== null);
  const total = (await db.query(`select sum(greatest(amount_cents - amount_paid_cents, 0))::text as t from chaser_invoices where status in ('unpaid','partial')`)).rows[0].t;
  check("outstanding total still exact integer cents", total === "150000", `(${total})`);
}

console.log("\n" + summary.join("\n"));
console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures ? 1 : 0);
