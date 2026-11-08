import React, { useMemo, useState } from "react";
import {
  DEMO_DOCTOR, DEMO_CLINICS,
  filterOffers, canPublishBookingLink, rubles,
} from "../../../lib/my-practice/pilot-data.js";
import "./MyPracticePilot.css";
import SpecialistPageNavigation from "./SpecialistPageNavigation.jsx";
import "./MyPracticeBusinessPilot.css";
import { MyPracticeFinancialDemo, MyPracticePatientConnectionDemo } from "./MyPracticeBusinessPilot.jsx";
import MyPracticeCatalogEditor from "./MyPracticeCatalogEditor.jsx";
import MyPracticeCalendar from "./MyPracticeCalendar.jsx";
import MyPracticePlacesEditor from "./MyPracticePlacesEditor.jsx";
import {MyPracticePaidBookingsDemo} from "./MyPracticePaidBookingDemo.jsx";
import {initialScheduleDraft, restoreScheduleDraft, SCHEDULE_DRAFT_STORAGE_KEY} from "../../../lib/my-practice/schedule-draft.js";
import {initialDraftCatalog,restoreDraftCatalog,countActiveOffers,DRAFT_STORAGE_KEY,updateDraftOffer} from "../../../lib/my-practice/catalog-draft.js";

// Чистый визуальный прототип. Никаких запросов к API, личных или медицинских данных.
const TABS = [
  { id: "overview", label: "Обзор" },
  { id: "services", label: "Услуги" },
  { id: "calendar", label: "Мой календарь" },
  { id: "paid", label: "Платные приёмы" },
  { id: "manage", label: "Управление" },
  { id: "finance", label: "Финансы" },
];

function ClinicCard({ clinic, onServices }) {
  return (
    <article className="mp-clinic" data-testid={"my-practice-clinic-" + clinic.id}>
      <span className="mp-clinic-dot" style={{ background:clinic.color }} aria-hidden="true"/>
      <div>
        <h4>{clinic.name}</h4>
        <p>{clinic.address}</p>
        <p className="mp-muted">Справочное место работы · {clinic.offers.filter(o=>o.status!=="archived").length} услуг</p>
        <button type="button" onClick={() => onServices(clinic.id)} className="mp-text-btn">Посмотреть услуги</button>
      </div>
    </article>
  );
}

