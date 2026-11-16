// A5.2: deterministic, read-only draft from established scoped clinical sources.
// No model-generated diagnoses, prescriptions, or automatic insertion in the chart.
import {loadLongitudinalFromSources} from './longitudinal.js';
const WINDOWS = {days7:7,days30:30,days90:90,all:null};
const MEASURES = {weight_kg:'Вес, кг',waist_cm:'Талия, см',steps:'Шаги',sleep_hours:'Сон, ч',mood_level:'Настроение',energy_level:'Энергия'};
const SOURCE = {body_daily_logs:'дневник Health',sessions:'сессия Support',service_requests:'обращение пациента',patient_medication_orders:'сведения о препаратах со слов пациента',clinical_observations:'клиническое наблюдение'};
export function parseDraftPeriod(value,now=new Date()){
  if(!Object.hasOwn(WINDOWS,value))throw new Error('Недопустимый период');
  const days=WINDOWS[value];
  return {key:value,start:days===null?null:new Date(now.getTime()-days*86400000).toISOString(),end:now.toISOString()};
}
export function buildPatientDraft(events,module,period,now=new Date()){
  if(!['support','body'].includes(module))throw new Error('Недопустимый модуль');
  const range=parseDraftPeriod(period,now);
  const relevant=(events||[]).filter(e=>e?.at&&Number.isFinite(Date.parse(e.at))&&e.at<=range.end&&(!range.start||e.at>=range.start));
  const items=[];
  const cite=e=>({source:e.source,label:SOURCE[e.source]||e.label||'сохранённая запись',at:e.at,provenance:e.provenance||'unknown',validation_status:e.validation_status||'unknown'});
  const add=(label,value,source)=>items.push({label,value,sources:source.map(cite)});
  if(module==='body'){
    for(const [key,label] of Object.entries(MEASURES)){
      const matches=relevant.filter(e=>e.source==='body_daily_logs'&&typeof e.details?.[key]==='number'&&Number.isFinite(e.details[key])).sort((a,b)=>a.at.localeCompare(b.at));
      if(matches.length){
        const last=matches.at(-1); const first=matches[0];
        add(label, String(last.details[key])+(matches.length>1?' (первое в периоде: '+first.details[key]+')':''),matches.length>1?[first,last]:[last]);
      }
    }
  }else{
    const sessions=relevant.filter(e=>e.source==='sessions');
    if(sessions.length)add('Контакты Support','Сохранённых сессий: '+sessions.length,sessions);
    const requests=relevant.filter(e=>e.source==='service_requests');
    if(requests.length)add('Обращения к специалисту','Сохранённых обращений: '+requests.length,requests);
  }
  const reported=relevant.filter(e=>e.source==='patient_medication_orders'&&e.details?.medication_name);
  for(const e of reported)add('Препарат со слов пациента',String(e.details.medication_name)+(e.details.status?' · '+e.details.status:''),[e]);
  const obs=relevant.filter(e=>e.source==='clinical_observations'&&!e.details?.superseded_by_newer_record&&e.details?.concept);
  for(const e of obs.slice(-20))add('Зарегистрированный показатель',String(e.details.concept)+': '+String(e.details.value_numeric??'значение не указано')+' '+(e.details.unit||''),[e]);
  return {module,period:range,items,source_event_count:relevant.length,read_only:true,review_required:true,
    notice:'Черновик по сохранённым структурированным сведениям. Тексты разговоров и фотографии не анализируются. Отсутствие данных не подтверждает норму или выздоровление.'};
}
export async function handlePatientDraft(req,res,deps){
  res.setHeader('Cache-Control','no-store');
  if(!deps.enabled())return res.status(404).json({ok:false,error:'Черновые сводки недоступны.'});
  const auth=await deps.authorize(req);
  if(!auth.ok)return res.status(auth.status||403).json({ok:false,error:auth.error});
  // Patient access to a shared appointment is not retrospective clinical consent.
  if(auth.relationship!=='primary')return res.status(403).json({ok:false,error:'Для просмотра истории требуется отдельное разрешение пациента.'});
  let period;
  try{period=parseDraftPeriod(req.body?.period||'days30');}catch{return res.status(400).json({ok:false,error:'Некорректный период.'});}
  // Longitudinal loader currently refuses clinic-mixed source data; do not bypass it.
  try{
    const data=await deps.load({supabase:deps.getSupabase(),module:auth.module,ownerType:auth.ownerType,
      ownerId:auth.ownerId,organizationId:auth.organizationId});
    if(!data.coverage?.complete)return res.status(503).json({ok:false,error:'Сведения неполны; сводка не сформирована.'});
    return res.status(200).json({ok:true,draft:buildPatientDraft(data.events,auth.module,period.key)});
  }catch{return res.status(503).json({ok:false,error:'Не удалось проверить полноту и доступность первичных сведений.'});}
}
export const loadPatientDraftSources=loadLongitudinalFromSources;
