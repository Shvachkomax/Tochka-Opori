import assert from "node:assert/strict";
import {initialDraftCatalog} from "../lib/my-practice/catalog-draft.js";
import {
  SCHEDULE_DRAFT_STORAGE_KEY, PATIENT_ALIASES, BOOKING_STATUSES,
  isValidScheduleDay, timeInMinutes, endForDuration, initialScheduleDraft,
  isActiveScheduleEvent, addScheduleEntry, updateScheduleEntry, removeScheduleEntry,
  entriesForWeek, restoreScheduleDraft,
} from "../lib/my-practice/schedule-draft.js";
const catalog=initialDraftCatalog();
const seed=initialScheduleDraft();
assert.equal(SCHEDULE_DRAFT_STORAGE_KEY,"my-practice:synthetic-schedule:v1");
assert.equal(seed.length,5);
assert(seed.every(e=>e.kind==="busy"&&e.source==="manual"));
assert(isValidScheduleDay("2026-11-09"));
assert(!isValidScheduleDay("2026-02-30"));
assert(!isValidScheduleDay("2026-99-99"));
assert.equal(timeInMinutes("11:30"),690);
assert.equal(endForDuration("11:30",45),"12:15");
assert.throws(()=>endForDuration("23:30",60),/полуночи/);
assert.equal(entriesForWeek(seed,"2026-11-09").length,5);
assert.equal(entriesForWeek(seed,"2026-11-16").length,0);
assert.equal(entriesForWeek(seed,"2026-11-09","demo-clinic-a").length,2);
const revisedExisting=updateScheduleEntry(seed,seed[0].id,{
  ...seed[0],start:"10:00",end:"13:30",reason:"personal",
},catalog);
assert.equal(revisedExisting[0].end,"13:30");
assert.equal(revisedExisting[0].reason,"personal");
assert.equal(seed[0].end,"14:00","The pre-existing demo event is not mutated");
const remoteCopy={...seed[0],source:"clinic"};
assert.throws(()=>updateScheduleEntry([remoteCopy],remoteCopy.id,{
  ...remoteCopy,start:"10:00",end:"13:00",
},catalog),/клинике/);

const busyA={kind:"busy",clinicId:"demo-clinic-c",day:"2026-11-16",start:"11:00",end:"12:00",reason:"personal"};
let items=addScheduleEntry(seed,busyA,catalog);
assert.equal(items.length,6);
assert.throws(()=>addScheduleEntry(items,{...busyA,clinicId:"demo-clinic-b",start:"11:30",end:"12:30"},catalog),/занято/);
items=updateScheduleEntry(items,items.at(-1).id,{...busyA,day:"2026-11-17",reason:"vacation"},catalog);
assert.equal(items.at(-1).day,"2026-11-17");
assert.equal(items.at(-1).reason,"vacation");
assert.throws(()=>updateScheduleEntry(items,"unknown",busyA,catalog),/не найдено/);
const booking={kind:"booking",clinicId:"demo-clinic-b",day:"2026-11-18",start:"10:00",end:"10:30",serviceId:"b-online",patientAlias:"demo-p2",status:"pending"};
items=addScheduleEntry(items,booking,catalog);
assert.equal(items.at(-1).patientAlias,PATIENT_ALIASES[1].id);
const bookingId=items.at(-1).id;
assert(isActiveScheduleEvent(items.at(-1)));
assert.throws(()=>addScheduleEntry(items,{...booking,start:"10:15",end:"10:45",clinicId:"demo-clinic-a",serviceId:"a-first"},catalog),/занято/);
items=updateScheduleEntry(items,bookingId,{...booking,status:"confirmed",start:"12:00",end:"13:00"},catalog);
assert.equal(items.at(-1).status,"confirmed");
items=updateScheduleEntry(items,bookingId,{...booking,status:"cancelled",start:"12:00",end:"13:00"},catalog);
assert(!isActiveScheduleEvent(items.at(-1)));
items=addScheduleEntry(items,{...booking,clinicId:"demo-clinic-b",start:"12:00",end:"13:00"},catalog);
assert.equal(items.at(-1).status,"pending");
assert.throws(()=>updateScheduleEntry(items,bookingId,{...booking,status:"confirmed",start:"12:00",end:"13:00"},catalog),/занято/);
const restored=restoreScheduleDraft(JSON.stringify(items),catalog);
assert.equal(restored.length,items.length);
assert.deepEqual(restored,items);
const forged=JSON.parse(JSON.stringify(items));
forged[0].source="clinic";
assert.deepEqual(restoreScheduleDraft(JSON.stringify(forged),catalog),seed);
const badAlias=JSON.parse(JSON.stringify(items));badAlias.at(-1).patientAlias="real-person";
assert.deepEqual(restoreScheduleDraft(JSON.stringify(badAlias),catalog),seed);
const duplicate=JSON.parse(JSON.stringify(items));duplicate.push(duplicate[0]);
assert.deepEqual(restoreScheduleDraft(JSON.stringify(duplicate),catalog),seed);
assert.deepEqual(restoreScheduleDraft("not-json",catalog),seed);
assert.throws(()=>addScheduleEntry(seed,{...booking,serviceId:"a-first"},catalog),/не принадлежит/);
assert.throws(()=>addScheduleEntry(seed,{...busyA,start:"12:00",end:"12:00"},catalog),/позже/);
assert.throws(()=>addScheduleEntry(seed,{...booking,patientAlias:"Иван Иванов"},catalog),/вымышленного/);
items=removeScheduleEntry(items,bookingId);
assert(!items.some(e=>e.id===bookingId));
assert.equal(BOOKING_STATUSES.confirmed,"Подтверждена");
console.log("My Practice schedule drafts: PASS (editing seed, bookings, conflicts, status, storage, no PII)");
