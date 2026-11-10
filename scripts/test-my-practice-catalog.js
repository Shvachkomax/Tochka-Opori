import assert from "node:assert/strict";
import {
 initialDraftCatalog,addDraftOffer,updateDraftOffer,setDraftOfferArchived,
 restoreDraftCatalog,countActiveOffers
} from "../lib/my-practice/catalog-draft.js";
import {filterOffers,DEMO_CLINICS} from "../lib/my-practice/pilot-data.js";

const base=initialDraftCatalog();
assert.equal(base.length,3);
assert.equal(countActiveOffers(base),5);
assert.equal(filterOffers(base).length,5);
const withAdded=addDraftOffer(base,{clinicId:"demo-clinic-b",name:"  Консультация   врача  ",format:"offline",priceRub:1900,minutes:45});
assert.equal(countActiveOffers(withAdded),6);
assert.equal(withAdded[1].offers.at(-1).name,"Консультация врача");
assert.equal(base[1].offers.length,2,"seed must not be mutated");
const added=withAdded[1].offers.at(-1);
const revised=updateDraftOffer(withAdded,{clinicId:"demo-clinic-b",offerId:added.id,name:"Повторная консультация",format:"online",priceRub:2700,minutes:30});
assert.equal(revised[1].offers.at(-1).priceRub,2700);
assert.throws(()=>updateDraftOffer(revised,{clinicId:"demo-clinic-a",offerId:added.id,name:"Другой приём",format:"offline",priceRub:500,minutes:45}),/найдена/);
const archived=setDraftOfferArchived(revised,{clinicId:"demo-clinic-b",offerId:added.id,archived:true});
assert.equal(countActiveOffers(archived),5);
assert.equal(filterOffers(archived).length,5);
const restored=setDraftOfferArchived(archived,{clinicId:"demo-clinic-b",offerId:added.id,archived:false});
assert.equal(countActiveOffers(restored),6);
const loaded=restoreDraftCatalog(JSON.stringify(restored));
assert.equal(countActiveOffers(loaded),6);
assert.equal(loaded[1].offers.at(-1).name,"Повторная консультация");
const forged=JSON.parse(JSON.stringify(restored));
forged[1].bookingUrl="https://malicious.example/booking";
forged[1].verifiedForPublication=true;
const safe=restoreDraftCatalog(JSON.stringify(forged));
assert.equal(safe[1].bookingUrl,null);
assert.equal(safe[1].verifiedForPublication,false);
assert.deepEqual(restoreDraftCatalog("bad-json"),initialDraftCatalog());
const deleted=JSON.parse(JSON.stringify(restored));
deleted[0].offers=[];
assert.deepEqual(restoreDraftCatalog(JSON.stringify(deleted)),initialDraftCatalog());
for(const invalid of [
 {clinicId:"nonexistent",name:"Приём",format:"offline",priceRub:500,minutes:30},
 {clinicId:"demo-clinic-b",name:"X",format:"offline",priceRub:500,minutes:30},
 {clinicId:"demo-clinic-b",name:"Проверка",format:"online",priceRub:-1,minutes:30},
 {clinicId:"demo-clinic-b",name:"Проверка",format:"online",priceRub:500,minutes:1},
 {clinicId:"demo-clinic-b",name:"Проверка",format:"fax",priceRub:500,minutes:30}
]) assert.throws(()=>addDraftOffer(base,invalid));
for(const c of DEMO_CLINICS)assert.equal(c.bookingUrl,null);

// Регрессия: редактирование ранее существующей услуги прямо в каталоге,
// не только новой, с последующим сохранением черновика.
const seeded = base[0].offers[0];
const editedSeed = updateDraftOffer(base, {
  clinicId:"demo-clinic-a",offerId:seeded.id,
  name:"Первичная консультация — уточнённая",
  format:"offline",priceRub:"5700",minutes:"50",
});
assert.equal(editedSeed[0].offers[0].name,"Первичная консультация — уточнённая");
assert.equal(editedSeed[0].offers[0].priceRub,5700);
assert.equal(editedSeed[0].offers[0].minutes,50);
assert.equal(base[0].offers[0].priceRub,4500,"Исходный каталог не должен изменяться");
const editedLoaded = restoreDraftCatalog(JSON.stringify(editedSeed));
assert.equal(editedLoaded[0].offers[0].priceRub,5700);
assert.equal(filterOffers(editedLoaded,{clinicId:"demo-clinic-a"})[0].name,
  "Первичная консультация — уточнённая");
assert.throws(()=>updateDraftOffer(base,{
  clinicId:"demo-clinic-b",offerId:seeded.id,
  name:"Чужая услуга",format:"online",priceRub:1000,minutes:45,
}),/не найдена/);

console.log("My Practice catalog drafts: PASS (validation, original offer editing, permissions isolation, archive, restore)");
