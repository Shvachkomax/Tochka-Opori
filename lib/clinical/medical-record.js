// Manual encounter documentation. Never auto-generates diagnoses or prescriptions.
export const ENCOUNTER_FIELDS = ['reason','complaints','history','allergies','assessment','diagnosis','therapy','plan'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (v, max=12000) => {
  if (v == null) return '';
  if (typeof v !== 'string' || v.length > max || /\u0000/.test(v)) throw Error('Некорректная длина или формат поля.');
  return v.trim();
};
export function normalizeEncounter(body, canPrescribe=false) {
  if (!UUID.test(body.encounter_id || '') || !Number.isSafeInteger(body.expected_version) || body.expected_version < 0) throw Error('Некорректная версия записи.');
  if (!['draft','confirmed'].includes(body.status)) throw Error('Неизвестный статус записи.');
  const at = new Date(body.encounter_at);
  if (!body.encounter_at || Number.isNaN(at.valueOf()) || at.getUTCFullYear()<1900 || at.valueOf()>Date.now()+86400000) throw Error('Проверьте дату обращения.');
  if (!body.content || typeof body.content !== 'object' || Array.isArray(body.content)) throw Error('Заполните запись.');
  if (Object.keys(body.content).some(k=>![...ENCOUNTER_FIELDS,'medications'].includes(k))) throw Error('Неизвестное поле записи.');
  const content=Object.fromEntries(ENCOUNTER_FIELDS.map(k=>[k,text(body.content[k])]));
  if (!Array.isArray(body.content.medications) || body.content.medications.length>30) throw Error('Допускается до 30 препаратов.');
  content.medications=body.content.medications.map(m=>{
    if (!m || typeof m!=='object' || !['patient_reported','clinician_ordered'].includes(m.source)) throw Error('Укажите источник сведений о препарате.');
    if(m.source==='clinician_ordered'&&!canPrescribe) throw Error('Право на лекарственные назначения не подтверждено.');
    const row={source:m.source};
    for(const k of ['name','dose','frequency','route','start_date','end_date','prescriber','change_reason'])row[k]=text(m[k],1000);
    if(!row.name)throw Error('Укажите препарат.');
    if(!['active','planned','stopped'].includes(m.status))throw Error('Укажите статус препарата.');
    row.status=m.status;
    if(row.source==='clinician_ordered'&&(!row.dose||!row.frequency||!row.route||!row.start_date))throw Error('Для назначения укажите дозу, кратность, способ приёма и дату начала.');
    for(const k of ['start_date','end_date'])if(row[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(row[k])||Number.isNaN(new Date(row[k]).valueOf())||new Date(row[k]).toISOString().slice(0,10)!==row[k]))throw Error('Проверьте даты терапии.');
    if(row.start_date&&row.end_date&&row.end_date<row.start_date)throw Error('Окончание терапии раньше начала.');
    if(row.status==='stopped'&&!row.change_reason)throw Error('Укажите причину отмены препарата.');
    return row;
  });
  if(new TextEncoder().encode(JSON.stringify(content)).length>110000)throw Error('Запись слишком большая. Сократите текст.');
  if(body.status==='confirmed'&&!content.reason&&!content.complaints)throw Error('Для подтверждения укажите причину обращения или жалобы.');
  return {encounter_id:body.encounter_id,expected_version:body.expected_version,status:body.status,
    encounter_at:at.toISOString(),content,amendment_reason:text(body.amendment_reason,2000)};
}

export async function handleMedicalRecord(req,res,deps){
  res.setHeader('Cache-Control','no-store');
  // A5 shares the existing exact test-database gate until production acceptance.
  if(!deps.enabled())return res.status(404).json({ok:false,error:'Медицинская карта пока недоступна.'});
  const auth=await deps.authorize(req);
  if(!auth.ok)return res.status(auth.status||403).json({ok:false,error:auth.error});
  const db=deps.getSupabase();
  const scope=q=>{
    q=q.eq('author_id',auth.expertId).eq('owner_type',auth.ownerType).eq('owner_id',auth.ownerId).eq('module',auth.module);
    return auth.organizationId===null?q.is('organization_id',null):q.eq('organization_id',auth.organizationId);
  };
  if(req.body.action==='listMedicalEncounters'){
    const before=req.body.before;
    if(before!==undefined&&(!Number.isSafeInteger(before)||before<1))return res.status(400).json({ok:false,error:'Некорректная страница.'});
    let q=scope(db.from('medical_encounter_versions').select('revision_id,encounter_id,version,status,encounter_at,content,amendment_reason,recorded_at')).order('revision_id',{ascending:false}).limit(101);
    if(before)q=q.lt('revision_id',before);
    const {data,error}=await q;
    if(error)return res.status(503).json({ok:false,error:'Не удалось загрузить медицинскую карту.'});
    return res.status(200).json({ok:true,records:(data||[]).slice(0,100),next_before:data?.length>100?data[99].revision_id:null,can_prescribe:auth.canPrescribe,author_name:auth.expertName});
  }
  let p;
  try{p=normalizeEncounter(req.body,auth.canPrescribe);}catch(e){return res.status(400).json({ok:false,error:e.message});}
  for(const m of p.content.medications)if(m.source==='clinician_ordered')m.prescriber=auth.expertName;
  const {data,error}=await db.rpc('save_medical_encounter_version',{
    p_encounter_id:p.encounter_id,p_expected_version:p.expected_version,p_author_id:auth.expertId,
    p_owner_type:auth.ownerType,p_owner_id:auth.ownerId,p_module:auth.module,p_organization_id:auth.organizationId,
    p_encounter_at:p.encounter_at,p_status:p.status,p_content:p.content,p_amendment_reason:p.amendment_reason,
  });
  if(error)return res.status(['PT409','40001','23505','22023'].includes(error.code)?409:503).json({ok:false,error:['PT409','40001','23505'].includes(error.code)?'Запись уже изменена. Обновите карту перед сохранением.':error.code==='22023'?'Для исправления подтверждённой записи укажите причину.':'Не удалось сохранить запись.'});
  return res.status(200).json({ok:true,record:{encounter_id:data.encounter_id,version:data.version,status:data.status}});
}
