import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlePracticeBooking } from "../lib/my-practice/booking-handler.js";
import { validateSpecialistWorkspaceContext } from "../api/specialist.js";

Object.assign(process.env, {
  MY_PRACTICE_SERVER_ENABLED: "true",
  VERCEL_ENV: "preview",
  DEPLOYMENT_PURPOSE: "test",
  MY_PRACTICE_ALLOWED_SUPABASE_REF: "eehyehlhiyztciaezaus",
  SUPABASE_URL: "https://eehyehlhiyztciaezaus.supabase.co",
});

const orgA = "org-a";
const orgB = "org-b";
const expert = { id: "a39-doctor", allowed_modules: ["support", "body"] };
const memberships = [{ organization_id: orgA, organization_name: "A39 Clinic", status: "active" }];

const tables = {
  practice_bookings: [
    { id: "support-a", expert_id: expert.id, organization_id: orgA, owner_type: "anonymous_case", owner_id: "support-owner", status: "confirmed", starts_at: "2099-01-02T09:00:00.000Z", practice_services: { name: "Support visit" }, practice_places: { name: "Room A" } },
    { id: "health-a", expert_id: expert.id, organization_id: orgA, owner_type: "anonymous_profile", owner_id: "health-owner", status: "confirmed", starts_at: "2099-01-02T10:00:00.000Z", practice_services: { name: "Health visit" }, practice_places: { name: "Room A" } },
    { id: "health-private", expert_id: expert.id, organization_id: null, owner_type: "anonymous_profile", owner_id: "private-owner", status: "cancelled", starts_at: "2099-01-02T11:00:00.000Z", practice_services: { name: "Private visit" }, practice_places: null },
    { id: "foreign-org", expert_id: expert.id, organization_id: orgB, owner_type: "anonymous_case", owner_id: "foreign-owner", status: "confirmed", starts_at: "2099-01-02T12:00:00.000Z", practice_services: { name: "Hidden visit" }, practice_places: null },
  ],
  patient_assignments: [
    { id: "support-assignment", primary_expert_id: expert.id, module: "support", owner_type: "anonymous_case", owner_id: "support-owner", organization_id: orgA, status: "active" },
    { id: "health-assignment", primary_expert_id: expert.id, module: "body", owner_type: "anonymous_profile", owner_id: "health-owner", organization_id: orgA, status: "active" },
  ],
  patient_access: [],
  practice_booking_credits: [],
  practice_commissions: [],
};

function valueAt(row, path) {
  return path.split(".").reduce((value, key) => value?.[key], row);
}

function from(table) {
  const filters = [];
  let one = false;
  const query = {
    select: () => query,
    order: () => query,
    limit: () => query,
    eq(key, value) { filters.push((row) => valueAt(row, key) === value); return query; },
    in(key, values) { filters.push((row) => values.includes(valueAt(row, key))); return query; },
    is(key, value) { return query.eq(key, value); },
    maybeSingle() { one = true; return query; },
    then(resolve) {
      const rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)));
      return resolve({ data: one ? rows[0] || null : rows, error: null });
    },
  };
  return query;
}

const deps = {
  getSupabase: () => ({ from }),
  authorizeSpecialist: async () => ({ expert, memberships }),
};

async function doctorRequest(body) {
  const res = {
    code: 200,
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(data) { return { code: this.code, data }; },
  };
  return handlePracticeBooking({ body }, res, deps);
}

assert.equal(validateSpecialistWorkspaceContext({ memberships, organizationId: orgA, module: "all", allowedModules: ["support", "body"] }).ok, true);
assert.equal(validateSpecialistWorkspaceContext({ memberships, organizationId: orgA, module: "all", allowedModules: ["support"] }).ok, false, "All requires both entitlements");
assert.equal(validateSpecialistWorkspaceContext({ memberships, organizationId: orgB, module: "all", allowedModules: ["support", "body"] }).ok, false, "All still requires the selected organization membership");

const allBookings = await doctorRequest({ action: "listPracticeBookings", organization_id: orgA, organization_scope: "all", module: "all" });
assert.equal(allBookings.code, 200);
assert.deepEqual(allBookings.data.bookings.map((booking) => booking.id).sort(), ["health-a", "health-private", "support-a"], "aggregate excludes a booking from an unauthorized organization");
assert.equal(allBookings.data.bookings.find((booking) => booking.id === "support-a").module, "support");
assert.equal(allBookings.data.bookings.find((booking) => booking.id === "health-a").module, "body");
assert.equal(allBookings.data.bookings.find((booking) => booking.id === "support-a").client_ref, "assignment:support-assignment", "calendar only gets an opaque authorized card reference");

