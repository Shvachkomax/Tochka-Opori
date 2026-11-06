import React, {useEffect, useMemo, useRef, useState} from "react";
import {DEMO_CLINICS, addDaysUTC, rubles} from "../../../lib/my-practice/pilot-data.js";
import {
  PATIENT_ALIASES, BOOKING_STATUSES, BUSY_REASONS, addScheduleEntry,
  updateScheduleEntry, removeScheduleEntry, entriesForWeek, endForDuration,
} from "../../../lib/my-practice/schedule-draft.js";
import "./MyPracticeCalendar.css";

const DAYS=["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
const formatDay=day=>new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"short",timeZone:"UTC"})
  .format(new Date(day+"T12:00:00Z"));

function availableOffers(catalog,clinicId,existingId=null){
  return (catalog.find(c=>c.id===clinicId)?.offers||[])
    .filter(o=>o.status!=="archived"||o.id===existingId);
}
function newEvent(kind,day,clinicId,catalog){
  const offers=availableOffers(catalog,clinicId);
  const offer=offers[0]||null;
  const start="09:00";
  return {
    kind,clinicId,day,start,
    end:kind==="booking"?endForDuration(start,offer?.minutes||45):"10:00",
    status:kind==="booking"?"pending":"active",
    patientAlias:"demo-p1",serviceId:offer?.id||"",reason:"clinic",
  };
}
function clinicName(clinicId){
  return DEMO_CLINICS.find(c=>c.id===clinicId)?.name||"Неизвестное место";
}
function bookingLabel(entry,catalog){
  const c=catalog.find(c=>c.id===entry.clinicId);
  const offer=c?.offers?.find(o=>o.id===entry.serviceId);
  return offer?.name || "Учебная услуга";
}
const badgeColor=entry=>entry.kind==="busy"?"busy":
  entry.status==="pending"?"pending":entry.status==="cancelled"?"cancelled":
  entry.status==="completed"?"completed":"confirmed";

