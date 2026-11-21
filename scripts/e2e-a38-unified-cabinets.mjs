import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  handlePracticeAvailability,
  handlePracticeBooking,
  handlePracticePlaces,
  handlePracticeServices,
} from "../lib/my-practice/booking-handler.js";

const TEST_REF = "eehyehlhiyztciaezaus";
const url = process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ref = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
assert.equal(ref, TEST_REF, `A3.8 E2E refuses non-test Supabase: ${ref || "unknown"}`);
assert(key, "A3.8 E2E requires the Preview service-role key");
assert.equal(process.env.VERCEL_ENV, "preview", "A3.8 E2E runs only with Preview environment variables");

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const id = () => crypto.randomUUID();
const runId = Date.now().toString(36).toUpperCase();
const fixture = {
  organization: id(), expertA: id(), expertB: id(), supportOwner: id(), healthOwner: id(), otherOwner: id(),
  invitationA: id(), invitationB: id(), assignmentHealth: id(),
};
const publicCode = `A38-SYN-${runId}`;
const day = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
const accessCodeA = `A38-SYN-A-${runId}`;
const accessCodeB = `A38-SYN-B-${runId}`;
const memberships = [{ organization_id: fixture.organization, status: "active", role: "doctor" }];
const owner = { ownerType: "anonymous_case", ownerId: fixture.supportOwner, publicCode, module: "support", sessionId: `a38-support-${runId}` };
const healthOwner = { ownerType: "anonymous_profile", ownerId: fixture.healthOwner, publicCode: null, module: "body", sessionId: `a38-health-${runId}` };
const otherOwner = { ownerType: "anonymous_case", ownerId: fixture.otherOwner, publicCode: `A38-OTHER-${runId}`, module: "support", sessionId: `a38-other-${runId}` };

