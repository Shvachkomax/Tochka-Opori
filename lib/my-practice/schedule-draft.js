// Исключительно демо-расписание одного врача. Только браузер, без пациентов, API и оплаты.
import {DEMO_BUSY_BLOCKS, addDaysUTC} from "./pilot-data.js";
import {initialDraftCatalog} from "./catalog-draft.js";

export const SCHEDULE_DRAFT_STORAGE_KEY = "my-practice:synthetic-schedule:v1";
export const PATIENT_ALIASES = Object.freeze([
  {id:"demo-p1",label:"Учебный пациент №1"},
  {id:"demo-p2",label:"Учебный пациент №2"},
  {id:"demo-p3",label:"Учебный пациент №3"},
  {id:"demo-p4",label:"Учебный пациент №4"},
]);
export const BOOKING_STATUSES = Object.freeze({
  pending:"Ожидает подтверждения",
  confirmed:"Подтверждена",
  cancelled:"Отменена",
  completed:"Завершена",
});
export const BUSY_REASONS = Object.freeze({
  clinic:"Занято — приём в клинике",
  personal:"Личное время",
  vacation:"Отпуск",
  unavailable:"Недоступен",
});
const MAX_ENTRIES = 200;
const ID_REGEX = /^[a-z0-9_-]{1,64}$/;
const DAY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidScheduleDay(day){
  if(typeof day!=="string"||!DAY_REGEX.test(day))return false;
  const d=new Date(day+"T12:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===day &&
    day>="2020-01-01" && day<="2038-12-31";
}
export function timeInMinutes(time){
  if(typeof time!=="string"||!TIME_REGEX.test(time))throw new Error("Время должно быть в формате ЧЧ:ММ.");
  const [h,m]=time.split(":").map(Number);
  return h*60+m;
}
export function endForDuration(start,minutes){
  if(!Number.isSafeInteger(minutes)||minutes<15||minutes>720)throw new Error("Недопустимая длительность.");
  const end=timeInMinutes(start)+minutes;
  if(end>1439)throw new Error("Приём должен закончиться до полуночи.");
  return String(Math.floor(end/60)).padStart(2,"0")+":"+String(end%60).padStart(2,"0");
}
export function initialScheduleDraft(catalog=initialDraftCatalog()){
  return DEMO_BUSY_BLOCKS.filter(b=>catalog.some(c=>c.id===b.clinicId)).map(b=>({
    id:b.id,clinicId:b.clinicId,day:b.day,start:b.start,end:b.end,
    kind:"busy",reason:"clinic",status:"active",serviceId:null,patientAlias:null,source:"manual",
  }));
}
const clinicExists = (clinicId,catalog)=>catalog.some(c=>c.id===clinicId);
function allOffersForClinic(catalog,clinicId){
  return (catalog.find(c=>c.id===clinicId)?.offers||[]);
}
function normalized(entry,catalog){
  if(!entry||typeof entry!=="object")throw new Error("Некорректное событие.");
  const {clinicId,day,start,end,kind}=entry;
  if(!clinicExists(clinicId,catalog))throw new Error("Выберите действующее место приёма.");
  if(!isValidScheduleDay(day))throw new Error("Выберите корректную дату.");
  const startMin=timeInMinutes(start),endMin=timeInMinutes(end);
  if(endMin<=startMin||endMin-startMin<15||endMin-startMin>720)throw new Error("Время окончания должно быть позже начала (15–720 минут).");
  if(kind==="busy"){
    if(!Object.hasOwn(BUSY_REASONS,entry.reason))throw new Error("Укажите тип занятости.");
    return {clinicId,day,start,end,kind,reason:entry.reason,status:"active",serviceId:null,patientAlias:null,source:"manual"};
  }
  if(kind!=="booking")throw new Error("Выберите тип события.");
  if(!Object.hasOwn(BOOKING_STATUSES,entry.status))throw new Error("Неизвестный статус записи.");
  const offer=allOffersForClinic(catalog,clinicId).find(o=>o.id===entry.serviceId);
  if(!offer)throw new Error("Услуга не принадлежит выбранной клинике.");
  if(endMin-startMin>240)throw new Error("Запись не должна быть дольше 240 минут.");
  if(!PATIENT_ALIASES.some(p=>p.id===entry.patientAlias))throw new Error("Выберите только вымышленного пациента.");
  return {clinicId,day,start,end,kind,reason:null,status:entry.status,serviceId:offer.id,patientAlias:entry.patientAlias,source:"manual"};
}
export function isActiveScheduleEvent(entry){
  return entry.kind==="busy"||entry.status!=="cancelled";
}
function hasCollision(entries,next,excludeId=null){
  if(!isActiveScheduleEvent(next))return false;
  const start=timeInMinutes(next.start),end=timeInMinutes(next.end);
  return entries.some(e=>e.id!==excludeId&&isActiveScheduleEvent(e)&&e.day===next.day &&
    start<timeInMinutes(e.end) && timeInMinutes(e.start)<end);
}
export function validateScheduleEntry(entries,data,catalog,{excludeId=null}={}){
  const next=normalized(data,catalog);
  if(hasCollision(entries,next,excludeId))throw new Error("Это время уже занято. Выберите другой интервал — даже если запись в другой клинике.");
  return next;
}
export function addScheduleEntry(entries,data,catalog){
  if(entries.length>=MAX_ENTRIES)throw new Error("Лимит учебного календаря — 200 событий.");
  const item=validateScheduleEntry(entries,data,catalog);
  let seq=1;const used=new Set(entries.map(e=>e.id));while(used.has("demo-calendar-"+seq))seq++;
  return [...entries,{id:"demo-calendar-"+seq,...item}];
}
export function updateScheduleEntry(entries,id,data,catalog){
  const prev=entries.find(e=>e.id===id);
  if(!prev)throw new Error("Событие не найдено.");
  if(prev.source!=="manual")throw new Error("Внешнюю запись можно изменить только в клинике.");
  const next=validateScheduleEntry(entries,data,catalog,{excludeId:id});
  return entries.map(e=>e.id===id?{...next,id}:e);
}
export function removeScheduleEntry(entries,id){
  const prev=entries.find(e=>e.id===id);
  if(!prev)throw new Error("Событие не найдено.");
  if(prev.source!=="manual")throw new Error("Внешнюю запись нельзя удалить здесь.");
  return entries.filter(e=>e.id!==id);
}
export function entriesForWeek(entries,monday,clinicId="all"){
  const limit=addDaysUTC(monday,7);
  return entries.filter(e=>e.day>=monday&&e.day<limit&&(clinicId==="all"||e.clinicId===clinicId))
    .sort((a,b)=>a.day.localeCompare(b.day)||a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
}
export function restoreScheduleDraft(raw,catalog){
  const fallback=initialScheduleDraft(catalog);
  if(typeof raw!=="string"||!raw||raw.length>60000)return fallback;
  try{
    const data=JSON.parse(raw);
    if(!Array.isArray(data)||data.length>MAX_ENTRIES)throw Error("Invalid data");
    const ids=new Set(),acc=[];
    for(const item of data){
      if(!ID_REGEX.test(item?.id)||ids.has(item.id)||item.source!=="manual")throw Error("Invalid identity");
      ids.add(item.id);
      const next=validateScheduleEntry(acc,item,catalog);
      acc.push({id:item.id,...next});
    }
    return acc;
  }catch{return fallback;}
}
