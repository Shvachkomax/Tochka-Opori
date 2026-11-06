// ONLY a synthetic, local-browser transaction demonstration.
// No real offers, patients, cash receipts, payment APIs, medical care or legal execution.
import {quotePracticeCommission} from "./commission.js";
import {isValidScheduleDay,timeInMinutes,isActiveScheduleEvent} from "./schedule-draft.js";

export const PAID_DEMO_KEY="my-practice:synthetic-paid-bookings:v1";
export const PAID_DEMO_HOLD_MS=10*60*1000;
const LIMIT=60;
const VALID_ID=/^[A-Za-z0-9_-]{1,100}$/;
const STATUS=new Set(["held","expired","simulated_paid","cancelled","simulated_refunded"]);
const VALID_SERVICE=new Set(["a-first","a-return","b-first","b-online","c-return"]);
const OFFER_KEYS=["id","clinicId","serviceId","day","start","end","priceKopecks","status","executor"];
const BOOKING_KEYS=["id","slotId","status","createdAt","expiresAt","paidAt","refundedAt"];
export const demoExecutor="Демонстрационный исполнитель · юридически не проверен";

export function emptyPaidDemo(){return {version:1,slots:[],bookings:[]};}
const bad=(msg)=>{throw new Error(msg);};
function checkedTime(str){
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(str))bad("Некорректное время.");
 return timeInMinutes(str);
}
function isOverlap(a,b){
 return a.day===b.day && checkedTime(a.start)<checkedTime(b.end) && checkedTime(b.start)<checkedTime(a.end);
}
function nowInt(now){if(!Number.isSafeInteger(now)||now<0)bad("Некорректная дата операции.");return now;}
function checkId(id){return typeof id==="string"&&VALID_ID.test(id);}
function checkSlot(raw){
 if(!raw||typeof raw!=="object"||Array.isArray(raw))bad("Некорректный слот.");
 if(Object.keys(raw).some(k=>!OFFER_KEYS.includes(k)))bad("Неподдерживаемые поля слота.");
 if(!checkId(raw.id)||!VALID_SERVICE.has(raw.serviceId))bad("Некорректная услуга.");
 if(!["demo-clinic-a","demo-clinic-b","demo-clinic-c"].includes(raw.clinicId))bad("Неизвестное место приёма.");
 if(!isValidScheduleDay(raw.day))bad("Некорректная дата.");
 if(checkedTime(raw.end)-checkedTime(raw.start)<15||checkedTime(raw.end)-checkedTime(raw.start)>240)bad("Неверная длительность приёма.");
 if(!Number.isSafeInteger(raw.priceKopecks)||raw.priceKopecks<0||raw.priceKopecks>20000000)bad("Некорректная стоимость.");
 if(raw.status!=="published"||raw.executor!==demoExecutor)bad("Демо не разрешает реальные предложения.");
 return {...raw};
}
function checkBooking(b,slotIds){
 if(!b||typeof b!=="object"||Array.isArray(b)||Object.keys(b).some(k=>!BOOKING_KEYS.includes(k)))bad("Некорректное бронирование.");
 if(!checkId(b.id)||!slotIds.has(b.slotId)||!STATUS.has(b.status))bad("Неизвестное бронирование.");
 for(const key of ["createdAt","expiresAt"]){if(!Number.isSafeInteger(b[key])||b[key]<0)bad("Некорректная дата бронирования.");}
 for(const key of ["paidAt","refundedAt"]){if(b[key]!==null&&(!Number.isSafeInteger(b[key])||b[key]<0))bad("Некорректная дата платежа.");}
 return {...b};
}
export function normalizePaidDemo(raw){
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).some(k=>!["version","slots","bookings"].includes(k)))bad("Некорректный документ.");
 if(raw.version!==1||!Array.isArray(raw.slots)||!Array.isArray(raw.bookings)||
    raw.slots.length>LIMIT||raw.bookings.length>LIMIT*5)bad("Некорректный размер данных.");
 const slots=raw.slots.map(checkSlot),ids=new Set();
 for(const s of slots){if(ids.has(s.id))bad("Повторение слота.");ids.add(s.id);}
 for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length;j++)if(isOverlap(slots[i],slots[j]))bad("Пересечение платных слотов.");
 const bookings=raw.bookings.map(b=>checkBooking(b,ids)),bookIds=new Set();
 for(const b of bookings){if(bookIds.has(b.id))bad("Повторение бронирования.");bookIds.add(b.id);}
 for(const slot of slots){
  if(bookings.filter(b=>b.slotId===slot.id&&b.status==="simulated_paid").length>1)bad("Двойная оплата слота.");
 }
 return {version:1,slots,bookings};
}
export function restorePaidDemo(raw){
 if(typeof raw!=="string"||raw.length>60000)return emptyPaidDemo();
 try{return normalizePaidDemo(JSON.parse(raw));}catch{return emptyPaidDemo();}
}
export function offerFromLink(snapshot){
 if(typeof snapshot!=="string"||snapshot.length>1800)bad("Неверная ссылка.");
 let obj;
 try{obj=JSON.parse(decodeURIComponent(snapshot));}catch{bad("Неверная ссылка.");}
 return checkSlot(obj);
}
export function offerToLink(slot){return encodeURIComponent(JSON.stringify(checkSlot(slot)));}
export function addPaidDemoSlot(state,{id,clinicId,serviceId,day,start,end,priceKopecks},schedule=[]){
 const old=normalizePaidDemo(state);
 if(old.slots.length>=LIMIT)bad("В демо слишком много слотов.");
 const candidate=checkSlot({id,clinicId,serviceId,day,start,end,priceKopecks,status:"published",executor:demoExecutor});
 if(old.slots.some(s=>s.id===candidate.id))bad("Такой слот уже создан.");
 if(old.slots.some(s=>isOverlap(s,candidate)))bad("Время пересекается с платным приёмом.");
 if(schedule.some(e=>isActiveScheduleEvent(e)&&isOverlap(e,candidate)))bad("Врач в это время занят по справочному календарю.");
 return {...old,slots:[...old.slots,candidate]};
}
export function getBookingStatus(b,now=Date.now()){
 nowInt(now);
 return b.status==="held" && b.expiresAt<=now?"expired":b.status;
}
export function isAvailable(state,slotId,now=Date.now()){
 const data=normalizePaidDemo(state);nowInt(now);
 if(!data.slots.some(s=>s.id===slotId))return false;
 return !data.bookings.some(b=>b.slotId===slotId &&
   (getBookingStatus(b,now)==="held"||getBookingStatus(b,now)==="simulated_paid"));
}
export function beginPaidDemoHold(state,slotId,bookingId,now=Date.now()){
 const data=normalizePaidDemo(state);nowInt(now);
 if(!checkId(bookingId)||data.bookings.some(b=>b.id===bookingId))bad("Некорректный идентификатор заявки.");
 if(!isAvailable(data,slotId,now))bad("Слот уже занят или оплачен.");
 const booking={id:bookingId,slotId,status:"held",createdAt:now,
  expiresAt:now+PAID_DEMO_HOLD_MS,paidAt:null,refundedAt:null};
 return {...data,bookings:[...data.bookings.map(b=>getBookingStatus(b,now)==="expired"?{...b,status:"expired"}:b),booking]};
}
export function simulatePaidDemoPayment(state,bookingId,now=Date.now()){
 const data=normalizePaidDemo(state);nowInt(now);
 const booking=data.bookings.find(b=>b.id===bookingId);
 if(!booking||getBookingStatus(booking,now)!=="held")bad("Бронь не найдена или истекла.");
 if(data.bookings.some(b=>b.slotId===booking.slotId&&b.id!==booking.id&&getBookingStatus(b,now)==="simulated_paid"))
   bad("Приём уже оплачен.");
 const slot=data.slots.find(s=>s.id===booking.slotId);
 if(!slot)bad("Услуга не найдена.");
 return {...data,bookings:data.bookings.map(b=>b.id===bookingId?{...b,status:"simulated_paid",paidAt:now}:b)};
}
export function cancelPaidDemoBooking(state,bookingId,now=Date.now()){
 const data=normalizePaidDemo(state);nowInt(now);
 const target=data.bookings.find(b=>b.id===bookingId);
 if(!target)bad("Заявка не найдена.");
 const previous=getBookingStatus(target,now);
 if(!["held","simulated_paid"].includes(previous))bad("Заявку нельзя отменить повторно.");
 const status=previous==="simulated_paid"?"simulated_refunded":"cancelled";
 return {...data,bookings:data.bookings.map(b=>b.id===bookingId?{
   ...b,status,refundedAt:status==="simulated_refunded"?now:null,
 }:b)};
}
export function settlementForBooking(state,bookingId){
 const data=normalizePaidDemo(state);
 const booking=data.bookings.find(b=>b.id===bookingId);
 if(!booking)bad("Заявка отсутствует.");
 const slot=data.slots.find(s=>s.id===booking.slotId);
 const result=quotePracticeCommission(slot.priceKopecks);
 return {booking,slot,feeKopecks:result.platformFeeKopecks,executorShareKopecks:result.organizationShareKopecks,
   isSimulatedPayment:["simulated_paid","simulated_refunded"].includes(booking.status),
   isSimulatedRefund:booking.status==="simulated_refunded"};
}
