import React,{useEffect,useState} from 'react';
export default function PatientDraftSummary({clientRef,module,organizationId}){
 const [period,setPeriod]=useState('days30'),[draft,setDraft]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{setDraft(null);setError('');},[clientRef,module,organizationId,period]);
 async function load(){
  setBusy(true);setError('');setDraft(null);
  try{
   const r=await fetch('/api/specialist',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'getPatientDraftSummary',client_ref:clientRef,module,organization_id:organizationId??null,period})});
   const data=await r.json();if(!r.ok||!data.ok)throw Error(data.error||'Не удалось загрузить сводку');
   setDraft(data.draft);
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <section className="mr-draft" aria-label="Черновая профильная сводка">
  <h4>Черновая сводка {module==='body'?'Health':'Support'}</h4>
  <p>Только сохранённые структурированные сведения пациента; врач проверяет каждый пункт. Это не диагноз и не запись в карте.</p>
  <label>Период<select value={period} onChange={e=>setPeriod(e.target.value)}>
   <option value="days7">7 дней</option><option value="days30">30 дней</option><option value="days90">90 дней</option><option value="all">Всё доступное время</option>
  </select></label>
  <button type="button" disabled={busy} onClick={load}>{busy?'Проверка доступа…':'Сформировать сводку'}</button>
  {error&&<p role="alert" className="mr-error">{error}</p>}
  {draft&&<div><p>{draft.notice}</p><p>Событий за период: {draft.source_event_count}. Пунктов: {draft.items.length}.</p>
   {!draft.items.length&&<p>Подтверждённых для отображения записей за период нет.</p>}
   {draft.items.map((item,i)=><article key={i}><strong>{item.label}</strong><p>{item.value}</p>
    <details><summary>Показать источники ({item.sources.length})</summary>
     <ul>{item.sources.map((s,j)=><li key={j}>{s.label} · {new Date(s.at).toLocaleString('ru-RU')} · {s.provenance==='patient_reported'?'со слов пациента':'статус: '+s.provenance} · проверка: {s.validation_status}</li>)}</ul>
    </details></article>)}
  </div>}
 </section>;
}