function OfferCard({ offer, onSaveEdit }) {
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");
  const [fields, setFields] = useState(() => ({
    name: offer.name, priceRub: String(offer.priceRub),
    minutes: String(offer.minutes), format: offer.format,
  }));
  const verified = canPublishBookingLink({
    clinicApproved:offer.verifiedForPublication,
    doctorAuthorized:false,
    bookingUrl:offer.bookingUrl,
  });

  const startEditing = () => {
    setFields({name:offer.name,priceRub:String(offer.priceRub),minutes:String(offer.minutes),format:offer.format});
    setEditError("");
    setEditing(true);
  };
  const cancelEditing = () => { setEditing(false); setEditError(""); };
  const saveEdits = event => {
    event.preventDefault();
    try {
      onSaveEdit({clinicId:offer.clinicId,offerId:offer.id,...fields});
      setEditing(false);
      setEditError("");
    } catch(error) {
      setEditError(error?.message || "Не удалось изменить услугу.");
    }
  };
  return (
    <article className="mp-offer" data-testid={"my-practice-offer-" + offer.id}>
      {!editing ? (
        <>
          <div className="mp-offer-top">
            <span className="mp-format">{offer.format === "online" ? "Дистанционно*" : "Очно"}</span>
            <strong>{rubles(offer.priceRub)}</strong>
          </div>
          <h4>{offer.name}</h4>
          <p>{offer.clinicName}</p>
          <p className="mp-muted">{offer.minutes} мин · {offer.address}</p>
          <button
            type="button"
            className="mp-secondary mp-offer-edit"
            data-testid={"mp-edit-offer-" + offer.id}
            onClick={startEditing}
            aria-label={"Редактировать услугу: " + offer.name}
          >
            Редактировать
          </button>
          {verified
            ? <a href={offer.bookingUrl} target="_blank" rel="noopener noreferrer">Перейти к записи клиники</a>
            : <p className="mp-booking-disabled">Запись недоступна: требуется подключение клиники</p>}
        </>
      ) : (
        <form className="mp-inline-editor" data-testid={"mp-inline-form-" + offer.id} onSubmit={saveEdits}>
          <h4>Редактирование услуги</h4>
          <p className="mp-muted">{offer.clinicName}</p>
          <label className="mp-field mp-field-block">Название
            <input required minLength={3} maxLength={100} value={fields.name}
              onChange={e => setFields({...fields,name:e.target.value})}
              data-testid="mp-inline-name"/>
          </label>
          <div className="mp-inline-editor-grid">
            <label className="mp-field">Цена, ₽
              <input type="number" required min="0" max="200000" step="1" value={fields.priceRub}
                onChange={e => setFields({...fields,priceRub:e.target.value})}
                data-testid="mp-inline-price"/>
            </label>
            <label className="mp-field">Длительность, мин
              <input type="number" required min="15" max="240" step="1" value={fields.minutes}
                onChange={e => setFields({...fields,minutes:e.target.value})}/>
            </label>
          </div>
          <label className="mp-field mp-field-block">Формат приёма
            <select value={fields.format} onChange={e => setFields({...fields,format:e.target.value})}>
              <option value="offline">Очно</option><option value="online">Дистанционно*</option>
            </select>
          </label>
          {editError && <p className="mp-editor-error" role="alert">{editError}</p>}
          <div className="mp-inline-editor-actions">
            <button type="submit" className="mp-primary">Сохранить изменение</button>
            <button type="button" className="mp-secondary" onClick={cancelEditing}>Отмена</button>
          </div>
          <p className="mp-footnote">После изменения сохраните настройки в браузере.</p>
        </form>
      )}
    </article>
  );
}

