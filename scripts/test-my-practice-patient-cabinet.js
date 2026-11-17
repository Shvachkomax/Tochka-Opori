import assert from "node:assert/strict";
import { handlePracticeBooking } from "../lib/my-practice/booking-handler.js";
import { changePracticeProfileLink } from "../lib/my-practice/patient-cabinet.js";

Object.assign(process.env, {
  MY_PRACTICE_SERVER_ENABLED: "true",
  VERCEL_ENV: "preview",
  DEPLOYMENT_PURPOSE: "test",
  MY_PRACTICE_ALLOWED_SUPABASE_REF: "eehyehlhiyztciaezaus",
  SUPABASE_URL: "https://eehyehlhiyztciaezaus.supabase.co",
});
for (const key of ["VITE_APP_BRAND", "PILOT_ID", "SUPPORT_ONLY", "ANMED_SUPPORT_ONLY"]) delete process.env[key];

const support = { ownerId: "s", ownerType: "anonymous_case", module: "support", sessionId: "support-session" };
const health = { ownerId: "h", ownerType: "anonymous_profile", module: "body", sessionId: "health-session" };
const other = { ...support, ownerId: "other", sessionId: "other-session" };
const startsAt = "2099-01-19T10:00:00.000Z";
const booking = {
  id: "booking", owner_id: health.ownerId, owner_type: health.ownerType,
  session_id: health.sessionId, status: "confirmed", starts_at: startsAt, expert_id: "doctor-h", organization_id: "clinic",
};
const tables = {
  practice_patient_profile_links: [],
  sessions: [{ anonymous_owner_id: support.ownerId, module: "support", public_code: "legacy-code" }],
  patient_assignments: [
    { owner_id: health.ownerId, owner_type: health.ownerType, module: "body", status: "active", expert_id: "doctor-h", organization_id: "clinic" },
  ],
  patient_access: [
    { owner_id: null, public_code: "legacy-code", module: "support", status: "active", expert_id: "doctor-s", organization_id: null },
    { owner_id: support.ownerId, owner_type: support.ownerType, module: "support", status: "revoked", expert_id: "doctor-h", organization_id: null },
  ],
  experts: [{ id: "doctor-h", name: "Врач Health", is_active: true }, { id: "doctor-s", name: "Врач Support", is_active: true }],
  organizations: [{ id: "clinic", name: "Клиника" }],
  practice_services: [
    { id: "correct", expert_id: "doctor-h", organization_id: "clinic", is_active: true, practice_places: { name: "Кабинет" } },
    { id: "excluded", expert_id: "doctor-h", organization_id: null, is_active: true },
  ],
  practice_bookings: [booking],
};

function from(table) {
  let filters = [];
  let deleteRows = false;
  let single = false;
  const query = {
    select: () => query,
    limit: () => query,
    order: () => query,
    eq(key, value) { filters.push((row) => row[key] === value); return query; },
    is(key, value) { return query.eq(key, value); },
    in(key, values) { filters.push((row) => values.includes(row[key])); return query; },
    or(expression) {
      const owners = [...expression.matchAll(/and\(owner_type\.eq\.([^,]+),owner_id\.eq\.([^)]+)\)/g)];
      filters.push((row) => owners.some(([, type, id]) => row.owner_type === type && row.owner_id === id));
      return query;
    },
    maybeSingle() { single = true; return query; },
    delete() { deleteRows = true; return query; },
    insert(row) {
      if (tables[table].some((prior) => prior.support_owner_id === row.support_owner_id || prior.health_owner_id === row.health_owner_id)) {
        return { error: { code: "23505" } };
      }
      tables[table].push(row);
      return { error: null };
    },
    then(resolve) {
      const matches = (row) => filters.every((filter) => filter(row));
      const data = tables[table].filter(matches);
      if (deleteRows) tables[table] = tables[table].filter((row) => !matches(row));
      return resolve({ data: single ? data[0] || null : data, error: null });
    },
  };
  return query;
}

const supabase = {
  from,
  async rpc(action, input) {
    if (action === "ensure_usage_wallet") return { data: { balance: 20000, status: "active" } };
    if (action === "revoke_patient_specialist_link") {
      let revoked = 0;
      for (const table of ["patient_assignments", "patient_access"]) {
        for (const row of tables[table]) {
          const expertId = row.primary_expert_id || row.expert_id;
          if (row.status === "active" && expertId === input.p_expert_id && row.module === input.p_module
            && row.organization_id === input.p_organization_id && row.owner_id === input.p_owner_id) {
            row.status = "revoked"; revoked++;
          }
        }
      }
      return { data: { ok: true, revoked } };
    }
    assert.equal(action, "cancel_practice_booking_with_credits");
    assert.equal(input.p_booking_id, booking.id);
    booking.status = "cancelled";
    return { data: { booking_id: booking.id, status: booking.status } };
  },
};

