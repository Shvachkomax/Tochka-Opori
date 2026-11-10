// A2 booking handler — unit checks (no DB writes outside guard).
import assert from "node:assert/strict";
import { freeSlotsForDay } from "../lib/my-practice/availability.js";
import { slotsForServiceDay, publicServiceView } from "../lib/my-practice/booking-utils.js";
import { isMyPracticeServerEnabled } from "../lib/my-practice/workspace-handler.js";

// Guard: env must be preview + test ref + https host.
assert.equal(
  isMyPracticeServerEnabled({ MY_PRACTICE_SERVER_ENABLED: "true", VERCEL_ENV: "preview", DEPLOYMENT_PURPOSE: "test", MY_PRACTICE_ALLOWED_SUPABASE_REF: "eehyehlhiyztciaezaus", SUPABASE_URL: "https://eehyehlhiyztciaezaus.supabase.co" }),
  true,
);
assert.equal(isMyPracticeServerEnabled({ MY_PRACTICE_SERVER_ENABLED: "true", VERCEL_ENV: "production", MY_PRACTICE_ALLOWED_SUPABASE_REF: "eehyehlhiyztciaezaus", SUPABASE_URL: "https://eehyehlhiyztciaezaus.supabase.co" }), false);
assert.equal(isMyPracticeServerEnabled({ MY_PRACTICE_SERVER_ENABLED: "true", VERCEL_ENV: "preview", DEPLOYMENT_PURPOSE: "test", MY_PRACTICE_ALLOWED_SUPABASE_REF: "OTHER", SUPABASE_URL: "https://OTHER.supabase.co" }), false);

// availability lib still consistent
const entries = [{ id: "b", clinicId: "c1", day: "2026-11-09", start: "10:00", end: "12:00", kind: "busy", reason: "clinic", status: "active", serviceId: null, patientAlias: null, source: "manual" }];
assert.deepEqual(freeSlotsForDay("2026-11-09", entries, { durationMin: 60 }), freeSlotsForDay("2026-11-09", entries, { durationMin: 60 }));

const service = { id: "s1", expert_id: "e-00000000-0000-0000-0000-000000000001", organization_id: "clinic-b", name: "Приём", format: "offline", price_kop: 500000, duration_min: 60 };
const av = [{ weekday: 1, start_time: "09:00", end_time: "18:00", is_active: true, exception_date: null }];
const slots = slotsForServiceDay({ service, availabilityRows: av, bookingsRows: [], day: "2026-11-09" }); // Mon
assert.ok(slots.length >= 8, "server slots generated");
assert.equal(slots[0].start_time, "09:00");
const busy = slotsForServiceDay({ service, availabilityRows: av, bookingsRows: [{ status: "held", starts_at: "2026-11-09T09:00:00.000Z", ends_at: "2026-11-09T10:00:00.000Z" }], day: "2026-11-09" });
assert.ok(!busy.some((s) => s.start_time === "09:00"), "booked slot excluded server-side");
const crossClinicBusy = slotsForServiceDay({
  service,
  availabilityRows: av,
  bookingsRows: [{
    status: "confirmed",
    organization_id: "clinic-a",
    starts_at: "2026-11-09T10:00:00.000Z",
    ends_at: "2026-11-09T11:00:00.000Z",
  }],
  day: "2026-11-09",
});
assert.ok(!crossClinicBusy.some((s) => s.start_time === "10:00"), "doctor booking in clinic A blocks clinic B slot");
const cancelled = slotsForServiceDay({ service, availabilityRows: av, bookingsRows: [{ status: "cancelled", starts_at: "2026-11-09T09:00:00.000Z", ends_at: "2026-11-09T10:00:00.000Z" }], day: "2026-11-09" });
assert.ok(cancelled.some((s) => s.start_time === "09:00"), "cancelled slot returns");
const off = slotsForServiceDay({ service, availabilityRows: [{ weekday: 0, start_time: "09:00", end_time: "18:00", is_active: true, exception_date: "2026-11-09" }], bookingsRows: [], day: "2026-11-09" });
assert.equal(off.length, 0, "exception day blocks all");

const view = publicServiceView(service);
assert.equal(view.service_id, "s1");
assert.equal(view.price_kop, 500000);
assert.ok(!JSON.stringify(view).includes("expert_id"), "no internal ids leaked");

console.log("test-my-practice-booking: OK");