async function ensure(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

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

const patientDeps = {
  getSupabase: () => supabase,
  resolvePatient: async (sessionId) => [owner, healthOwner, otherOwner].find((candidate) => candidate.sessionId === sessionId) || null,
  authorizeSpecialist: async () => ({ expert: { id: fixture.expertA }, memberships }),
};
const doctorDeps = (expertId) => ({
  getSupabase: () => supabase,
  authorizeSpecialist: async () => ({ expert: { id: expertId }, memberships }),
});

async function patientRequest(action, actingOwner = owner, body = {}) {
  return invoke(handlePracticeBooking, { action, session_id: actingOwner.sessionId, access_token: "synthetic", ...body }, patientDeps);
}

async function relationCount(expertId, module, ownerType, ownerId) {
  const [{ data: assignments }, { data: access }] = await Promise.all([
    supabase.from("patient_assignments").select("id").eq("primary_expert_id", expertId).eq("module", module)
      .eq("owner_type", ownerType).eq("owner_id", ownerId).eq("status", "active"),
    supabase.from("patient_access").select("id").eq("expert_id", expertId).eq("module", module)
      .eq("owner_type", ownerType).eq("owner_id", ownerId).eq("status", "active"),
  ]);
  return (assignments?.length || 0) + (access?.length || 0);
}

async function cleanup() {
  const { data: bookings } = await supabase.from("practice_bookings").select("id").in("owner_id", [fixture.supportOwner, fixture.healthOwner, fixture.otherOwner]);
  const bookingIds = (bookings || []).map((row) => row.id);
  if (bookingIds.length) {
    await supabase.from("practice_events").delete().in("booking_id", bookingIds);
    await supabase.from("practice_commissions").delete().in("booking_id", bookingIds);
    await supabase.from("practice_booking_credits").delete().in("booking_id", bookingIds);
    await supabase.from("practice_bookings").delete().in("id", bookingIds);
  }
  const { data: wallets } = await supabase.from("usage_wallets").select("id").in("owner_id", [fixture.supportOwner, fixture.healthOwner, fixture.otherOwner]);
  const walletIds = (wallets || []).map((row) => row.id);
  if (walletIds.length) {
    await supabase.from("usage_ledger").delete().in("wallet_id", walletIds);
    await supabase.from("usage_reservations").delete().in("wallet_id", walletIds);
    await supabase.from("usage_wallets").delete().in("id", walletIds);
  }
  await supabase.from("patient_specialist_invitations").delete().in("id", [fixture.invitationA, fixture.invitationB]);
  await supabase.from("patient_access").delete().in("owner_id", [fixture.supportOwner, fixture.healthOwner]);
  await supabase.from("patient_assignments").delete().in("owner_id", [fixture.supportOwner, fixture.healthOwner]);
  await supabase.from("practice_availability").delete().in("expert_id", [fixture.expertA, fixture.expertB]);
  await supabase.from("practice_services").delete().in("expert_id", [fixture.expertA, fixture.expertB]);
  await supabase.from("practice_places").delete().in("expert_id", [fixture.expertA, fixture.expertB]);
  await supabase.from("expert_organization_memberships").delete().in("expert_id", [fixture.expertA, fixture.expertB]);
  await supabase.from("experts").delete().in("id", [fixture.expertA, fixture.expertB]);
  await supabase.from("organizations").delete().eq("id", fixture.organization);
}

try {
  await cleanup();
  await ensure(await supabase.from("organizations").insert({
    id: fixture.organization, name: `A38 Synthetic Organization ${runId}`, slug: `a38-syn-${runId.toLowerCase()}`,
  }), "organization");
  await ensure(await supabase.from("experts").insert([
    { id: fixture.expertA, name: "A38 Synthetic Specialist A", role: "doctor", specialty: "Synthetic", city: "TEST", access_code: accessCodeA, is_active: true, allowed_modules: ["support", "body"] },
    { id: fixture.expertB, name: "A38 Synthetic Specialist B", role: "doctor", specialty: "Synthetic", city: "TEST", access_code: accessCodeB, is_active: true, allowed_modules: ["support"] },
  ]), "experts");
  await ensure(await supabase.from("expert_organization_memberships").insert([
    { organization_id: fixture.organization, expert_id: fixture.expertA, role: "doctor", status: "active" },
    { organization_id: fixture.organization, expert_id: fixture.expertB, role: "doctor", status: "active" },
  ]), "memberships");

  const tokenA = crypto.createHash("sha256").update(`a38-a-${runId}`).digest("hex");
  const tokenB = crypto.createHash("sha256").update(`a38-b-${runId}`).digest("hex");
  await ensure(await supabase.from("patient_specialist_invitations").insert([
    { id: fixture.invitationA, token_hash: tokenA, direction: "specialist_to_patient", module: "support", inviter_expert_id: fixture.expertA, organization_id: fixture.organization, status: "pending", expires_at: new Date(Date.now() + 86400000).toISOString() },
    { id: fixture.invitationB, token_hash: tokenB, direction: "specialist_to_patient", module: "support", inviter_expert_id: fixture.expertB, organization_id: fixture.organization, status: "pending", expires_at: new Date(Date.now() + 86400000).toISOString() },
  ]), "invitations");
  const acceptedA = await ensure(await supabase.rpc("accept_specialist_invitation", { p_token_hash: tokenA, p_owner_id: fixture.supportOwner, p_public_code: publicCode }), "accept A");
  const acceptedB = await ensure(await supabase.rpc("accept_specialist_invitation", { p_token_hash: tokenB, p_owner_id: fixture.supportOwner, p_public_code: publicCode }), "accept B");
  assert.equal(acceptedA.relationship, "primary");
  assert.equal(acceptedB.relationship, "shared");
  assert.equal(await relationCount(fixture.expertA, "support", "anonymous_case", fixture.supportOwner), 1);
  assert.equal(await relationCount(fixture.expertB, "support", "anonymous_case", fixture.supportOwner), 1);

  await ensure(await supabase.from("patient_assignments").insert({
    id: fixture.assignmentHealth, owner_type: "anonymous_profile", owner_id: fixture.healthOwner,
    organization_id: fixture.organization, primary_expert_id: fixture.expertA, assigned_by_expert_id: fixture.expertA,
    assigned_by_expert_name: "A38 synthetic", source: "a38_e2e", status: "active", module: "body",
  }), "health assignment");

  const place = await invoke(handlePracticePlaces, {
    action: "savePracticePlace", organization_id: fixture.organization, name: "A38 Synthetic Place", address: "TEST",
  }, doctorDeps(fixture.expertA));
  assert.equal(place.status, 200); assert(place.body.place?.id);
  const service = await invoke(handlePracticeServices, {
    action: "savePracticeService", organization_id: fixture.organization, place_id: place.body.place.id,
    name: "A38 Synthetic Zero-Price Visit", format: "offline", price_kop: 0, duration_min: 60,
    modules: ["support", "body"], is_active: true,
  }, doctorDeps(fixture.expertA));
  assert.equal(service.status, 200); assert.equal(service.body.service?.is_active, true);
  const supportOnlyService = await invoke(handlePracticeServices, {
    action: "savePracticeService", organization_id: fixture.organization, place_id: place.body.place.id,
    name: "A38 Synthetic Support Only", format: "online", price_kop: 0, duration_min: 45,
    modules: ["support"], is_active: true,
  }, doctorDeps(fixture.expertA));
  const healthOnlyService = await invoke(handlePracticeServices, {
    action: "savePracticeService", organization_id: fixture.organization, place_id: place.body.place.id,
    name: "A38 Synthetic Health Only", format: "video", price_kop: 0, duration_min: 30,
    modules: ["body"], is_active: true,
  }, doctorDeps(fixture.expertA));
  assert.equal(supportOnlyService.status, 200); assert.equal(healthOnlyService.status, 200);
  const availability = await invoke(handlePracticeAvailability, {
    action: "listPracticeAvailability", organization_id: fixture.organization,
  }, doctorDeps(fixture.expertA));
  assert.equal(availability.status, 200);
  assert.equal(availability.body.initialized, true);
  assert.equal(availability.body.availability.length, 7);
  const availabilityAgain = await invoke(handlePracticeAvailability, {
    action: "listPracticeAvailability", organization_id: fixture.organization,
  }, doctorDeps(fixture.expertA));
  assert.equal(availabilityAgain.body.initialized, false);
  assert.equal(availabilityAgain.body.availability.length, 7, "repeat entry does not duplicate defaults");

  const supportCabinet = await patientRequest("getPracticePatientCabinet");
  assert.equal(supportCabinet.status, 200);
  assert.deepEqual(supportCabinet.body.specialists.map((row) => row.expert_id).sort(), [fixture.expertA, fixture.expertB].sort());
  assert.deepEqual(supportCabinet.body.specialists.find((row) => row.expert_id === fixture.expertA).services.map((row) => row.service_id).sort(),
    [service.body.service.id, supportOnlyService.body.service.id].sort());
  const healthCabinet = await patientRequest("getPracticePatientCabinet", healthOwner);
  assert.deepEqual(healthCabinet.body.specialists.map((row) => row.expert_id), [fixture.expertA]);
  assert.deepEqual(healthCabinet.body.specialists[0].services.map((row) => row.service_id).sort(),
    [service.body.service.id, healthOnlyService.body.service.id].sort());
  assert.equal((await patientRequest("getPracticeSlots", owner, { service_id: healthOnlyService.body.service.id, day })).status, 404,
    "Support patient cannot enumerate a Health-only service");
  assert.equal((await patientRequest("getPracticeSlots", healthOwner, { service_id: supportOnlyService.body.service.id, day })).status, 404,
    "Health patient cannot enumerate a Support-only service");

  const slots = await patientRequest("getPracticeSlots", owner, { service_id: service.body.service.id, day });
  assert.equal(slots.status, 200); assert(slots.body.free.length > 0);
  const selectedSlot = slots.body.free.find((slot) => slot.start_time === "10:00") || slots.body.free[0];
  const reserved = await patientRequest("reservePracticeBooking", owner, {
    service_id: service.body.service.id, day, start_time: selectedSlot.start_time,
    idempotency_key: `a38-${runId}`, expected_price_credits: 0, cancellation_policy_version: "12h-20-v1",
  });
  assert.equal(reserved.status, 200); assert.equal(reserved.body.status, "confirmed");
  const repriced = await invoke(handlePracticeServices, {
    action: "savePracticeService", id: service.body.service.id, organization_id: fixture.organization,
    place_id: place.body.place.id, name: "A38 Synthetic Repriced Visit", format: "offline",
    price_kop: 10000, duration_min: 60, modules: ["support", "body"], is_active: true,
  }, doctorDeps(fixture.expertA));
  assert.equal(repriced.status, 200); assert.equal(Number(repriced.body.service.price_credits), 1000);
  const bookingSnapshot = await ensure(await supabase.from("practice_booking_credits")
    .select("charged_credits, price_kop").eq("booking_id", reserved.body.booking_id).single(), "booking snapshot");
  assert.equal(Number(bookingSnapshot.charged_credits), 0, "service repricing never changes the booked credit snapshot");
  assert.equal(Number(bookingSnapshot.price_kop), 0, "service repricing never changes the booked RUB snapshot");
  const slotsAfterBooking = await patientRequest("getPracticeSlots", owner, { service_id: service.body.service.id, day });
  assert(!slotsAfterBooking.body.free.some((slot) => slot.start_time === selectedSlot.start_time), "confirmed interval stays unavailable to the patient");
  const patientAfterBooking = await patientRequest("getPracticePatientCabinet");
  assert(patientAfterBooking.body.bookings.some((row) => row.id === reserved.body.booking_id && row.status === "confirmed"));
  const doctorBookings = await invoke(handlePracticeBooking, {
    action: "listPracticeBookings", organization_id: fixture.organization,
  }, doctorDeps(fixture.expertA));
  assert(doctorBookings.body.bookings.some((row) => row.id === reserved.body.booking_id && row.status === "confirmed"));
  const forbiddenCancel = await patientRequest("cancelPracticeBookingPublic", otherOwner, { booking_id: reserved.body.booking_id, expected_fee_credits: 0 });
  assert.equal(forbiddenCancel.status, 403);
  const quote = await patientRequest("quotePracticeCancellation", owner, { booking_id: reserved.body.booking_id });
  assert.equal(quote.status, 200); assert.equal(Number(quote.body.cancellation_fee_credits), 0);
  const cancelled = await patientRequest("cancelPracticeBookingPublic", owner, { booking_id: reserved.body.booking_id, expected_fee_credits: 0 });
  assert.equal(cancelled.status, 200); assert.equal(cancelled.body.status, "cancelled");
  const doctorAfterCancel = await invoke(handlePracticeBooking, {
    action: "listPracticeBookings", organization_id: fixture.organization,
  }, doctorDeps(fixture.expertA));
  assert(doctorAfterCancel.body.bookings.some((row) => row.id === reserved.body.booking_id && row.status === "cancelled"));

  const revokedB = await ensure(await supabase.rpc("revoke_patient_specialist_link", {
    p_owner_type: "anonymous_case", p_owner_id: fixture.supportOwner, p_public_code: publicCode,
    p_module: "support", p_expert_id: fixture.expertB, p_organization_id: fixture.organization,
  }), "revoke B");
  assert.equal(Number(revokedB.revoked), 1);
  assert.equal(await relationCount(fixture.expertB, "support", "anonymous_case", fixture.supportOwner), 0);
  const supportAfterRevoke = await patientRequest("getPracticePatientCabinet");
  assert.deepEqual(supportAfterRevoke.body.specialists.map((row) => row.expert_id), [fixture.expertA]);
  assert.equal(await relationCount(fixture.expertA, "body", "anonymous_profile", fixture.healthOwner), 1, "Support revoke never removes Health link");

  console.log("A3.8.2 TEST E2E PASS: mutual links, module-scoped server catalog, repricing snapshots, slots, booking, both schedules, cancellation, unauthorized denial, symmetric revoke, cleanup.");
} finally {
  await cleanup();
}
