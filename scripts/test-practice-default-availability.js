import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectVisibleAvailability } from "../lib/my-practice/booking-handler.js";
import { slotsForServiceDay } from "../lib/my-practice/booking-utils.js";

const defaults = Array.from({ length: 7 }, (_, index) => ({
  id: `day-${index + 1}`,
  weekday: index + 1,
  exception_date: null,
  start_time: "09:00",
  end_time: "18:00",
  is_active: true,
  created_at: `2026-11-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
}));
assert.equal(selectVisibleAvailability(defaults).length, 7);

const mondayOff = defaults.map((row) => row.weekday === 1 ? { ...row, is_active: false } : row);
const visibleOff = selectVisibleAvailability(mondayOff);
assert.equal(visibleOff.length, 7);
assert.equal(visibleOff.find((row) => row.weekday === 1)?.is_active, false);

const resetMonday = [
  { ...defaults[0], id: "old", is_active: false, created_at: "2026-11-01T00:00:00Z" },
  { ...defaults[0], id: "new", is_active: true, created_at: "2026-11-02T00:00:00Z" },
  ...defaults.slice(1),
];
assert.equal(selectVisibleAvailability(resetMonday).filter((row) => row.weekday === 1).length, 1);
assert.equal(selectVisibleAvailability(resetMonday).find((row) => row.weekday === 1)?.id, "new");

const withExceptions = [
  ...defaults,
  { id: "exception-active", weekday: 0, exception_date: "2026-11-23", start_time: "00:00", end_time: "23:59", is_active: true },
  { id: "exception-removed", weekday: 0, exception_date: "2026-11-24", start_time: "00:00", end_time: "23:59", is_active: false },
];
assert.equal(selectVisibleAvailability(withExceptions).length, 8);
assert(selectVisibleAvailability(withExceptions).some((row) => row.id === "exception-active"));
assert(!selectVisibleAvailability(withExceptions).some((row) => row.id === "exception-removed"));

const service = { duration_min: 60 };
const monday = "2026-11-23";
const openSlots = slotsForServiceDay({ service, availabilityRows: defaults, bookingsRows: [], day: monday });
assert.equal(openSlots.length, 9);
const bookedSlots = slotsForServiceDay({
  service,
  availabilityRows: defaults,
  bookingsRows: [{ status: "confirmed", starts_at: `${monday}T09:00:00.000Z`, ends_at: `${monday}T10:00:00.000Z` }],
  day: monday,
});
assert.equal(bookedSlots.length, 8);
assert(!bookedSlots.some((slot) => slot.start_time === "09:00"));
assert.equal(slotsForServiceDay({ service, availabilityRows: withExceptions, bookingsRows: [], day: monday }).length, 0);

const migration = readFileSync(new URL("../supabase/migrations/20261121081127_a381_default_practice_availability.sql", import.meta.url), "utf8");
assert(migration.includes("pg_advisory_xact_lock"));
assert(migration.includes("generate_series(1, 7)"));
assert(migration.includes("organization_id is not distinct from p_organization_id"));
assert(migration.includes("grant execute on function public.ensure_default_practice_availability"));
assert(migration.includes("grant execute on function public.reset_default_practice_availability"));

const handler = readFileSync(new URL("../lib/my-practice/booking-handler.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../src/pages/specialist/PracticeBookingPanel.jsx", import.meta.url), "utf8");
assert(handler.includes('rpc("ensure_default_practice_availability"'));
assert(handler.includes('rpc("reset_default_practice_availability"'));
assert(handler.includes('action === "setPracticeAvailabilityStatus"'));
assert(ui.includes("Сделать выходным"));
assert(ui.includes("Добавить исключение"));
assert(ui.includes("Восстановить 09:00–18:00 на всю неделю"));
assert(ui.includes("window.confirm"));

console.log("Practice default availability: PASS (seven days, off-days, exceptions, reset, busy slots)");
