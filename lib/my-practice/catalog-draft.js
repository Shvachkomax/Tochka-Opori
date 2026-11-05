// Черновики только демонстрационного каталога. Нет API, БД, реальных клиник и медицинских данных.
import { DEMO_CLINICS } from "./pilot-data.js";
export const DRAFT_STORAGE_KEY = "my-practice:synthetic-catalog:v1";
const MAX_OFFERS_PER_CLINIC = 30;
const FORMATS = new Set(["online", "offline"]);
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export function initialDraftCatalog() {
  return DEMO_CLINICS.map(clinic => ({...clinic, offers: clinic.offers.map(offer=>({...offer, status:"active"}))}));
}

function validateOffer(offer) {
  const name = typeof offer?.name === "string" ? offer.name.trim().replace(/\s+/g," ") : "";
  const format = offer?.format;
  const minutes = Number(offer?.minutes);
  const priceRub = Number(offer?.priceRub);
  if (name.length < 3 || name.length > 100) throw new Error("Название услуги: от 3 до 100 символов.");
  if (!FORMATS.has(format)) throw new Error("Укажите формат приёма.");
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 240) throw new Error("Продолжительность: от 15 до 240 минут.");
  if (!Number.isInteger(priceRub) || priceRub < 0 || priceRub > 200000) throw new Error("Цена: целое число от 0 до 200 000 ₽.");
  return {name, format, minutes, priceRub};
}

function ensureClinic(catalog,clinicId) {
  const clinic = catalog.find(c=>c.id===clinicId && DEMO_CLINICS.some(seed=>seed.id===c.id));
  if(!clinic) throw new Error("Клиника отсутствует в демонстрационной практике.");
  return clinic;
}

export function addDraftOffer(catalog,{clinicId,...fields}) {
  const clinic=ensureClinic(catalog,clinicId);
  const values=validateOffer(fields);
  if(clinic.offers.length>=MAX_OFFERS_PER_CLINIC) throw new Error("В демоверсии допускается не более 30 услуг на клинику.");
  const used=new Set(catalog.flatMap(c=>c.offers.map(o=>o.id)));
  let i=1;
  while(used.has("demo-added-"+i)) i++;
  const offer={id:"demo-added-"+i,...values,status:"active"};
  return catalog.map(c=>c.id===clinicId?{...c,offers:[...c.offers,offer]}:c);
}

export function updateDraftOffer(catalog,{clinicId,offerId,...fields}) {
  const clinic=ensureClinic(catalog,clinicId);
  const target=clinic.offers.find(o=>o.id===offerId);
  if(!target || target.status==="archived") throw new Error("Услуга не найдена или архивирована.");
  const values=validateOffer(fields);
  return catalog.map(c=>c.id===clinicId?{...c,offers:c.offers.map(o=>o.id===offerId?{...o,...values}:o)}:c);
}

export function setDraftOfferArchived(catalog,{clinicId,offerId,archived}) {
  const clinic=ensureClinic(catalog,clinicId);
  if(!clinic.offers.some(o=>o.id===offerId)) throw new Error("Услуга не найдена в этой клинике.");
  return catalog.map(c=>c.id===clinicId?{...c,offers:c.offers.map(o=>o.id===offerId?{...o,status:archived?"archived":"active"}:o)}:c);
}

// Доверяем только содержимому полей услуги. Статус согласования, адреса и bookingUrl
// всегда берём из исходных фиктивных клиник — сохранённый JSON их не меняет.
export function restoreDraftCatalog(json) {
  const fallback=initialDraftCatalog();
  if(!json || json.length>30000) return fallback;
  try {
    const decoded=JSON.parse(json);
    if(!Array.isArray(decoded) || decoded.length!==fallback.length) return fallback;
    const used=new Set();
    return fallback.map(base=>{
      const candidate=decoded.find(c=>c?.id===base.id);
      if(!candidate || !Array.isArray(candidate.offers) || candidate.offers.length>MAX_OFFERS_PER_CLINIC) throw Error("Invalid catalog");
      const offers=candidate.offers.map(o=>{
        if(!ID_PATTERN.test(o?.id)||used.has(o.id)||!["active","archived"].includes(o.status)) throw Error("Invalid offer identity");
        used.add(o.id);
        return {id:o.id,...validateOffer(o),status:o.status};
      });
      // Нельзя удалять исходные услуги из аудитной истории: разрешено только архивировать.
      for(const original of base.offers) if(!used.has(original.id) && !offers.some(o=>o.id===original.id)) throw Error("Missing original offer");
      return {...base,offers};
    });
  } catch {return fallback;}
}

export function countActiveOffers(catalog){
  return catalog.reduce((n,c)=>n+c.offers.filter(o=>o.status!=="archived").length,0);
}
