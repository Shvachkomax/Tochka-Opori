import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  handlePracticeAvailability,
  handlePracticeBooking,
  handlePracticeServices,
} from "../lib/my-practice/booking-handler.js";

const url = process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
assert.equal(process.env.SUPABASE_LOCAL_REHEARSAL, "1", "R2.2 E2E requires explicit local rehearsal");
assert(/^http:\/\/(?:localhost|127\.0\.0\.1):54321\/?$/.test(url), "R2.2 E2E refuses a non-local Supabase URL");
assert.equal(process.env.MY_PRACTICE_SERVER_ENABLED, "true", "R2.2 E2E requires the explicit My Practice local gate");
assert(key, "R2.2 E2E requires a local service-role key");

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const id = () => crypto.randomUUID();
const runId = Date.now().toString(36).toUpperCase();
const fixture = { organization: id(), expert: id(), owner: id(), assignment: id() };
const day = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
const memberships = [{ organization_id: fixture.organization, status: "active", role: "doctor" }];
const owner = { ownerType: "anonymous_case", ownerId: fixture.owner, sessionId: `r22-${runId}`, publicCode: `R22-${runId}`, module: "support" };
const savedMode = process.env.MY_PRACTICE_FINANCIAL_MODE;

function response() {
  return {
    statusCode: 200, payload: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

async function invoke(handler, body, deps) {
  const res = response();
  await handler({ body, headers: {} }, res, deps);
  return { status: res.statusCode, body: res.payload };
}

async function ensure(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const patientDeps = {
  getSupabase: () => supabase,
  resolvePatient: async (sessionId) => sessionId === owner.sessionId ? owner : null,
  authorizeSpecialist: async () => ({ expert: { id: fixture.expert, allowed_modules: ["support"] }, memberships }),
};
const doctorDeps = {
  getSupabase: () => supabase,
  authorizeSpecialist: async () => ({ expert: { id: fixture.expert, allowed_modules: ["support"] }, memberships }),
};
const patientRequest = (action, body = {}) => invoke(handlePracticeBooking, {
  action, session_id: owner.sessionId, access_token: "synthetic", ...body,
}, patientDeps);

async function cleanup() {
  const { data: bookings } = await supabase.from("practice_bookings").select("id").eq("owner_id", fixture.owner);
  const ids = (bookings || []).map((booking) => booking.id);
  if (ids.length) {
    await supabase.from("practice_events").delete().in("booking_id", ids);
    await supabase.from("practice_commissions").delete().in("booking_id", ids);
    await supabase.from("practice_booking_credits").delete().in("booking_id", ids);
    await supabase.from("practice_payments").delete().in("booking_id", ids);
    await supabase.from("practice_bookings").delete().in("id", ids);
  }
  const { data: wallets } = await supabase.from("usage_wallets").select("id").eq("owner_id", fixture.owner);
  const walletIds = (wallets || []).map((wallet) => wallet.id);
  if (walletIds.length) {
    await supabase.from("usage_ledger").delete().in("wallet_id", walletIds);
    await supabase.from("usage_reservations").delete().in("wallet_id", walletIds);
    await supabase.from("usage_wallets").delete().in("id", walletIds);
  }
  await supabase.from("patient_access").delete().eq("owner_id", fixture.owner);
  await supabase.from("patient_assignments").delete().eq("id", fixture.assignment);
  await supabase.from("practice_availability").delete().eq("expert_id", fixture.expert);
  await supabase.from("practice_services").delete().eq("expert_id", fixture.expert);
  await supabase.from("expert_organization_memberships").delete().eq("expert_id", fixture.expert);
  await supabase.from("experts").delete().eq("id", fixture.expert);
  await supabase.from("organizations").delete().eq("id", fixture.organization);
}

try {
  await cleanup();
  await ensure(await supabase.from("organizations").insert({
    id: fixture.organization, name: `R22 Synthetic Organization ${runId}`, slug: `r22-${runId.toLowerCase()}`,
  }), "organization");
  await ensure(await supabase.from("experts").insert({
    id: fixture.expert, name: "R22 Synthetic Specialist", role: "doctor", specialty: "Synthetic", city: "TEST",
    access_code: `R22-${runId}`, is_active: true, allowed_modules: ["support"],
  }), "expert");
  await ensure(await supabase.from("expert_organization_memberships").insert({
    organization_id: fixture.organization, expert_id: fixture.expert, role: "doctor", status: "active",
  }), "membership");
  await ensure(await supabase.from("patient_assignments").insert({
    id: fixture.assignment, owner_type: owner.ownerType, owner_id: owner.ownerId,
    organization_id: fixture.organization, primary_expert_id: fixture.expert,
    assigned_by_expert_id: fixture.expert, assigned_by_expert_name: "R22 synthetic",
    source: "r22_e2e", status: "active", module: "support",
  }), "assignment");

  const service = await invoke(handlePracticeServices, {
    action: "savePracticeService", organization_id: fixture.organization,
    name: "R22 Paid Synthetic Visit", format: "video", price_kop: 12500,
    duration_min: 30, modules: ["support"], is_active: true,
  }, doctorDeps);
  assert.equal(service.status, 200);
  const availability = await invoke(handlePracticeAvailability, {
    action: "listPracticeAvailability", organization_id: fixture.organization,
  }, doctorDeps);
  assert.equal(availability.status, 200);
  assert.equal(availability.body.availability.length, 7, "schedule remains available without financial coupling");

  // A: existing Preview-style credit mode retains the cabinet and server-side
  // conversion contract. Debit/refund semantics are exercised by R2.1 too.
  process.env.MY_PRACTICE_FINANCIAL_MODE = "test_credits";
  const testCabinet = await patientRequest("getPracticePatientCabinet");
  assert.equal(testCabinet.status, 200);
  assert.equal(testCabinet.body.financial_mode, "test_credits");
  assert.equal(testCabinet.body.payments_available, true);
  assert.equal(testCabinet.body.specialists[0].services[0].price_credits, 1250);

  // B: the same clinical catalog, attachment and saved schedule work while a
  // paid visit becomes an explicit request and makes no financial mutation.
  process.env.MY_PRACTICE_FINANCIAL_MODE = "payments_disabled";
  const disabledCabinet = await patientRequest("getPracticePatientCabinet");
  assert.equal(disabledCabinet.status, 200);
  assert.equal(disabledCabinet.body.financial_mode, "payments_disabled");
  assert.equal(disabledCabinet.body.payments_available, false);
  assert.equal("available_credits" in disabledCabinet.body, false, "disabled mode does not create or expose a wallet");
  const slots = await patientRequest("getPracticeSlots", { service_id: service.body.service.id, day });
  assert.equal(slots.status, 200);
  assert(slots.body.free.length > 0, "saved availability exposes free time");
  const selected = slots.body.free[0];
  const requested = await patientRequest("reservePracticeBooking", {
    service_id: service.body.service.id, day, start_time: selected.start_time, idempotency_key: `r22-request-${runId}`,
  });
  assert.equal(requested.status, 200);
  assert.equal(requested.body.status, "requested");
  assert.equal(requested.body.payment_required, true);
  const [{ data: requestedBooking }, { data: credits }, { data: payments }, { data: commissions }] = await Promise.all([
    supabase.from("practice_bookings").select("status").eq("id", requested.body.booking_id).single(),
    supabase.from("practice_booking_credits").select("booking_id").eq("booking_id", requested.body.booking_id),
    supabase.from("practice_payments").select("booking_id").eq("booking_id", requested.body.booking_id),
    supabase.from("practice_commissions").select("booking_id").eq("booking_id", requested.body.booking_id),
  ]);
  assert.equal(requestedBooking.status, "requested");
  assert.deepEqual(credits || [], [], "unpaid request creates no credit entry");
  assert.deepEqual(payments || [], [], "unpaid request creates no payment entry");
  assert.deepEqual(commissions || [], [], "unpaid request creates no commission entry");
  const conflict = await patientRequest("reservePracticeBooking", {
    service_id: service.body.service.id, day, start_time: selected.start_time, idempotency_key: `r22-conflict-${runId}`,
  });
  assert.equal(conflict.status, 409, "unpaid request retains double-booking protection");
  const paymentAttempt = await patientRequest("payPracticeBookingCredits", {
    booking_id: requested.body.booking_id, expected_price_credits: 1250, cancellation_policy_version: "12h-20-v1",
  });
  assert.equal(paymentAttempt.status, 409);
  assert.equal(paymentAttempt.body.code, "PAYMENTS_DISABLED");
  const quote = await patientRequest("quotePracticeCancellation", { booking_id: requested.body.booking_id });
  assert.equal(quote.status, 200);
  assert.equal(quote.body.can_cancel, true);
  const cancelled = await patientRequest("cancelPracticeBookingPublic", { booking_id: requested.body.booking_id });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, "cancelled");

  // C: unknown/missing and future real payment modes never enter a payment
  // path; the clinical cabinet remains readable for recovery and support.
  process.env.MY_PRACTICE_FINANCIAL_MODE = "real_payments";
  const realAttempt = await patientRequest("reservePracticeBooking", {
    service_id: service.body.service.id, day, start_time: selected.start_time, idempotency_key: `r22-real-${runId}`,
  });
  assert.equal(realAttempt.status, 409);
  assert.equal(realAttempt.body.code, "REAL_PAYMENTS_NOT_IMPLEMENTED");
  delete process.env.MY_PRACTICE_FINANCIAL_MODE;
  const missingAttempt = await patientRequest("reservePracticeBooking", {
    service_id: service.body.service.id, day, start_time: selected.start_time, idempotency_key: `r22-missing-${runId}`,
  });
  assert.equal(missingAttempt.status, 409);
  assert.equal(missingAttempt.body.code, "FINANCIAL_MODE_REQUIRED");
  const readableCabinet = await patientRequest("getPracticePatientCabinet");
  assert.equal(readableCabinet.status, 200);
  assert.equal(readableCabinet.body.financial_mode, "configuration_error");

  console.log("R2.2 local E2E PASS: test credits retained, disabled payments create only unpaid requests, no financial rows, conflicts/RLS gate preserved, invalid modes fail closed.");
} finally {
  if (savedMode === undefined) delete process.env.MY_PRACTICE_FINANCIAL_MODE;
  else process.env.MY_PRACTICE_FINANCIAL_MODE = savedMode;
  await cleanup();
}