const deps = {
  getSupabase: () => supabase,
  resolvePatient: (session, token) => token === "verified"
    ? [support, health, other].find(({ sessionId }) => sessionId === session) : null,
  // Production membership loader already filters active rows and normalizes
  // status away. Organization-scoped practice actions must accept this shape.
  authorizeSpecialist: async () => ({ expert: { id: "doctor-h" }, memberships: [{ organization_id: "clinic" }] }),
};

async function request(action, owner, body = {}, token = "verified") {
  const res = {
    code: 200,
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(data) { return { code: this.code, data }; },
  };
  return handlePracticeBooking({ body: { action, session_id: owner.sessionId, access_token: token, ...body } }, res, deps);
}

assert.equal((await request("getPracticePatientCabinet", support, {}, "invalid")).code, 401);
const before = await request("getPracticePatientCabinet", support);
assert.deepEqual(before.data.specialists.map(({ expert_id }) => expert_id), ["doctor-s"]);
assert.deepEqual(before.data.bookings, []);
assert.equal((await changePracticeProfileLink(supabase, support, health)).error, null);
assert.deepEqual(await changePracticeProfileLink(supabase, health, support), {});
assert.equal((await changePracticeProfileLink(supabase, other, health)).conflict, true);

for (const owner of [support, health]) {
  const result = await request("getPracticePatientCabinet", owner);
  assert.equal(result.data.linked, true);
  assert.deepEqual(result.data.specialists.map(({ expert_id }) => expert_id).sort(), ["doctor-h", "doctor-s"]);
  const specialist = result.data.specialists.find(({ expert_id }) => expert_id === "doctor-h");
  assert.deepEqual(specialist.services.map(({ service_id }) => service_id), ["correct"]);
  assert.equal(result.data.bookings[0].id, booking.id);
}

assert.equal((await request("listPracticeBookings", health, { organization_id: "clinic" })).data.bookings[0].status, "confirmed");
assert.equal((await request("cancelPracticeBookingPublic", other, { booking_id: booking.id })).code, 403);
assert.equal((await request("getPracticePatientCabinet", other)).data.bookings.length, 0);
assert.equal((await request("cancelPracticeBookingPublic", support, { booking_id: booking.id })).data.status, "cancelled");
assert.equal((await request("listPracticeBookings", health, { organization_id: "clinic" })).data.bookings[0].status, "cancelled");

process.env.PILOT_ID = "partner";
assert.deepEqual((await request("getPracticePatientCabinet", support)).data.bookings, []);
assert.equal((await request("unlinkPracticePatientProfiles", support)).code, 403);
delete process.env.PILOT_ID;

assert.equal((await request("unlinkPracticePatientProfiles", support)).code, 200);
assert.deepEqual((await request("getPracticePatientCabinet", support)).data.bookings, []);
assert.equal((await request("getPracticePatientCabinet", health)).data.bookings[0].id, booking.id);
const revoked = await request("revokePracticeSpecialist", health, { expert_id: "doctor-h", organization_id: "clinic" });
assert.equal(revoked.code, 200);
assert.equal(revoked.data.revoked, 1);
assert.deepEqual((await request("getPracticePatientCabinet", health)).data.specialists, []);
// Financial actions must validate acceptance, then use the credit RPC.
assert.equal((await request("reservePracticeBooking", health, { service_id: "correct", day: "2099-01-19", start_time: "10:00", idempotency_key: "key" })).code, 400);
const oldRpc = supabase.rpc;
supabase.rpc = async (action, args) => {
  assert.equal(action, "reserve_practice_booking_with_credits");
  assert.equal(args.p_owner_id, health.ownerId);
  assert.equal(args.p_expected_credits, 20000);
  return { error: { code: "P0010", details: JSON.stringify({ required_credits: 20000, available_credits: 15000, missing_credits: 5000 }) } };
};
const insufficient = await request("reservePracticeBooking", health, {
  service_id: "correct", day: "2099-01-19", start_time: "10:00", idempotency_key: "key",
  expected_price_credits: 20000, cancellation_policy_version: "12h-20-v1",
});
assert.equal(insufficient.code, 402);
assert.equal(insufficient.data.missing_credits, 5000);
supabase.rpc = oldRpc;
console.log("A3 patient cabinet: multiple specialists, paired owners, preserved bookings, cancellation and scope isolation PASS");