const healthBookings = await doctorRequest({ action: "listPracticeBookings", organization_id: orgA, organization_scope: "all", module: "body" });
assert.deepEqual(healthBookings.data.bookings.map((booking) => booking.id).sort(), ["health-a", "health-private"], "Health filter does not reveal Support bookings");

const deniedCompletion = await handlePracticeBooking({ body: { action: "completePracticeBooking", booking_id: "health-a", organization_id: orgA, module: "support" } }, {
  code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(data) { return { code: this.code, data }; },
}, { ...deps, authorizeSpecialist: async () => ({ expert: { ...expert, allowed_modules: ["support"] }, memberships }) });
assert.equal(deniedCompletion.code, 403, "a Support-only specialist cannot complete a Health booking");

const deniedAll = await handlePracticeBooking({ body: { action: "listPracticeBookings", organization_id: orgA, organization_scope: "all", module: "all" } }, {
  code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(data) { return { code: this.code, data }; },
}, { ...deps, authorizeSpecialist: async () => ({ expert: { ...expert, allowed_modules: ["support"] }, memberships }) });
assert.equal(deniedAll.code, 403, "single-module specialist cannot request aggregate mode");

tables.practice_booking_credits.push(
  { booking_id: "support-a", price_kop: 250000, charged_credits: 25000, refunded_credits: 0, cancellation_fee_credits: 0, service_fee_credits: 5000, settled_at: "2099-01-03T00:00:00.000Z", refunded_at: null, created_at: "2099-01-02T09:00:00.000Z", practice_bookings: tables.practice_bookings[0] },
  { booking_id: "health-a", price_kop: 180000, charged_credits: 18000, refunded_credits: 1000, cancellation_fee_credits: 0, service_fee_credits: 3600, settled_at: "2099-01-03T00:00:00.000Z", refunded_at: "2099-01-03T01:00:00.000Z", created_at: "2099-01-02T10:00:00.000Z", practice_bookings: tables.practice_bookings[1] },
  { booking_id: "foreign-org", price_kop: 100000, charged_credits: 10000, refunded_credits: 0, cancellation_fee_credits: 0, service_fee_credits: 2000, settled_at: "2099-01-03T00:00:00.000Z", refunded_at: null, created_at: "2099-01-02T12:00:00.000Z", practice_bookings: tables.practice_bookings[3] },
);
tables.practice_commissions.push(
  { id: "commission-support", status: "payable", fee_kop: 50000, practice_bookings: tables.practice_bookings[0] },
  { id: "commission-health", status: "payable", fee_kop: 36000, practice_bookings: tables.practice_bookings[1] },
  { id: "commission-hidden", status: "payable", fee_kop: 20000, practice_bookings: tables.practice_bookings[3] },
);
const finance = await doctorRequest({ action: "getPracticeFinance", organization_id: orgA, organization_scope: "all", module: "all" });
assert.equal(finance.code, 200);
assert.equal(finance.data.transactions.length, 2, "finance returns recorded facts only from authorized contexts");
assert.equal(finance.data.breakdown.length, 2, "finance keeps Support and Health/org rows separate");
assert.equal(finance.data.payable_total_kop, 86000, "commission excludes an unauthorized organization and remains a recorded amount");
assert.equal(finance.data.specialist_credits, 33400, "accrual accounts for recorded refunds and is not an invented ruble payout");

const cabinetSource = readFileSync(new URL("../src/pages/specialist/SpecialistCabinet.jsx", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../src/pages/specialist/PracticeBookingPanel.jsx", import.meta.url), "utf8");
assert(cabinetSource.includes("Все направления"));
assert(cabinetSource.includes('data-testid={`specialist-nav-${screen}`}'));
assert(cabinetSource.includes("Открыть карту"));
assert(panelSource.includes("[\"day\", \"День\"]"));
assert(panelSource.includes("[\"week\", \"Неделя\"]"));
assert(panelSource.includes("[\"list\", \"Список\"]"));

console.log("A3.9 unified workspace: module/org scope, calendar card refs, factual finance and navigation PASS");
// api/specialist initializes a rate-limit cleanup timer on import. The test has
// no async work left, so finish explicitly instead of keeping the build alive.
process.exit(0);
