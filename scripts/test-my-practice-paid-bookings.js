import assert from "node:assert/strict";
import {
 emptyPaidDemo,addPaidDemoSlot,beginPaidDemoHold,simulatePaidDemoPayment,
 cancelPaidDemoBooking,getBookingStatus,isAvailable,
 offerToLink,offerFromLink,restorePaidDemo,normalizePaidDemo,
 PAID_DEMO_HOLD_MS,settlementForBooking,
} from "../lib/my-practice/paid-booking-demo.js";

const now=1794124800000; // synthetic fixed clock
const offer={id:"paid-1",clinicId:"demo-clinic-a",serviceId:"a-first",
 day:"2026-11-17",start:"09:00",end:"10:00",priceKopecks:500000};
const calendar=[{id:"busy",day:"2026-11-17",start:"11:00",end:"13:00",kind:"busy"}];
const empty=emptyPaidDemo();
let state=addPaidDemoSlot(empty,offer,calendar);
assert.equal(state.slots.length,1);
assert.equal(state.slots[0].executor.includes("не проверен"),true);
assert.deepEqual(offerFromLink(offerToLink(state.slots[0])),state.slots[0]);
assert.throws(()=>addPaidDemoSlot(state,{...offer,id:"paid-2",start:"09:30",end:"10:30"},calendar),/пересекается/);
assert.throws(()=>addPaidDemoSlot(state,{...offer,id:"paid-2",start:"12:00",end:"13:00"},calendar),/занят/);
assert.equal(isAvailable(state,"paid-1",now),true);
state=beginPaidDemoHold(state,"paid-1","res-1",now);
assert.equal(getBookingStatus(state.bookings[0],now),"held");
assert.equal(isAvailable(state,"paid-1",now),false);
assert.throws(()=>beginPaidDemoHold(state,"paid-1","res-2",now),/занят/);
assert.throws(()=>simulatePaidDemoPayment(state,"res-1",now+PAID_DEMO_HOLD_MS),/истекла/);
state=simulatePaidDemoPayment(state,"res-1",now+1000);
assert.equal(state.bookings[0].status,"simulated_paid");
assert.equal(isAvailable(state,"paid-1",now+PAID_DEMO_HOLD_MS),false);
const settled=settlementForBooking(state,"res-1");
assert.equal(settled.feeKopecks,100000);
assert.equal(settled.executorShareKopecks,400000);
assert.equal(settled.isSimulatedPayment,true);
assert.throws(()=>simulatePaidDemoPayment(state,"res-1",now+2000),/истекла/);
state=cancelPaidDemoBooking(state,"res-1",now+2000);
assert.equal(state.bookings[0].status,"simulated_refunded");
assert.equal(isAvailable(state,"paid-1",now+3000),true);
assert.equal(settlementForBooking(state,"res-1").isSimulatedRefund,true);
assert.throws(()=>cancelPaidDemoBooking(state,"res-1",now+4000),/повторно/);
const renewed=beginPaidDemoHold(state,"paid-1","res-2",now+5000);
assert.equal(renewed.bookings.at(-1).status,"held");
assert.deepEqual(restorePaidDemo(JSON.stringify(renewed)),renewed);
const expired=beginPaidDemoHold(renewed,"paid-1","res-3",now+PAID_DEMO_HOLD_MS+6000);
assert.equal(expired.bookings[1].status,"expired");
assert.equal(expired.bookings.at(-1).id,"res-3");
const tampered=structuredClone(renewed);
tampered.slots[0].executor="Доктор Иванов, лицензия";
assert.deepEqual(restorePaidDemo(JSON.stringify(tampered)),empty);
const malicious=structuredClone(renewed);
malicious.bookings[0].patientName="Петрова";
assert.deepEqual(restorePaidDemo(JSON.stringify(malicious)),empty);
assert.throws(()=>offerFromLink("%7B%22name%22%3A%22patient%22%7D"),/Некорректный|Неподдерживаемые/);
assert.deepEqual(normalizePaidDemo(renewed),renewed);
console.log("Paid practice booking demo: PASS (slots, hold, expiry, simulation, fee, cancellation and no PII)");
