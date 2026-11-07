// Справочные места работы и черновики услуг — только синтетика в браузере.
// Название места не означает подтверждение клиники, лицензии или права на медицинские услуги.
import {DEMO_CLINICS} from "./pilot-data.js";
export const DRAFT_STORAGE_KEY="my-practice:synthetic-catalog:v1";
const MAX_PLACES=20,MAX_OFFERS_PER_PLACE=30;
const FORMATS=new Set(["online","offline"]);
const ID=/^[A-Za-z0-9_-]{1,100}$/;
const COLOR="#7A9485";
const seedIds=new Set(DEMO_CLINICS.map(x=>x.id));
const initialOfferIds=new Set(DEMO_CLINICS.flatMap(x=>x.offers.map(o=>o.id)));

export function initialDraftCatalog(){
 return DEMO_CLINICS.map(c=>({...c,offers:c.offers.map(o=>({...o,status:"active"}))}));
}
function cleanText(value,min,max,label){
 const s=typeof value==="string"?value.trim().replace(/\s+/g," "):"";
 if(s.length<min||s.length>max||/[\u0000-\u001f\u007f]/u.test(s))throw Error(label+": длина от "+min+" до "+max+" символов.");
 return s;
}
function validatePlaceName(name,catalog,except=null){
 const normalized=cleanText(name,3,80,"Название места работы");
 if(catalog.some(c=>c.id!==except && c.name.toLocaleLowerCase("ru-RU")===normalized.toLocaleLowerCase("ru-RU")))
   throw Error("Место с таким названием уже существует.");
 return normalized;
}
function validateAddress(address){return address?cleanText(address,0,120,"Описание/адрес"):"";}
function validateOffer(o){
 const name=cleanText(o?.name,3,100,"Название услуги");
 const minutes=Number(o?.minutes),priceRub=Number(o?.priceRub);
 if(!FORMATS.has(o?.format))throw Error("Выберите формат услуги.");
 if(!Number.isInteger(minutes)||minutes<15||minutes>240)throw Error("Длительность 15–240 минут.");
 if(!Number.isInteger(priceRub)||priceRub<0||priceRub>200000)throw Error("Цена 0–200 000 ₽.");
 return {name,format:o.format,minutes,priceRub};
}
function getPlace(catalog,id){
 const place=catalog.find(c=>c.id===id);
 if(!place)throw Error("Место работы не найдено.");
 return place;
}
export function addDraftPlace(catalog,{name,address=""}){
 if(!Array.isArray(catalog)||catalog.length>=MAX_PLACES)throw Error("В демо можно добавить до 20 мест работы.");
 const normalized=validatePlaceName(name,catalog);
 const desc=validateAddress(address);
 let i=1,used=new Set(catalog.map(x=>x.id));
 while(used.has("demo-place-"+i))i++;
 return [...catalog,{id:"demo-place-"+i,name:normalized,address:desc,color:COLOR,bookingUrl:null,
   verifiedForPublication:false,offers:[]}];
}
export function updateDraftPlace(catalog,{placeId,name,address=""}){
 getPlace(catalog,placeId);
 const normalized=validatePlaceName(name,catalog,placeId),desc=validateAddress(address);
 return catalog.map(c=>c.id===placeId?{...c,name:normalized,address:desc}:c);
}
// Удаление места уничтожает только связанные локальные учебные услуги/события.
// Если когда-либо создана платная демо-ссылка, не удаляем её историю тихо.
export function removeDraftPlace(catalog,placeId,{schedule=[],paidSlots=[]}={}){
 getPlace(catalog,placeId);
 if(paidSlots.some(x=>x.clinicId===placeId))throw Error(
   "Есть учебные платные слоты этого места. Сначала очистите их во вкладке «Платные приёмы».");
 return {catalog:catalog.filter(c=>c.id!==placeId),schedule:schedule.filter(e=>e.clinicId!==placeId)};
}
export function addDraftOffer(catalog,{clinicId,...fields}){
 const place=getPlace(catalog,clinicId),offer=validateOffer(fields);
 if(place.offers.length>=MAX_OFFERS_PER_PLACE)throw Error("Не более 30 услуг на место.");
 const used=new Set(catalog.flatMap(c=>c.offers.map(o=>o.id)));
 let i=1;while(used.has("demo-added-"+i))i++;
 return catalog.map(c=>c.id===clinicId?{...c,offers:[...c.offers,{id:"demo-added-"+i,...offer,status:"active"}]}:c);
}
export function updateDraftOffer(catalog,{clinicId,offerId,...fields}){
 const place=getPlace(catalog,clinicId);
 if(!place.offers.some(o=>o.id===offerId && o.status!=="archived"))throw Error("Услуга не найдена или архивирована.");
 const offer=validateOffer(fields);
 return catalog.map(c=>c.id===clinicId?{...c,offers:c.offers.map(o=>o.id===offerId?{...o,...offer}:o)}:c);
}
export function setDraftOfferArchived(catalog,{clinicId,offerId,archived}){
 const place=getPlace(catalog,clinicId);
 if(!place.offers.some(o=>o.id===offerId))throw Error("Услуга не найдена.");
 return catalog.map(c=>c.id===clinicId?{...c,offers:c.offers.map(o=>o.id===offerId?
   {...o,status:archived?"archived":"active"}:o)}:c);
}
export function restoreDraftCatalog(raw){
 const fallback=initialDraftCatalog();
 if(typeof raw!=="string"||raw.length>60000)return fallback;
 try{
  const data=JSON.parse(raw);
  if(!Array.isArray(data)||data.length>MAX_PLACES)throw Error("Bad catalog");
  const ids=new Set(),offerIds=new Set(),names=new Set();
  const result=data.map(c=>{
    if(!c||typeof c!=="object"||!ID.test(c.id)||ids.has(c.id))throw Error("Bad place");
    if(!seedIds.has(c.id)&&!/^demo-place-\d+$/.test(c.id))throw Error("Unknown place id");
    ids.add(c.id);
    const base=DEMO_CLINICS.find(x=>x.id===c.id);
    const name=cleanText(c.name,3,80,"Название"),address=validateAddress(c.address);
    const nameKey=name.toLocaleLowerCase("ru-RU");
    if(names.has(nameKey))throw Error("Duplicate place");
    names.add(nameKey);
    if(!Array.isArray(c.offers)||c.offers.length>MAX_OFFERS_PER_PLACE)throw Error("Bad offers");
    const offers=c.offers.map(o=>{
      if(!o||!ID.test(o.id)||offerIds.has(o.id)||!["active","archived"].includes(o.status))throw Error("Bad offer");
      if(!initialOfferIds.has(o.id)&&!/^demo-added-\d+$/.test(o.id))throw Error("Unknown offer id");
      offerIds.add(o.id);
      return {id:o.id,...validateOffer(o),status:o.status};
    });
    if(base && !base.offers.every(o=>offers.some(saved=>saved.id===o.id)))throw Error("Missing seeded offer");
    return {
      id:c.id,name,address,color:base?.color||COLOR,
      bookingUrl:null,verifiedForPublication:false,offers,
    };
  });
  for(const [idx,c] of result.entries()){
    if(!seedIds.has(c.id) && c.offers.some(o=>initialOfferIds.has(o.id)))throw Error("Seed offer reparent");
  }
  return result;
 }catch{return fallback;}
}
export const countActiveOffers=catalog=>catalog.reduce((n,c)=>n+c.offers.filter(o=>o.status!=="archived").length,0);
