import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Actual PostgreSQL engine, isolated synthetic data, no external database access.
const db = new PGlite();
const baseline = await readFile(new URL("../supabase/migrations/20260814000000_production_baseline.sql", import.meta.url), "utf8");
const creditSource = await readFile(new URL("026-usage-credits.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261027062352_partner_test_accruals.sql", import.meta.url), "utf8");
const tables = ["experts", "usage_wallets", "usage_ledger", "patient_assignments", "sessions", "body_clients"];
for (const table of tables) {
  const ddl = baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
  assert(ddl, `baseline table ${table} exists`);
  await db.exec(ddl + ` ALTER TABLE public.${table} ADD PRIMARY KEY(id);`);
}
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  ALTER TABLE experts ADD allowed_modules text[] DEFAULT ARRAY['support','body'];
  ALTER TABLE usage_ledger ADD UNIQUE(request_id);
  GRANT USAGE ON SCHEMA public TO service_role;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
  GRANT UPDATE ON usage_wallets, patient_assignments TO service_role;
  GRANT INSERT ON usage_ledger TO service_role;
`);
await db.exec(creditSource.match(/create or replace function consume_usage_credits\([\s\S]*?\$\$;/i)[0]);
await db.exec(migration);
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await query(sql, params))[0];
const id = async () => (await one("select gen_random_uuid() as id")).id;
const doctor = await id(), otherDoctor = await id(), org = await id();
await db.query("insert into experts(id,name,is_active,access_code) values($1,'Synthetic A',true,'SYNTHETIC-A'),($2,'Synthetic B',true,'SYNTHETIC-B')", [doctor, otherDoctor]);

async function patient({ module = "support", pilot = "main", organization = null, legacy = false, expert = doctor, assigned = true } = {}) {
  const owner = await id(), wallet = await id(), assignment = await id();
  const session = `synthetic-${owner}`, code = `test-${owner}`;
  const ownerType = module === "support" ? "anonymous_case" : "anonymous_profile";
  await db.query("insert into usage_wallets(id,owner_id,owner_type,module) values($1,$2,$3,$4)", [wallet, owner, ownerType, module]);
  if (module === "support") await db.query("insert into sessions(session_id,public_code,anonymous_owner_id,module,organization_id,json_data) values($1,$2,$3,$4,$5,$6)", [session, code, owner, module, organization, JSON.stringify(pilot === "main" ? {} : { pilot_id: pilot })]);
  else await db.query("insert into body_clients(session_id,anonymous_owner_id) values($1,$2)", [session, owner]);
  if (assigned) await db.query("insert into patient_assignments(id,owner_id,owner_type,public_code,module,organization_id,primary_expert_id,status) values($1,$2,$3,$4,$5,$6,$7,'active')", [assignment, legacy ? null : owner, legacy ? null : ownerType, legacy ? code : null, module, organization, expert]);
  return { owner, wallet, assignment, session, module, pilot, organization };
}
let serial = 0;
async function spend(p, amount, { request = `debit-${++serial}`, resource = p.module === "body" ? "plate_analysis" : "support_analyze", session = p.session, pilot = p.pilot } = {}) {
  return (await one("select consume_usage_credits(p_wallet_id=>$1,p_amount=>$2,p_request_id=>$3,p_resource_type=>$4,p_module=>$5,p_session_id=>$6,p_metadata=>$7) as result",
    [p.wallet, amount, request, resource, p.module, session, JSON.stringify(pilot === "main" ? {} : { pilot_id: pilot })])).result;
}
const earnings = async p => Number((await one("select coalesce(sum(earned_credits),0) as earned from partner_test_accounts where wallet_id=$1", [p.wallet])).earned);
const debitId = async request => (await one("select id from usage_ledger where request_id=$1", [request])).id;
const refund = async (source, amount, request) => (await one("select refund_partner_test_usage($1,$2,$3) as result", [source, amount, request])).result;

try {
  const p = await patient();
  await db.exec("set role service_role");
  await spend(p, 22000, { request: "full" });
  assert.equal(await earnings(p), 5500);
  await spend(p, 22000, { request: "full" });
  assert.equal(await earnings(p), 5500, "replay does not duplicate commission");
  assert.equal(Number((await one("select count(*) as n from partner_test_entries")).n), 1);
  await db.exec("reset role");

  const small = await patient({ module: "body", organization: org });
  // Serialized by PostgreSQL wallet locks; PGlite executes one connection.
  await Promise.all(Array.from({ length: 12 }, () => spend(small, 1)));
  assert.equal(await earnings(small), 3, "small debit fractions accumulate");
  const legacy = await patient({ legacy: true, organization: org, pilot: "anmed" });
  await spend(legacy, 1000);
  assert.equal(await earnings(legacy), 250, "legacy public_code assignments supported");

  const noLink = await patient({ assigned: false });
  await spend(noLink, 100);
  assert.equal(await earnings(noLink), 0);
  const scoped = await patient({ organization: org, pilot: "pneumointegration" });
  await spend(scoped, 100, { pilot: "anmed" });
  await spend(scoped, 100, { session: p.session });
  await spend(scoped, 100, { resource: "specialist_consultation" });
  assert.equal(await earnings(scoped), 0, "foreign session/pilot and consultations excluded");
  await spend(scoped, 100);
  assert.equal(await earnings(scoped), 25);
  for (const kind of ["bonus", "paid"]) {
    await db.query("update usage_wallets set partner_funding_kind=$1 where id=$2", [kind, scoped.wallet]);
    await spend(scoped, 100);
    assert.equal(await earnings(scoped), 25, "non-test funds never become test commission");
  }

  const changed = await patient();
  await spend(changed, 1000, { request: "old-doctor" });
  await db.query("update patient_assignments set primary_expert_id=$1 where id=$2", [otherDoctor, changed.assignment]);
  await spend(changed, 500, { request: "new-doctor" });
  const original = await debitId("old-doctor");
  await refund(original, 400, "partial-refund");
  assert.equal((await refund(original, 400, "partial-refund")).idempotent_replay, true);
  await assert.rejects(refund(original, 401, "partial-refund"), /idempotency conflict/);
  const balanceBefore = await one("select balance from usage_wallets where id=$1", [changed.wallet]);
  await assert.rejects(refund(original, 601, "over-refund"), /exceeds/);
  assert.deepEqual(await one("select balance from usage_wallets where id=$1", [changed.wallet]), balanceBefore, "failed refund rolls back wallet");
  await refund(original, 600, "rest-refund");
  const balances = await query("select expert_id,earned_credits from partner_test_accounts where wallet_id=$1", [changed.wallet]);
  assert.equal(Number(balances.find(a => a.expert_id === doctor).earned_credits), 0);
  assert.equal(Number(balances.find(a => a.expert_id === otherDoctor).earned_credits), 125, "refund stays with original expert");

  const rejected = await patient();
  await db.query("update usage_wallets set refill_mode='disabled' where id=$1", [rejected.wallet]);
  await assert.rejects(spend(rejected, 22001), /Insufficient/);
  assert.equal(await earnings(rejected), 0);
  assert.equal(Number((await one("select balance from usage_wallets where id=$1", [rejected.wallet])).balance), 22000);
  await db.exec("begin");
  await spend(rejected, 1000);
  await db.exec("rollback");
  assert.equal(await earnings(rejected), 0, "rollback removes both debit and accrual");

  const summary = async (expert, module, organization, pilot) => (await one("select partner_test_summary($1,$2,$3,$4) as s", [expert, module, organization, pilot])).s;
  assert.equal((await summary(doctor, "support", org, "pneumointegration")).earned_credits, 25);
  assert.equal((await summary(otherDoctor, "support", org, "pneumointegration")).earned_credits, 0);
  assert.equal((await summary(doctor, "body", org, "pneumointegration")).earned_credits, 0);
  assert.equal((await summary(doctor, "support", null, "pneumointegration")).earned_credits, 0);
  assert.equal((await summary(doctor, "body", org, "main")).earned_credits, 3);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(query("select * from partner_test_entries"), /permission denied/);
    await assert.rejects(summary(doctor, "support", null, "main"), /permission denied/);
    await assert.rejects(refund(original, 1, "forbidden"), /permission denied/);
    await db.exec("reset role");
  }
  console.log("Partner PostgreSQL tests passed: accrual, replays, fractions, refunds, rollback, assignments, scope and permissions.");
} finally {
  await db.close();
}