function ScheduleForm({draft,setDraft,editingId,catalog,entries,onChange,onClose}){
  const [error,setError]=useState("");
  const formRef=useRef(null);
  useEffect(()=>{formRef.current?.scrollIntoView?.({behavior:"smooth",block:"nearest"});},[editingId,draft.kind]);
  const offers=availableOffers(catalog,draft.clinicId,draft.serviceId);
  const selectedOffer=offers.find(o=>o.id===draft.serviceId);
  const changeClinic=value=>{
    const first=availableOffers(catalog,value)[0];
    let end=draft.end;
    if(draft.kind==="booking"){
      try{end=endForDuration(draft.start,first?.minutes||45);}catch{end=draft.end;}
    }
    setDraft({...draft,clinicId:value,serviceId:first?.id||"",end});
    setError("");
  };
  const changeKind=kind=>{
    const next=newEvent(kind,draft.day,draft.clinicId,catalog);
    let end=draft.end;
    if(kind==="booking"){
      const first=availableOffers(catalog,draft.clinicId)[0];
      try{end=endForDuration(draft.start,first?.minutes||45);}catch{end=draft.end;}
    }
    setDraft({...next,start:draft.start,end});
    setError("");
  };
  const changeStart=start=>{
    let end=draft.end;
    if(draft.kind==="booking"){
      try{end=endForDuration(start,selectedOffer?.minutes||45);}catch{}
    }
    setDraft({...draft,start,end});
  };
  const changeService=serviceId=>{
    const offer=offers.find(o=>o.id===serviceId);
    let end=draft.end;
    try{end=endForDuration(draft.start,offer?.minutes||45);}catch{}
    setDraft({...draft,serviceId,end});
  };
  const save=e=>{
    e.preventDefault();
    setError("");
    try{
      const next=editingId
        ? updateScheduleEntry(entries,editingId,draft,catalog)
        : addScheduleEntry(entries,draft,catalog);
      onChange(next);
      onClose();
    }catch(err){setError(err.message||"Не удалось сохранить учебную запись.");}
  };
  const remove=()=>{
    if(!editingId)return;
    if(!window.confirm("Удалить это учебное событие из календаря?"))return;
    try{onChange(removeScheduleEntry(entries,editingId));onClose();}
    catch(err){setError(err.message||"Не удалось удалить событие.");}
  };
  return <form ref={formRef} onSubmit={save} className="mp-schedule-form"
    data-testid="my-practice-schedule-form" aria-label={editingId?"Редактирование события":"Добавление события"}>
    <div className="mp-schedule-form-head">
      <h4>{editingId?"Изменить запись в календаре":"Добавить запись в календарь"}</h4>
      <button className="mp-secondary" type="button" onClick={onClose}>Закрыть</button>
    </div>
    <div className="mp-schedule-form-grid">
      <label className="mp-field mp-field-block">Тип
        <select value={draft.kind} onChange={e=>changeKind(e.target.value)} data-testid="mp-event-kind">
          <option value="busy">Блок занятости</option><option value="booking">Учебная запись пациента</option>
        </select>
      </label>
      <label className="mp-field mp-field-block">Место приёма
        <select value={draft.clinicId} onChange={e=>changeClinic(e.target.value)} data-testid="mp-event-clinic">
          {DEMO_CLINICS.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="mp-field mp-field-block">Дата
        <input required type="date" min="2020-01-01" max="2038-12-31" value={draft.day}
          onChange={e=>setDraft({...draft,day:e.target.value})} data-testid="mp-event-day"/>
      </label>
      <div className="mp-schedule-time-fields">
        <label className="mp-field">Начало
          <input required type="time" value={draft.start} onChange={e=>changeStart(e.target.value)} data-testid="mp-event-start"/>
        </label>
        <label className="mp-field">Конец
          <input required type="time" value={draft.end}
            onChange={e=>setDraft({...draft,end:e.target.value})} data-testid="mp-event-end"/>
        </label>
      </div>
      {draft.kind==="busy" ? <label className="mp-field mp-field-block">Причина занятости
        <select value={draft.reason} onChange={e=>setDraft({...draft,reason:e.target.value})} data-testid="mp-event-reason">
          {Object.entries(BUSY_REASONS).map(([key,value])=><option key={key} value={key}>{value}</option>)}
        </select>
      </label> : <>
        <label className="mp-field mp-field-block">Услуга этой клиники
          <select value={draft.serviceId} onChange={e=>changeService(e.target.value)}
            disabled={!offers.length} required data-testid="mp-event-service">
            {!offers.length&&<option value="">Нет доступных услуг</option>}
            {offers.map(o=><option key={o.id} value={o.id}>{o.name}{o.status==="archived"?" (в архиве)":""} · {rubles(o.priceRub)}</option>)}
          </select>
        </label>
        <label className="mp-field mp-field-block">Пациент — только учебный псевдоним
          <select value={draft.patientAlias} onChange={e=>setDraft({...draft,patientAlias:e.target.value})}
            data-testid="mp-event-patient">
            {PATIENT_ALIASES.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="mp-field mp-field-block">Статус
          <select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}
            data-testid="mp-event-status">
            {Object.entries(BOOKING_STATUSES).map(([key,value])=><option key={key} value={key}>{value}</option>)}
          </select>
        </label>
      </>}
    </div>
    {draft.kind==="booking"&&<p className="mp-footnote">При выборе услуги подставляется её длительность; время окончания можно изменить вручную. Это не настоящая запись в клинику.</p>}
    {error&&<p className="mp-editor-error" role="alert" data-testid="mp-schedule-error">{error}</p>}
    <div className="mp-schedule-form-actions">
      <button type="submit" className="mp-primary" disabled={draft.kind==="booking"&&!offers.length}
        data-testid="mp-event-save">{editingId?"Сохранить изменение":"Добавить в календарь"}</button>
      <button type="button" className="mp-secondary" onClick={onClose}>Отмена</button>
      {editingId&&<button type="button" className="mp-schedule-danger" onClick={remove} data-testid="mp-event-delete">Удалить событие</button>}
    </div>
  </form>;
}

export default function MyPracticeCalendar({catalog,entries,onChange,onSave,onReset,dirty,storageMessage,monday,setMonday,clinic,setClinic}){
  const [draft,setDraft]=useState(null);
  const [editId,setEditId]=useState(null);
  const [notice,setNotice]=useState("");
  const visible=useMemo(()=>entriesForWeek(entries,monday,clinic),[entries,monday,clinic]);
  const byDay=useMemo(()=>Object.fromEntries(DAYS.map((_,i)=>{
    const day=addDaysUTC(monday,i);
    return [day,visible.filter(e=>e.day===day)];
  })),[monday,visible]);
  const startNew=(kind,day=monday)=>{
    const selectedClinic=clinic==="all"?DEMO_CLINICS[0].id:clinic;
    setDraft(newEvent(kind,day,selectedClinic,catalog));
    setEditId(null);setNotice("");
  };
  const edit=event=>{
    if(event.source!=="manual"){setNotice("Внешние записи изменяются в клинике.");return;}
    setDraft({...event});
    setEditId(event.id);setNotice("");
  };
  const close=()=>{setDraft(null);setEditId(null);};
  return <section data-testid="my-practice-calendar" aria-label="Редактируемый демонстрационный календарь врача" className="mp-schedule">
    <div className="mp-schedule-toolbar">
      <div className="mp-week-nav">
        <button type="button" onClick={()=>setMonday(addDaysUTC(monday,-7))} aria-label="Предыдущая неделя">‹</button>
        <strong>{formatDay(monday)} — {formatDay(addDaysUTC(monday,6))}</strong>
        <button type="button" onClick={()=>setMonday(addDaysUTC(monday,7))} aria-label="Следующая неделя">›</button>
      </div>
      <label className="mp-field">Место приёма
        <select value={clinic} onChange={e=>{setClinic(e.target.value);close();}}>
          <option value="all">Все клиники</option>
          {DEMO_CLINICS.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <div className="mp-schedule-new">
        <button className="mp-primary" type="button" onClick={()=>startNew("booking")} data-testid="mp-add-booking">+ Запись</button>
        <button className="mp-secondary" type="button" onClick={()=>startNew("busy")} data-testid="mp-add-busy">+ Занятость</button>
      </div>
    </div>
    <div className="mp-schedule-legend" aria-label="Обозначения календаря">
      <span className="mp-legend-busy">Занятость</span>
      <span className="mp-legend-confirmed">Подтверждена</span>
      <span className="mp-legend-pending">Ожидает</span>
      <span className="mp-legend-cancelled">Отменена</span>
      <span className="mp-legend-completed">Завершена</span>
    </div>
    <div className="mp-calendar-scroll">
      <div className="mp-week-grid">
        {DAYS.map((label,i)=>{
          const day=addDaysUTC(monday,i);
          const current=byDay[day]||[];
          return <div className="mp-day" key={day} data-testid={"my-practice-day-"+day}>
            <div className="mp-day-head"><strong>{label}</strong><span>{formatDay(day)}</span></div>
            {current.map(e=>{
              const status=badgeColor(e);
              const name=e.kind==="busy"?BUSY_REASONS[e.reason]:bookingLabel(e,catalog);
              return <div key={e.id} className={"mp-schedule-event mp-event-"+status}
                data-testid={"mp-schedule-event-"+e.id}>
                <strong>{e.start}–{e.end}</strong>
                <span>{name}</span>
                <small>{clinicName(e.clinicId)}</small>
                <small>{e.kind==="busy"?"Блок занятости":BOOKING_STATUSES[e.status]}</small>
                {e.kind==="booking"&&<small>{PATIENT_ALIASES.find(p=>p.id===e.patientAlias)?.label||"Учебный пациент"}</small>}
                <button className="mp-schedule-event-edit" type="button" onClick={()=>edit(e)}
                  aria-label={"Изменить событие "+e.start+" в "+formatDay(day)}>Изменить</button>
              </div>;
            })}
            {!current.length&&<p className="mp-no-block">Нет сведений о занятости</p>}
            <button className="mp-schedule-day-add" type="button" onClick={()=>startNew("booking",day)}
              aria-label={"Добавить учебную запись на "+formatDay(day)}>+ Добавить</button>
          </div>;
        })}
      </div>
    </div>
    {draft&&<ScheduleForm draft={draft} setDraft={setDraft} editingId={editId} catalog={catalog}
      entries={entries} onChange={onChange} onClose={close}/>}
    {notice&&<p role="status" className="mp-editor-note">{notice}</p>}
    <div className="mp-services-save">
      <span>{dirty?"Есть несохранённые изменения расписания":(storageMessage||"Календарь — только учебный черновик")}</span>
      <div className="mp-schedule-new">
        <button type="button" className="mp-primary" onClick={onSave} disabled={!dirty}
          data-testid="mp-schedule-save-draft">Сохранить расписание в браузере</button>
        <button type="button" className="mp-secondary" onClick={()=>{if(window.confirm("Сбросить только учебное расписание?")){onReset();close();}}}
          data-testid="mp-schedule-reset">Сбросить календарь</button>
      </div>
    </div>
    <p className="mp-footnote">Это ручной учебный календарь. Пустые интервалы не являются доступными слотами.
      Изменения не передаются в клиники и не подтверждают реальные приёмы. В реальной версии записи из клиник будут доступны только по согласованной интеграции.</p>
  </section>;
}
