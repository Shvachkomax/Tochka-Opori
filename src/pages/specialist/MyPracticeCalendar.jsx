import React, {useEffect, useMemo, useRef, useState, useCallback} from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import listPlugin from "@fullcalendar/react/list";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import ruLocale from "@fullcalendar/react/locales/ru";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import {addDaysUTC, rubles} from "../../../lib/my-practice/pilot-data.js";
import {
  PATIENT_ALIASES, BOOKING_STATUSES, BUSY_REASONS, addScheduleEntry,
  updateScheduleEntry, removeScheduleEntry, entriesForWeek, endForDuration,
} from "../../../lib/my-practice/schedule-draft.js";
import {toCalendarEvents, DEMO_WORKING_HOURS} from "../../../lib/my-practice/availability.js";
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
function clinicName(clinicId,catalog){
  return catalog.find(c=>c.id===clinicId)?.name||"Неизвестное место";
}
function bookingLabel(entry,catalog){
  const c=catalog.find(c=>c.id===entry.clinicId);
  const offer=c?.offers?.find(o=>o.id===entry.serviceId);
  return offer?.name || "услуга";
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
    }catch(err){setError(err.message||"Не удалось сохранить запись.");}
  };
  const remove=()=>{
    if(!editingId)return;
    if(!window.confirm("Удалить это событие из календаря?"))return;
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
          <option value="busy">Блок занятости</option><option value="booking">запись пациента</option>
        </select>
      </label>
      <label className="mp-field mp-field-block">Место приёма
        <select value={draft.clinicId} onChange={e=>changeClinic(e.target.value)} data-testid="mp-event-clinic" required>
          {!draft.clinicId&&<option value="" disabled>— Выберите клинику —</option>}
          {catalog.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
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
        <label className="mp-field mp-field-block">Пациент — только псевдоним
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
  const [view,setView]=useState("timeGridWeek");
  const apiRef=useRef(null);

  const visible=useMemo(()=>entriesForWeek(entries,monday,clinic),[entries,monday,clinic]);
  // Multi-clinic without Premium: the clinic filter selects visible events;
  // each event title carries its clinic name. No resources/resourceId.
  const fcEvents=useMemo(()=>toCalendarEvents(visible,catalog,{includeFree:true,monday,days:7}),[visible,catalog,monday]);

  const startNew=(kind,day=monday)=>{
    if(!catalog.length)return;
    // Explicit clinic choice: when the filter is "all" we must NOT silently
    // pick the first clinic — the doctor chooses in the form.
    const selectedClinic=clinic==="all"?"":clinic;
    const base=newEvent(kind,day,selectedClinic||catalog[0]?.id,catalog);
    setDraft({...base,clinicId:selectedClinic});
    setEditId(null);setNotice("");
  };
  const edit=event=>{
    if(event.source!=="manual"){setNotice("Внешние записи изменяются в клинике.");return;}
    setDraft({...event});
    setEditId(event.id);setNotice("");
  };
  const close=()=>{setDraft(null);setEditId(null);};

  const handleSelect=useCallback((info)=>{
    if(!catalog.length)return;
    const day=(info.startStr||"").slice(0,10);
    const start=(info.startStr||"").slice(11,16) || "09:00";
    const end=(info.endStr||"").slice(11,16) || start;
    // No resources in the free build: the doctor always picks the clinic
    // in the form. When the filter selects one clinic, prefill it.
    const presetClinic=clinic==="all"?"":clinic;
    if(!day)return;
    const base=newEvent("booking",day,presetClinic||catalog[0]?.id,catalog);
    // Keep the selected interval; validation runs on save via schedule-draft.
    setDraft({...base,clinicId:presetClinic,start,end});
    setEditId(null);setNotice("");
  },[catalog,clinic]);

  const handleEventClick=useCallback((info)=>{
    const original=info.event.extendedProps;
    if(original?.kind==="free")return;
    const entry=entries.find(e=>e.id===original?.entryId);
    if(entry)edit(entry);
  },[entries]);

  const handleEventDidMount=useCallback((info)=>{
    const id=info.event.extendedProps?.entryId;
    if(id)info.el.setAttribute("data-testid","mp-calendar-event-"+id);
  },[]);

  const handleDatesSet=useCallback((info)=>{
    // Sync pilot week anchor (monday) with the calendar visible range.
    const start=info.startStr?.slice(0,10);
    if(start&&start!==monday)setMonday(start);
  },[monday,setMonday]);

  // v7 API: ref exposes getApi() → CalendarApi (changeView/prev/next/today).
  const api=()=>apiRef.current?.getApi();
  const gotoPrev=()=>api()?.prev();
  const gotoNext=()=>api()?.next();
  const gotoToday=()=>api()?.today();
  const switchView=(v)=>{setView(v);api()?.changeView(v);};

  return <section data-testid="my-practice-calendar" aria-label="Редактируемый календарь врача" className="mp-schedule">
    <div className="mp-schedule-toolbar">
      <div className="mp-week-nav">
        <button type="button" onClick={gotoPrev} aria-label="Предыдущий период">‹</button>
        <strong>{formatDay(monday)} — {formatDay(addDaysUTC(monday,6))}</strong>
        <button type="button" onClick={gotoNext} aria-label="Следующий период">›</button>
        <button type="button" onClick={gotoToday} aria-label="Сегодня">Сегодня</button>
      </div>
      <div className="mp-view-switch" role="group" aria-label="Вид календаря">
        <button type="button" className={view==="timeGridWeek"?"active":""} onClick={()=>switchView("timeGridWeek")}
          data-testid="mp-view-week">Неделя</button>
        <button type="button" className={view==="timeGridDay"?"active":""} onClick={()=>switchView("timeGridDay")}
          data-testid="mp-view-day">День</button>
        <button type="button" className={view==="listWeek"?"active":""} onClick={()=>switchView("listWeek")}
          data-testid="mp-view-list">Список</button>
      </div>
      <label className="mp-field">Место приёма
        <select value={clinic} onChange={e=>{setClinic(e.target.value);close();}}>
          <option value="all">Все клиники</option>
          {catalog.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <div className="mp-schedule-new">
        <button className="mp-primary" type="button" onClick={()=>startNew("booking")} disabled={!catalog.length} data-testid="mp-add-booking">+ Запись</button>
        <button className="mp-secondary" type="button" onClick={()=>startNew("busy")} disabled={!catalog.length} data-testid="mp-add-busy">+ Занятость</button>
      </div>
    </div>
    <div className="mp-schedule-legend" aria-label="Обозначения календаря">
      <span className="mp-legend-busy">Занятость</span>
      <span className="mp-legend-confirmed">Подтверждена</span>
      <span className="mp-legend-pending">Ожидает</span>
      <span className="mp-legend-cancelled">Отменена</span>
      <span className="mp-legend-completed">Завершена</span>
      <span className="mp-legend-free">Свободно (справочно)</span>
    </div>
    <p className="mp-footnote">Рабочее время для справочных свободных интервалов: {DEMO_WORKING_HOURS.label} ({DEMO_WORKING_HOURS.start}–{DEMO_WORKING_HOURS.end}).</p>
    <div className="mp-fullcalendar-wrap" data-testid="my-practice-fullcalendar">
      <FullCalendar
        plugins={[classicThemePlugin,dayGridPlugin,timeGridPlugin,listPlugin,interactionPlugin]}
        locale={ruLocale}
        initialView={view}
        initialDate={monday}
        ref={apiRef}
        resources={undefined}
        events={fcEvents}
        headerToolbar={false}
        firstDay={1}
        allDaySlot={false}
        slotMinTime="07:00"
        slotMaxTime="22:00"
        slotDuration="00:30"
        slotLabelInterval="01:00"
        businessHours={{
          daysOfWeek: DEMO_WORKING_HOURS.days,
          startTime: DEMO_WORKING_HOURS.start,
          endTime: DEMO_WORKING_HOURS.end,
        }}
        height={650}
        dayMaxEvents={4}
        selectable
        select={handleSelect}
        eventClick={handleEventClick}
        eventDidMount={handleEventDidMount}
        datesSet={handleDatesSet}
        editable={false}
        nowIndicator
        listNoEventsText="Нет событий"
      />
    </div>
    {draft&&<ScheduleForm draft={draft} setDraft={setDraft} editingId={editId} catalog={catalog}
      entries={entries} onChange={onChange} onClose={close}/>}
    {notice&&<p role="status" className="mp-editor-note">{notice}</p>}
    <div className="mp-services-save">
      <span>{dirty?"Есть несохранённые изменения расписания":(storageMessage||"Изменения сохраняются в этой вкладке")}</span>
      <div className="mp-schedule-new">
        <button type="button" className="mp-primary" onClick={onSave} disabled={!dirty}
          data-testid="mp-schedule-save-draft">Сохранить расписание в браузере</button>
        <button type="button" className="mp-secondary" onClick={()=>{if(window.confirm("Сбросить только расписание?")){onReset();close();}}}
          data-testid="mp-schedule-reset">Сбросить календарь</button>
      </div>
    </div>
    <p className="mp-footnote">Пустые интервалы не означают доступность для записи. Расписание не синхронизируется с системами клиник.</p>
  </section>;
}
