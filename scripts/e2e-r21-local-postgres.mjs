// R2.1: real local PostgreSQL rehearsal. This file refuses every non-local DB
// and rolls back every synthetic row before checking that cleanup is complete.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

const connectionString = process.env.R21_LOCAL_DB_URL || "";
const endpoint = new URL(connectionString);
assert(["127.0.0.1", "localhost"].includes(endpoint.hostname), "R2.1 requires a localhost PostgreSQL URL");
assert.equal(endpoint.port, "54322", "R2.1 requires the configured local Supabase PostgreSQL port");

const { Client } = pg;
const db = new Client({ connectionString });
const id = () => crypto.randomUUID();
const localDay = new Date(Date.now() + 8 * 86400000);
localDay.setUTCHours(10, 0, 0, 0);
const startsAt = localDay.toISOString();
const weekday = ((localDay.getUTCDay() + 6) % 7) + 1;
const fixture = {
  organization: id(), expert: id(), place: id(), service: id(), owner: id(), wallet: id(),
  bookingKey: `r21-credit-${Date.now().toString(36)}`, encounter: id(), medicalOwner: id(),
};

async function asService(text, values = []) {
  await db.query("savepoint r21_service");
  await db.query("set local role service_role");
  try {
    const result = await db.query(text, values);
    await db.query("reset role");
    await db.query("release savepoint r21_service");
    return result;
  } catch (error) {
    await db.query("rollback to savepoint r21_service");
    throw error;
  }
}

async function expectDenied(role, text, values = []) {
  await db.query("savepoint r21_denied");
  await db.query(`set local role ${role}`);
  let failure;
  try {
    await db.query(text, values);
  } catch (error) {
    failure = error;
  }
  await db.query("rollback to savepoint r21_denied");
  assert.equal(failure?.code, "42501", `${role} must be denied: ${text}`);
}

try {
  await db.connect();
  await db.query("begin");

  await db.query("insert into public.organizations(id,name,slug) values($1,$2,$3)", [
    fixture.organization, "R21 Synthetic Organization", `r21-${fixture.organization.slice(0, 8)}`,
  ]);
  await db.query("insert into public.experts(id,name,role,specialty,city,access_code,is_active,allowed_modules) values($1,$2,'doctor','Synthetic','TEST',$3,true,array['support','body'])", [
    fixture.expert, "R21 Synthetic Specialist", `R21-${fixture.expert.slice(0, 8)}`,
  ]);
  await db.query("insert into public.expert_organization_memberships(organization_id,expert_id,role,status) values($1,$2,'doctor','active')", [fixture.organization, fixture.expert]);
  await db.query("insert into public.practice_places(id,expert_id,name,address) values($1,$2,'R21 Synthetic Place','TEST')", [fixture.place, fixture.expert]);
  await db.query("insert into public.practice_services(id,expert_id,organization_id,place_id,name,format,price_kop,duration_min,is_active,modules) values($1,$2,$3,$4,'R21 Credit Visit','offline',200000,60,true,array['body'])", [fixture.service, fixture.expert, fixture.organization, fixture.place]);
  await db.query("insert into public.practice_availability(expert_id,organization_id,weekday,start_time,end_time,is_active) values($1,$2,$3,'09:00','18:00',true)", [fixture.expert, fixture.organization, weekday]);
  await db.query("insert into public.usage_wallets(id,owner_type,owner_id,module,balance,total_used,refill_mode,status) values($1,'anonymous_profile',$2,'body',20000,0,'on_zero','active')", [fixture.wallet, fixture.owner]);

  const reservation = (await asService(
    "select public.reserve_practice_booking_with_credits($1,$2,$3,$4,'anonymous_profile',$5,'r21-local',$6,null,$7,20000,'12h-20-v1') as result",
    [fixture.expert, fixture.organization, fixture.place, fixture.service, fixture.owner, startsAt, fixture.bookingKey],
  )).rows[0].result;
  assert.equal(reservation.status, "confirmed");
  const bookingId = reservation.booking_id || reservation.id;
  assert(bookingId, "credit reservation returns a booking id");

  const credit = (await asService("select charged_credits, price_kop from public.practice_booking_credits where booking_id=$1", [bookingId])).rows[0];
  assert.deepEqual(credit, { charged_credits: "20000", price_kop: "200000" });
  const balanceAfterDebit = (await asService("select balance,total_used from public.usage_wallets where id=$1", [fixture.wallet])).rows[0];
  assert.deepEqual(balanceAfterDebit, { balance: "0", total_used: "20000" });
  const quote = (await asService("select public.quote_practice_booking_cancellation($1) as result", [bookingId])).rows[0].result;
  assert.equal(quote.cancellation_fee_credits, 0);
  const cancelled = (await asService("select public.cancel_practice_booking_with_credits($1,'r21-patient',0) as result", [bookingId])).rows[0].result;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.refund_credits, 20000);
  const balanceAfterRefund = (await asService("select balance,total_used from public.usage_wallets where id=$1", [fixture.wallet])).rows[0];
  assert.deepEqual(balanceAfterRefund, { balance: "20000", total_used: "0" });

  const savedDraft = (await asService(
    "select public.save_medical_encounter_version($1,0,$2,'anonymous_case',$3,'support',null,$4,'draft',$5::jsonb,'') as result",
    [fixture.encounter, fixture.expert, fixture.medicalOwner, startsAt, JSON.stringify({ complaints: "R21 synthetic", medications: [] })],
  )).rows[0].result;
  assert.equal(savedDraft.version, 1);
  const savedConfirmed = (await asService(
    "select public.save_medical_encounter_version($1,1,$2,'anonymous_case',$3,'support',null,$4,'confirmed',$5::jsonb,'') as result",
    [fixture.encounter, fixture.expert, fixture.medicalOwner, startsAt, JSON.stringify({ complaints: "R21 synthetic", medications: [] })],
  )).rows[0].result;
  assert.equal(savedConfirmed.version, 2);
  await assert.rejects(
    asService("select public.save_medical_encounter_version($1,2,$2,'anonymous_case',$3,'support',null,$4,'draft',$5::jsonb,'')", [fixture.encounter, fixture.expert, fixture.medicalOwner, startsAt, JSON.stringify({ complaints: "R21 synthetic", medications: [] })]),
    { code: "22023" },
  );

  await expectDenied("anon", "select * from public.practice_booking_credits");
  await expectDenied("anon", "select public.quote_practice_booking_cancellation($1)", [bookingId]);
  await expectDenied("anon", "select * from public.medical_encounter_versions");
  await expectDenied("service_role", "update public.medical_encounter_versions set status='draft' where encounter_id=$1", [fixture.encounter]);

  await db.query("rollback");
  const remnants = (await db.query(
    "select (select count(*) from public.organizations where id=$1)::int as organizations, (select count(*) from public.practice_bookings where owner_id=$2)::int as bookings, (select count(*) from public.medical_encounter_versions where encounter_id=$3)::int as encounters",
    [fixture.organization, fixture.owner, fixture.encounter],
  )).rows[0];
  assert.deepEqual(remnants, { organizations: 0, bookings: 0, encounters: 0 });
  console.log("R2.1 local PostgreSQL PASS: credit debit/refund, booking snapshot, medical immutable versions, service-role access, anon denial, rollback cleanup.");
} finally {
  try { await db.query("rollback"); } catch {}
  await db.end();
}
