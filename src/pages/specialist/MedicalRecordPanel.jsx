import React, {useEffect,useRef,useState} from 'react';
import './MedicalRecordPanel.css';
const FIELDS={reason:'Причина обращения',complaints:'Жалобы',history:'Анамнез',allergies:'Аллергии и нежелательные реакции',assessment:'Оценка врача',diagnosis:'Диагноз, внесённый врачом',therapy:'Терапия и рекомендации',plan:'Обследования и дальнейший план'};
const MED_FIELDS={name:'Препарат',dose:'Доза и единица',frequency:'Кратность приёма',route:'Способ приёма',start_date:'Начало',end_date:'Окончание',prescriber:'Назначивший врач',change_reason:'Причина изменения или отмены'};
const blankContent=()=>({...Object.fromEntries(Object.keys(FIELDS).map(k=>[k,''])),medications:[]});
const localDate=(value)=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const showDate=v=>new Date(v).toLocaleString('ru-RU');
const medLabel=m=>m.source==='clinician_ordered'?'Назначение врача':'Со слов пациента';
function Content({content}){
 return <>{Object.entries(FIELDS).map(([key,label])=>content[key]&&<p key={key}><strong>{label}: </strong><span style={{whiteSpace:'pre-wrap'}}>{content[key]}</span></p>)}
 {content.medications?.map((m,i)=><div className="mr-med" key={i}><strong>{m.name}</strong> · {medLabel(m)} · {{active:'Действует',planned:'Запланировано',stopped:'Отменено'}[m.status]}
 {Object.entries(MED_FIELDS).filter(([k])=>k!=='name').map(([k,label])=>m[k]&&<p key={k}>{label}: {m[k]}</p>)}</div>)}</>;
}
export default function MedicalRecordPanel({clientRef,module,organizationId}){
 const [records,setRecords]=useState([]),[next,setNext]=useState(null),[canPrescribe,setCanPrescribe]=useState(false),[author,setAuthor]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [form,setForm]=useState(null),[dirty,setDirty]=useState(false);
 const generation=useRef(0);
 async function api(action,payload={}){
  const r=await fetch('/api/specialist',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,client_ref:clientRef,module,organization_id:organizationId??null,...payload})});
  const data=await r.json();if(!r.ok||!data.ok)throw Error(data.error||'Не удалось выполнить запрос.');return data;
 }
 async function load(more=false){
  const g=++generation.current;setLoading(true);setError('');
  try{const d=await api('listMedicalEncounters',more?{before:next}:{});if(g!==generation.current)return;
   setRecords(old=>more?[...old,...d.records]:d.records);setNext(d.next_before);setCanPrescribe(d.can_prescribe);setAuthor(d.author_name);
  }catch(e){if(g===generation.current){setError(e.message);setRecords([]);setNext(null);}}
  finally{if(g===generation.current)setLoading(false);}
 }
 useEffect(()=>{load();return()=>{generation.current++;};},[clientRef,module,organizationId]);
 useEffect(()=>{if(!dirty)return;const stop=e=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',stop);return()=>window.removeEventListener('beforeunload',stop);},[dirty]);
 const discard=()=>!dirty||window.confirm('Отменить несохранённые изменения записи?');
 const edit=r=>{if(!discard())return;setMessage('');setError('');setDirty(false);setForm(r?{encounter_id:r.encounter_id,expected_version:r.version,encounter_at:localDate(r.encounter_at),content:structuredClone(r.content),amendment_reason:'',correction:records.some(x=>x.encounter_id===r.encounter_id&&x.status==='confirmed')}:{encounter_id:crypto.randomUUID(),expected_version:0,encounter_at:localDate(new Date()),content:blankContent(),amendment_reason:'',correction:false});};
 const update=patch=>{setForm(f=>({...f,...patch}));setDirty(true);};
 const changeMed=(i,k,v)=>update({content:{...form.content,medications:form.content.medications.map((m,n)=>n===i?{...m,[k]:v}:m)}});
 async function save(status){
  if(status==='confirmed'&&!window.confirm('Подтвердить запись от своего имени? Последующие исправления будут сохранены отдельной версией.'))return;
  setBusy(true);setError('');setMessage('');
  try{await api('saveMedicalEncounter',{encounter_id:form.encounter_id,expected_version:form.expected_version,encounter_at:new Date(form.encounter_at).toISOString(),content:form.content,amendment_reason:form.amendment_reason,status});setDirty(false);setForm(null);await load();setMessage(status==='confirmed'?'Запись подтверждена.':'Черновик сохранён.');}
  catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const latest=[...new Map(records.map(r=>[r.encounter_id,records.find(x=>x.encounter_id===r.encounter_id)])).values()].sort((a,b)=>b.encounter_at.localeCompare(a.encounter_at));
 return <section className="medical-record" aria-label="Медицинская карта">
  <h3>Медицинская карта</h3><p>Ваши записи приёмов и история терапии этого пациента. Подтверждение фиксирует авторство; электронный рецепт не оформляется.</p>
  <button type="button" onClick={()=>edit(null)} disabled={loading||busy}>+ Новое обращение</button>
  <button type="button" onClick={()=>{if(discard()){setForm(null);setDirty(false);load();}}} disabled={loading||busy}>Обновить</button>
  {loading&&<p role="status">Загрузка карты…</p>}{error&&<p role="alert" className="mr-error">{error}</p>}{message&&<p role="status">{message}</p>}
  {form&&<form onSubmit={e=>e.preventDefault()}><h4>{form.correction?'Исправление записи':form.expected_version?'Редактирование черновика':'Новое обращение'}</h4>
   <label>Дата и время обращения<input type="datetime-local" required value={form.encounter_at} onChange={e=>update({encounter_at:e.target.value})}/></label>
   {Object.entries(FIELDS).map(([k,label])=><label key={k}>{label}<textarea rows={3} maxLength={12000} value={form.content[k]||''} onChange={e=>update({content:{...form.content,[k]:e.target.value}})}/></label>)}
   <h4>Лекарственная терапия</h4><p>Сведения пациента и назначения врача сохраняются с указанием источника.</p>
   {!canPrescribe&&<p>Создание лекарственных назначений доступно после подтверждения полномочий врача. Можно записать препараты со слов пациента.</p>}
   {form.content.medications.map((m,i)=><fieldset key={i}><legend>Препарат {i+1}</legend>
    <label>Источник<select value={m.source} onChange={e=>changeMed(i,'source',e.target.value)}><option value="patient_reported">Со слов пациента</option><option disabled={!canPrescribe} value="clinician_ordered">Назначение врача</option></select></label>
    {Object.entries(MED_FIELDS).map(([k,label])=><label key={k}>{label}<input type={k.endsWith('_date')?'date':'text'} maxLength={1000} value={m[k]||''} onChange={e=>changeMed(i,k,e.target.value)}/></label>)}
    <label>Статус<select value={m.status} onChange={e=>changeMed(i,'status',e.target.value)}><option value="active">Действует</option><option value="planned">Запланировано</option><option value="stopped">Отменено</option></select></label>
    <button type="button" onClick={()=>update({content:{...form.content,medications:form.content.medications.filter((_,n)=>i!==n)}})}>Убрать из этой записи</button>
   </fieldset>)}
   <button type="button" disabled={form.content.medications.length>=30} onClick={()=>update({content:{...form.content,medications:[...form.content.medications,{name:'',source:'patient_reported',status:'active'}]}})}>+ Добавить препарат</button>
   {form.expected_version>0&&<label>Причина исправления (обязательна после подтверждения)<textarea required={form.correction} maxLength={2000} value={form.amendment_reason} onChange={e=>update({amendment_reason:e.target.value})}/></label>}
   <p>{dirty?'Есть несохранённые изменения.':'Изменения сохраняются на сервере по кнопке.'}</p>
   <button type="button" disabled={busy} onClick={()=>save('draft')}>Сохранить черновик</button><button type="button" disabled={busy} onClick={()=>save('confirmed')}>Подтвердить запись</button>
   <button type="button" disabled={busy} onClick={()=>{if(discard()){setForm(null);setDirty(false);}}}>Закрыть</button>
  </form>}
  {!loading&&!error&&!records.length&&<p>Записей пока нет. Добавьте первое обращение.</p>}
  {latest.map(r=><article key={r.encounter_id}><h4>{showDate(r.encounter_at)} · {r.status==='confirmed'?'Подтверждено':'Черновик'}</h4><p>{author} · Версия {r.version} · Сохранено {showDate(r.recorded_at)}</p>
   <Content content={r.content}/>{r.amendment_reason&&<p>Причина исправления: {r.amendment_reason}</p>}
   <button type="button" disabled={busy} onClick={()=>edit(r)}>{r.status==='confirmed'?'Внести исправление':'Редактировать'}</button>
   <details><summary>История сохранений</summary>{records.filter(x=>x.encounter_id===r.encounter_id).map(x=><div className="mr-version" key={x.revision_id}><strong>Версия {x.version} · {x.status==='confirmed'?'Подтверждено':'Черновик'} · {showDate(x.recorded_at)}</strong><Content content={x.content}/>{x.amendment_reason&&<p>Причина: {x.amendment_reason}</p>}</div>)}</details>
  </article>)}
  {next&&<button type="button" disabled={loading||busy} onClick={()=>load(true)}>Загрузить более ранние записи и версии</button>}
 </section>;
}