export default function MyPracticePilot({ standalone = false, storageScope = "public-demo", doctor = DEMO_DOCTOR }) {
  const catalogKey = DRAFT_STORAGE_KEY + ":" + storageScope;
  const scheduleKey = SCHEDULE_DRAFT_STORAGE_KEY + ":" + storageScope;
  const [tab,setTab] = useState("overview");
  const [catalog,setCatalog] = useState(() => {
    try {return restoreDraftCatalog(sessionStorage.getItem(catalogKey));}
    catch {return initialDraftCatalog();}
  });
  const [schedule,setSchedule] = useState(() => {
    try {return restoreScheduleDraft(sessionStorage.getItem(scheduleKey),catalog);}
    catch {return initialScheduleDraft(catalog);}
  });
  const [scheduleDirty,setScheduleDirty] = useState(false);
  const [scheduleMessage,setScheduleMessage] = useState("");
  const changeSchedule = next => {setSchedule(next);setScheduleDirty(true);setScheduleMessage("");};
  const saveSchedule = () => {
    try {sessionStorage.setItem(scheduleKey,JSON.stringify(schedule));setScheduleDirty(false);setScheduleMessage("расписание сохранено только в этой вкладке.");}
    catch {setScheduleMessage("Не удалось сохранить в браузере; изменения останутся до закрытия страницы.");}
  };
  const resetSchedule = () => {
    try {sessionStorage.removeItem(scheduleKey);} catch {}
    setSchedule(initialScheduleDraft(catalog));setScheduleDirty(false);setScheduleMessage("Исходное расписание восстановлено.");
  };
  const [dirty,setDirty] = useState(false);
  const [storageMessage,setStorageMessage] = useState("");
  const changeCatalog = next => { setCatalog(next); setDirty(true); setStorageMessage(""); };
  const changePlaces = (nextCatalog,nextSchedule) => {
    changeCatalog(nextCatalog);
    if(nextSchedule){setSchedule(nextSchedule);setScheduleDirty(true);setScheduleMessage("");}
    if(clinicFilter!=="all"&&!nextCatalog.some(c=>c.id===clinicFilter))setClinicFilter("all");
    if(calendarClinic!=="all"&&!nextCatalog.some(c=>c.id===calendarClinic))setCalendarClinic("all");
  };
  const savePlaces = () => {
    try{
      sessionStorage.setItem(catalogKey,JSON.stringify(catalog));
      sessionStorage.setItem(scheduleKey,JSON.stringify(schedule));
      setDirty(false);setScheduleDirty(false);
      setStorageMessage("места работы, услуги и расписание сохранены в этом браузере.");
      setScheduleMessage("Расписание сохранено вместе со справочником.");
    }catch{setStorageMessage("Не удалось записать настройки в браузере.");}
  };
  const saveDraft = () => {
    try { sessionStorage.setItem(catalogKey,JSON.stringify(catalog)); setDirty(false); setStorageMessage("настройки сохранён только в этом браузере."); }
    catch { setStorageMessage("Браузер не разрешил локальное сохранение. Настройки остаётся только на экране."); }
  };
  const resetDraft = () => {
    try{
      sessionStorage.removeItem(catalogKey);
      sessionStorage.removeItem(scheduleKey);
    }catch{}
    setCatalog(initialDraftCatalog());setDirty(false);
    setSchedule(initialScheduleDraft());setScheduleDirty(false);
    setClinicFilter("all");setCalendarClinic("all");
    setStorageMessage("Исходный каталог и календарь восстановлены.");
    setScheduleMessage("Исходное расписание восстановлено.");
  };
  const [clinicFilter,setClinicFilter] = useState("all");
  const [formatFilter,setFormatFilter] = useState("all");
  const [calendarClinic,setCalendarClinic] = useState("all");
  const [monday,setMonday] = useState("2026-11-09");
  const offers = useMemo(
    () => filterOffers(catalog, {clinicId:clinicFilter,format:formatFilter}),
    [catalog,clinicFilter,formatFilter]
  );
  const switchToClinic = id => { setClinicFilter(id); setTab("services"); };
  const saveOfferFromCard = payload => {
    const next = updateDraftOffer(catalog, payload);
    changeCatalog(next);
  };
  return <section className="my-practice-pilot" data-testid="my-practice-pilot" aria-labelledby="my-practice-title">
    {standalone && <SpecialistPageNavigation />}
    <header className="mp-header">
      <div>
        <p className="mp-eyebrow">Земляничные поляны · Моя практика</p>
        <h2 id="my-practice-title">Практика врача в одном пространстве</h2>
        <p>Справочное расписание и отдельный сценарий платных приёмов через платформу.</p>
      </div>
    </header>
    <div className="mp-doctor">
      <div className="mp-avatar" aria-hidden="true">В</div>
      <div>
        <h3>{/^QA /.test(doctor.name || "") ? "Специалист" : doctor.name}</h3>
        <p>{doctor.specialty === "Учебная проверка" ? "" : (doctor.specialty || DEMO_DOCTOR.specialty)} · {doctor.city || DEMO_DOCTOR.city}</p>
        <p className="mp-muted">{DEMO_DOCTOR.about}</p>
      </div>
    </div>
    <div className="mp-stats" aria-label="Показатели практики">
      <div><strong>{catalog.length}</strong><span>места приёма</span></div>
      <div><strong>{countActiveOffers(catalog)}</strong><span>услуг в каталоге</span></div>
      <div><strong>{schedule.length}</strong><span>событий календаря</span></div>
    </div>
    <div className="mp-tabs" role="tablist" aria-label="Разделы моей практики">
      {TABS.map(t=><button key={t.id} type="button" role="tab"
        id={"mp-tab-"+t.id} aria-selected={tab===t.id} aria-controls={"mp-panel-"+t.id}
        className={tab===t.id?"mp-tab active":"mp-tab"} onClick={()=>setTab(t.id)}>{t.label}</button>)}
    </div>
    {tab==="overview" && <div role="tabpanel" id="mp-panel-overview" aria-labelledby="mp-tab-overview">
      <MyPracticePlacesEditor catalog={catalog} schedule={schedule} storageScope={storageScope} onChange={changePlaces}
        onSave={savePlaces} dirty={dirty||scheduleDirty} storageMessage={storageMessage}
        onServices={switchToClinic}/>
      <div className="mp-next">
        <h4>Как подключить врача</h4>
        <p>Места работы — личные заметки, не реквизиты исполнителя. Платные предложения и подтверждение лицензии оформляются отдельно.</p>
        <button type="button" className="mp-primary" onClick={()=>setTab("calendar")}>Расписание</button>
      </div>
    </div>}
    {tab==="services" && <div role="tabpanel" id="mp-panel-services" aria-labelledby="mp-tab-services">
      <div className="mp-section-title"><h3>Каталог услуг</h3><p>Это информационный каталог. Сделки через платформу оформляются отдельно — в разделе «Платные приёмы».</p></div>
      <div className="mp-filters">
        <label className="mp-field">Клиника<select value={clinicFilter} onChange={e=>setClinicFilter(e.target.value)}>
          <option value="all">Все места</option>
          {catalog.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        <label className="mp-field">Формат<select value={formatFilter} onChange={e=>setFormatFilter(e.target.value)}>
          <option value="all">Все форматы</option><option value="offline">Очный приём</option>
          <option value="online">Дистанционно*</option>
        </select></label>
      </div>
      <div className="mp-two-col">{offers.map(o=><OfferCard key={o.id} offer={o} onSaveEdit={saveOfferFromCard}/>)}</div>
      {!offers.length && <p className="mp-muted">По этим условиям услуг нет.</p>}
      <div className="mp-services-save">
        <span>{dirty ? "Есть изменения, ещё не сохранённые в браузере" : (storageMessage || "Изменения можно сохранить в браузере")}</span>
        <button type="button" className="mp-primary" onClick={saveDraft}
          disabled={!dirty} data-testid="mp-save-catalog-services">Сохранить</button>
      </div>
      <p className="mp-footnote">* Дистанционные медицинские услуги возможны только при соблюдении закона, правил и лицензии клиники. Это не публичная оферта.</p>
    </div>}
    {tab==="manage" && <div role="tabpanel" id="mp-panel-manage" aria-labelledby="mp-tab-manage">
      <MyPracticeCatalogEditor catalog={catalog} onChange={changeCatalog} onSave={saveDraft} onReset={resetDraft} dirty={dirty} storageMessage={storageMessage}/>
    </div>}
    {tab==="paid" && <div role="tabpanel" id="mp-panel-paid" aria-labelledby="mp-tab-paid">
      <MyPracticePaidBookingsDemo catalog={catalog} schedule={schedule} storageScope={storageScope}/>
    </div>}
    {tab==="finance" && <div role="tabpanel" id="mp-panel-finance" aria-labelledby="mp-tab-finance">
      <MyPracticeFinancialDemo catalog={catalog}/>
    </div>}
    {tab==="patients" && <div role="tabpanel" id="mp-panel-patients" aria-labelledby="mp-tab-patients">
      <MyPracticePatientConnectionDemo/>
    </div>}
    {tab==="calendar" && <div role="tabpanel" id="mp-panel-calendar" aria-labelledby="mp-tab-calendar">
      <div className="mp-section-title"><h3>Общий календарь</h3><p>Справочные блоки работы и внешние записи по редактируемым местам, без платежей и комиссии.</p></div>
      <MyPracticeCalendar catalog={catalog} entries={schedule} onChange={changeSchedule}
        onSave={saveSchedule} onReset={resetSchedule} dirty={scheduleDirty} storageMessage={scheduleMessage}
        monday={monday} setMonday={setMonday} clinic={calendarClinic} setClinic={setCalendarClinic}/>
    </div>}
  </section>;
}
