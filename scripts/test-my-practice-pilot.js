import assert from "node:assert/strict";
import { DEMO_DOCTOR, DEMO_CLINICS, DEMO_BUSY_BLOCKS, filterOffers, toMondayUTC, addDaysUTC, busyBlocksForWeek, canPublishBookingLink } from "../lib/my-practice/pilot-data.js";
assert.equal(DEMO_DOCTOR.id, "demo-doctor-01");
assert.equal(DEMO_CLINICS.length, 3);
assert.equal(filterOffers(DEMO_CLINICS).length, 5);
assert.equal(filterOffers(DEMO_CLINICS, { clinicId:"demo-clinic-a" }).length, 2);
assert.equal(filterOffers(DEMO_CLINICS, { format:"online" }).length, 1);
assert.equal(filterOffers(DEMO_CLINICS, { clinicId:"demo-clinic-a", format:"online" }).length, 0);
assert.equal(toMondayUTC("2026-11-11"), "2026-11-09");
assert.equal(addDaysUTC("2026-11-09", 7), "2026-11-16");
assert.equal(busyBlocksForWeek(DEMO_BUSY_BLOCKS, "2026-11-09").length, 5);
assert.equal(busyBlocksForWeek(DEMO_BUSY_BLOCKS, "2026-11-16").length, 0);
assert.equal(busyBlocksForWeek(DEMO_BUSY_BLOCKS, "2026-11-09", "demo-clinic-b").length, 2);
for (const block of DEMO_BUSY_BLOCKS) {
  for (const field of ["patient","owner","diagnos","phone","email","client"]) {
    assert(!Object.keys(block).some(key => key.includes(field)), "Данные пациента обнаружены");
  }
}
for (const spec of [
  {},
  { clinicApproved:false, doctorAuthorized:true, bookingUrl:"https://clinic.example/book" },
  { clinicApproved:true, doctorAuthorized:false, bookingUrl:"https://clinic.example/book" },
  { clinicApproved:true, doctorAuthorized:true, bookingUrl:"http://clinic.example/book" },
  { clinicApproved:true, doctorAuthorized:true, bookingUrl:"javascript:alert(1)" },
]) assert.equal(canPublishBookingLink(spec), false);
assert.equal(canPublishBookingLink({ clinicApproved:true, doctorAuthorized:true, bookingUrl:"https://clinic.example/book" }), true);
assert(DEMO_CLINICS.every(c => !c.bookingUrl && !c.verifiedForPublication));
console.log("Моя практика: данные, фильтры, календарь и запреты записи — PASS");
