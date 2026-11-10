// A1 checks: FullCalendar (MIT free core only) + availability logic.
// Run: node scripts/test-my-practice-fullcalendar.js
import assert from "node:assert/strict";
import fs from "node:fs";
import {freeIntervalsForDay, freeSlotsForDay, toCalendarEvents, isWorkingDay} from "../lib/my-practice/availability.js";
import {addScheduleEntry, entriesForWeek} from "../lib/my-practice/schedule-draft.js";
import {initialDraftCatalog} from "../lib/my-practice/catalog-draft.js";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => fs.readFileSync(root + p, "utf8");
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));

// 1. Only free MIT packages are present; no Premium/Scheduler.
assert.ok(pkg.dependencies["@fullcalendar/react"], "FullCalendar react must be a direct dependency");
assert.strictEqual(lock.packages["node_modules/@fullcalendar/react"].license, "MIT");
assert.strictEqual(lock.packages["node_modules/@fullcalendar/core"].license, "MIT");
assert.strictEqual(lock.packages["node_modules/@full-ui/headless-calendar"].license, "MIT");
assert.strictEqual(lock.packages["node_modules/temporal-polyfill"].license, "MIT");
for (const key of Object.keys(pkg.dependencies)) {
  assert.ok(!/premium|scheduler/i.test(key), `no Premium package allowed: ${key}`);
}
const calSrc = read("src/pages/specialist/MyPracticeCalendar.jsx");
const importLines = calSrc.split("\n").filter((l) => l.trimStart().startsWith("import"));
assert.ok(!/premium|scheduler/i.test(importLines.join("\n")), "no Premium imports in calendar source");
assert.ok(calSrc.includes("@fullcalendar/react"), "calendar imports FullCalendar");
assert.ok(calSrc.includes("locales/ru"), "RU locale is used");

// 2. Weekend is not a working day for reference free intervals.
assert.equal(isWorkingDay("2026-11-14"), false, "Saturday 2026-11-14 is not a working day");
assert.equal(isWorkingDay("2026-11-09"), true, "Monday 2026-11-09 is a working day");

// 3. Booking through the existing validator still blocks overlapping free time.
const catalog = initialDraftCatalog();
const monday = "2026-11-09";
let entries = [
  {id:"busy-1", clinicId: catalog[0].id, day: monday, start:"10:00", end:"12:00", kind:"busy", reason:"clinic", status:"active", serviceId:null, patientAlias:null, source:"manual"},
];
const free = freeIntervalsForDay(monday, entries);
assert.deepEqual(free, [{start:"09:00",end:"10:00"},{start:"12:00",end:"18:00"}], "free gaps subtract busy blocks");
const slots = freeSlotsForDay(monday, entries, {durationMin: 60});
assert.ok(slots.includes("09:00") && slots.includes("12:00"), "slots start at gap edges");
assert.ok(!slots.includes("10:00"), "no slot starts inside busy block");

// 4. Cancelled bookings do not block free time (mirrors isActiveScheduleEvent).
const withCancelled = [...entries, {id:"b-1", clinicId: catalog[0].id, day: monday, start:"14:00", end:"15:00", kind:"booking", status:"cancelled", serviceId: catalog[0].offers[0].id, patientAlias:"demo-p1", source:"manual"}];
assert.deepEqual(freeIntervalsForDay(monday, withCancelled), free, "cancelled booking stays free");

// 5. Multi-clinic without Premium: filter selects events; clinic name is in the title.
const week = entriesForWeek(entries, monday, "all");
const evts = toCalendarEvents(week, catalog, {includeFree: true, monday, days: 7});
assert.ok(evts.some(e=>e.extendedProps?.entryId==="busy-1"), "busy entry maps to a calendar event");
assert.ok(evts.some(e=>e.rendering==="background"), "free intervals render as background events");
assert.ok(evts.every(e=>/^2026-11-/.test(e.start)), "all events are within the visible week");
assert.ok(evts.filter(e=>e.extendedProps?.kind!=="free").every(e=>!e.resourceId), "no resourceId — resources are Premium");
assert.ok(evts.some(e=>e.title.includes(catalog[0].name)), "clinic name is shown in event title");
const serverEvents = toCalendarEvents([
  { id: "server-booking-1", day: monday, start: "10:00", end: "11:00", kind: "booking", status: "confirmed", source: "server", title: "Приём · Клиника А" },
], catalog);
assert.equal(serverEvents[0].title, "Приём · Клиника А", "server booking title is preserved in FullCalendar");
assert.ok(!calSrc.includes("resources={resources}") && !calSrc.includes("resourceId:"), "calendar does not use Premium resources");
assert.ok(calSrc.includes("Выберите клинику"), "explicit clinic choice in the form when filter is all");

// 7. Overlap rule intact: second overlapping entry is rejected by the same validator.
entries = addScheduleEntry(entries, {kind:"booking", clinicId: catalog[0].id, day: monday, start:"13:00", end:"14:00", status:"pending", serviceId: catalog[0].offers[0].id, patientAlias:"demo-p1"}, catalog);
assert.throws(
  () => addScheduleEntry(entries, {kind:"booking", clinicId: catalog[1].id, day: monday, start:"13:30", end:"14:30", status:"pending", serviceId: catalog[1].offers[0]?.id, patientAlias:"demo-p2"}, catalog),
  /занято/,
  "overlap across clinics is still rejected",
);

console.log("test-my-practice-fullcalendar: OK");
