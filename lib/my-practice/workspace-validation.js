// Synthetic-only server workspace. It must NEVER accept patient identifiers, text notes or diagnoses.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY=/^[a-z0-9][a-z0-9_-]{0,63}$/i;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const CLOCK=/^([01]\d|2[0-3]):([0-5]\d)$/;
const FORMAT=new Set(["online","offline"]);
// Strict fixed labels: server drafts cannot be used as a free-text patient note.
export const SYNTHETIC_PRACTICE_SERVICE_NAMES=Object.freeze([
  "Учебная консультация",
  "Демонстрационный первичный приём",
  "Демонстрационный повторный приём",
  "Демонстрационная дистанционная консультация",
  "Повторная консультация",
]);
const SERVICE_NAMES=new Set(SYNTHETIC_PRACTICE_SERVICE_NAMES);
const REASONS=new Set(["clinic","personal","vacation","unavailable"]);
const STATUSES=new Set(["pending","confirmed","cancelled","completed"]);
const DEMO_ALIASES=new Set(["demo-p1","demo-p2","demo-p3","demo-p4"]);
const MAX_BYTES=90000;

export class WorkspaceValidationError extends Error {constructor(message){super(message);this.name="WorkspaceValidationError";}}

function err(message){throw new WorkspaceValidationError(message);}
function exactKeys(obj,keys){
  if(!obj||typeof obj!=="object"||Array.isArray(obj))err("Некорректный формат черновика.");
  const allowed=new Set(keys);
  if(Object.keys(obj).some(k=>!allowed.has(k)))err("Черновик содержит неподдерживаемые или персональные поля.");
}
function str(value,min,max,label){
  if(typeof value!=="string")err("Некорректное поле: "+label);
  const cleaned=value.trim().replace(/\s+/g," ");
  if(cleaned.length<min||cleaned.length>max)err("Некорректная длина: "+label);
  return cleaned;
}
function int(value,min,max,label){
  if(!Number.isSafeInteger(value)||value<min||value>max)err("Некорректное число: "+label);
  return value;
}
function day(value){
  if(typeof value!=="string"||!DAY.test(value))err("Некорректная дата.");
  const d=new Date(value+"T12:00:00Z");
  if(Number.isNaN(d.valueOf())||d.toISOString().slice(0,10)!==value||value<"2020-01-01"||value>"2038-12-31")err("Некорректная дата.");
  return value;
}
function minutes(value){
  if(typeof value!=="string"||!CLOCK.test(value))err("Некорректное время.");
  return Number(value.slice(0,2))*60+Number(value.slice(3,5));
}
const validId=(v,label)=>{if(typeof v!=="string"||!KEY.test(v))err("Некорректный идентификатор: "+label);return v;};
export const emptyMyPracticeWorkspace=()=>({scope:"synthetic",catalog:[],schedule:[]});
export function normalizeMyPracticeWorkspace(raw,authorizedOrgIds){
  if(!Array.isArray(authorizedOrgIds))err("Неизвестны разрешённые организации.");
  const allowed=new Set(authorizedOrgIds.filter(id=>UUID.test(id)));
  exactKeys(raw,["scope","catalog","schedule"]);
  if(raw.scope!=="synthetic")err("Здесь допускаются только учебные данные.");
  const byteLen=new TextEncoder().encode(JSON.stringify(raw)).length;
  if(byteLen>MAX_BYTES)err("Превышен размер учебного черновика.");
  if(!Array.isArray(raw.catalog)||raw.catalog.length>20||!Array.isArray(raw.schedule)||raw.schedule.length>200)err("Слишком много записей.");
  const orgSeen=new Set(),idSeen=new Set(),offerIndex=new Map();
  const catalog=raw.catalog.map(c=>{
    exactKeys(c,["organization_id","offers"]);
    if(!UUID.test(c.organization_id)||!allowed.has(c.organization_id))err("Нет доступа к организации.");
    if(orgSeen.has(c.organization_id))err("Организация повторяется.");
    orgSeen.add(c.organization_id);
    if(!Array.isArray(c.offers)||c.offers.length>30)err("Превышен лимит учебных услуг.");
    const offers=c.offers.map(o=>{
      exactKeys(o,["id","name","priceRub","minutes","format","status"]);
      const id=validId(o.id,"услуга");
      if(idSeen.has(id))err("Идентификатор услуги повторяется.");
      idSeen.add(id);
      if(!FORMAT.has(o.format)||!["active","archived"].includes(o.status))err("Неизвестный формат или статус услуги.");
      const name=str(o.name,3,100,"название услуги");
      if(!SERVICE_NAMES.has(name))err("Разрешены только учебные наименования услуг.");
      const clean={id,name,priceRub:int(o.priceRub,0,200000,"цена"),
        minutes:int(o.minutes,15,240,"длительность"),format:o.format,status:o.status};
      offerIndex.set(id,{org:c.organization_id,...clean});
      return clean;
    });
    return {organization_id:c.organization_id,offers};
  });
  const scheduleIds=new Set();
  const schedule=raw.schedule.map(e=>{
    const base=["id","organization_id","day","start","end","kind","source"];
    exactKeys(e,e.kind==="busy"?[...base,"reason"]:[...base,"serviceId","patientAlias","status"]);
    const id=validId(e.id,"событие");
    if(scheduleIds.has(id))err("Идентификатор события повторяется.");
    scheduleIds.add(id);
    if(!UUID.test(e.organization_id)||!allowed.has(e.organization_id)||!orgSeen.has(e.organization_id))err("Нет доступа к месту приёма.");
    if(e.source!=="manual")err("Внешние записи нельзя изменять вручную.");
    const on=day(e.day);
    const start=minutes(e.start),end=minutes(e.end);
    if(end<=start||end-start<15||end-start>720)err("Некорректная длительность события.");
    if(e.kind==="busy"){
      if(!REASONS.has(e.reason))err("Неизвестная причина занятости.");
      return {id,organization_id:e.organization_id,day:on,start:e.start,end:e.end,kind:"busy",source:"manual",reason:e.reason};
    }
    if(e.kind!=="booking"||!STATUSES.has(e.status))err("Некорректный тип или статус записи.");
    if(!DEMO_ALIASES.has(e.patientAlias))err("Можно использовать только вымышленные псевдонимы.");
    const offer=offerIndex.get(e.serviceId);
    if(!offer||offer.org!==e.organization_id)err("Услуга не относится к выбранной клинике.");
    if(end-start>240)err("Учебная запись не может длиться более 240 минут.");
    return {id,organization_id:e.organization_id,day:on,start:e.start,end:e.end,kind:"booking",source:"manual",serviceId:e.serviceId,patientAlias:e.patientAlias,status:e.status};
  });
  const active=schedule.filter(e=>e.kind==="busy"||e.status!=="cancelled");
  const dates=new Map();
  for(const e of active){
    const intervals=dates.get(e.day)||[];
    const start=minutes(e.start),end=minutes(e.end);
    if(intervals.some(x=>start<x.end&&x.start<end))err("Пересечение записей врача между клиниками.");
    intervals.push({start,end});dates.set(e.day,intervals);
  }
  return {scope:"synthetic",catalog,schedule};
}
export const isSafeMyPracticeVersion=value=>Number.isSafeInteger(value)&&value>=0&&value<=2147483646;
