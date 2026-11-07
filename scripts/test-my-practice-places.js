import assert from "node:assert/strict";
import {
 initialDraftCatalog,addDraftPlace,updateDraftPlace,removeDraftPlace,
 addDraftOffer,restoreDraftCatalog,countActiveOffers,
} from "../lib/my-practice/catalog-draft.js";
import {
 initialScheduleDraft,addScheduleEntry,restoreScheduleDraft,
} from "../lib/my-practice/schedule-draft.js";
import {
 emptyPaidDemo,addPaidDemoSlot,
} from "../lib/my-practice/paid-booking-demo.js";
import {filterOffers} from "../lib/my-practice/pilot-data.js";
import {readFileSync} from "node:fs";

const base=initialDraftCatalog(),schedule=initialScheduleDraft(base);
const added=addDraftPlace(base,{name:"  Учебный   частный кабинет  ",address:"  Район   Запад "});
assert.equal(added.length,4);
const place=added.at(-1);
assert.equal(place.id,"demo-place-1");
assert.equal(place.name,"Учебный частный кабинет");
assert.equal(place.address,"Район Запад");
assert.equal(place.bookingUrl,null);
assert.equal(place.verifiedForPublication,false);
assert.equal(place.offers.length,0);
assert.equal(countActiveOffers(added),5);
assert.equal(base.length,3,"Original catalog unchanged");
assert.throws(()=>addDraftPlace(added,{name:"учебный частный кабинет"}),/существует/);
assert.throws(()=>addDraftPlace(added,{name:"  "}),/Название/);
const renamed=updateDraftPlace(added,{placeId:place.id,name:"Частная практика — тест",address:"Учебное место"});
assert.equal(renamed.at(-1).name,"Частная практика — тест");
assert.equal(added.at(-1).name,"Учебный частный кабинет");
assert.equal(renamed[0].bookingUrl,null);
const withNewOffer=addDraftOffer(renamed,{clinicId:place.id,name:"Учебная консультация",format:"offline",priceRub:4800,minutes:45});
assert.equal(filterOffers(withNewOffer,{clinicId:place.id}).length,1);
const fromStorage=restoreDraftCatalog(JSON.stringify(withNewOffer));
assert.deepEqual(fromStorage,withNewOffer);
const event={kind:"busy",clinicId:place.id,day:"2026-11-16",start:"10:00",end:"12:00",reason:"clinic"};
const withSchedule=addScheduleEntry(schedule,event,withNewOffer);
assert.equal(withSchedule.length,6);
assert.equal(restoreScheduleDraft(JSON.stringify(withSchedule),withNewOffer).length,6);
const removed=removeDraftPlace(withNewOffer,place.id,{schedule:withSchedule,paidSlots:[]});
assert.equal(removed.catalog.length,3);
assert.equal(removed.schedule.length,5);
assert(!removed.schedule.some(e=>e.clinicId===place.id));
assert.deepEqual(restoreDraftCatalog(JSON.stringify(removed.catalog)),base);
assert.equal(initialScheduleDraft(removed.catalog).length,5);
const deletedSeed=removeDraftPlace(base,"demo-clinic-a",{schedule,paidSlots:[]});
assert.equal(deletedSeed.catalog.length,2);
assert.equal(deletedSeed.schedule.length,3);
assert.deepEqual(restoreDraftCatalog(JSON.stringify(deletedSeed.catalog)),deletedSeed.catalog);
assert.deepEqual(initialScheduleDraft(deletedSeed.catalog).map(x=>x.id),deletedSeed.schedule.map(x=>x.id));
assert.deepEqual(restoreScheduleDraft(JSON.stringify(deletedSeed.schedule),deletedSeed.catalog),deletedSeed.schedule);
const paid=addPaidDemoSlot(emptyPaidDemo(),{
 id:"paid-new-place",clinicId:place.id,serviceId:withNewOffer.at(-1).offers[0].id,
 day:"2026-11-18",start:"09:00",end:"09:45",priceKopecks:480000,
},withSchedule);
assert.equal(paid.slots[0].clinicId,place.id);
assert.throws(()=>removeDraftPlace(withNewOffer,place.id,{schedule:withSchedule,paidSlots:paid.slots}),/платные слоты/);
const forged=JSON.parse(JSON.stringify(withNewOffer));
forged.at(-1).verifiedForPublication=true;
forged.at(-1).bookingUrl="https://not-approved.example/book";
const safe=restoreDraftCatalog(JSON.stringify(forged));
assert.equal(safe.at(-1).verifiedForPublication,false);
assert.equal(safe.at(-1).bookingUrl,null);
const duplicate=JSON.parse(JSON.stringify(withNewOffer));
duplicate.push({...duplicate.at(-1),id:"demo-place-2",name:duplicate.at(-1).name});
assert.deepEqual(restoreDraftCatalog(JSON.stringify(duplicate)),base);
assert.deepEqual(restoreDraftCatalog("garbage"),base);
const source=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const pilot=source("src/pages/specialist/MyPracticePilot.jsx");
const places=source("src/pages/specialist/MyPracticePlacesEditor.jsx");
const calendar=source("src/pages/specialist/MyPracticeCalendar.jsx");
assert(pilot.includes("<MyPracticePlacesEditor catalog={catalog}"));
assert(pilot.includes("sessionStorage.setItem(catalogKey"));
assert(pilot.includes("sessionStorage.setItem(scheduleKey"));
assert(pilot.includes("{catalog.length}</strong><span>места приёма"));
assert(places.includes("Изменить") && places.includes("Удалить") && places.includes("+ Добавить место"));
assert(calendar.includes("catalog.map(c=><option"));
console.log("My Practice places: PASS (add, rename, delete/cascade, preservation, storage, schedule, paid-slot guard, UI)");
