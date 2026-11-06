import React, { useMemo, useState } from "react";
import {
  DEMO_DOCTOR, DEMO_CLINICS,
  filterOffers, canPublishBookingLink, rubles,
} from "../../../lib/my-practice/pilot-data.js";
import "./MyPracticePilot.css";
import "./MyPracticeBusinessPilot.css";
import { MyPracticeFinancialDemo, MyPracticePatientConnectionDemo } from "./MyPracticeBusinessPilot.jsx";
import MyPracticeCatalogEditor from "./MyPracticeCatalogEditor.jsx";
import MyPracticeCalendar from "./MyPracticeCalendar.jsx";
import {initialScheduleDraft, restoreScheduleDraft, SCHEDULE_DRAFT_STORAGE_KEY} from "../../../lib/my-practice/schedule-draft.js";
import {initialDraftCatalog,restoreDraftCatalog,countActiveOffers,DRAFT_STORAGE_KEY,updateDraftOffer} from "../../../lib/my-practice/catalog-draft.js";

// Чистый визуальный прототип. Никаких запросов к API, личных или медицинских данных.
const TABS = [
  { id: "overview", label: "Обзор" },
  { id: "services", label: "Услуги" },
  { id: "calendar", label: "Занятость" },
  { id: "manage", label: "Управление" },
  { id: "finance", label: "Финансы" },
  { id: "patients", label: "Пациенты" },
];

function ClinicCard({ clinic, onServices }) {
  return (
    <article className="mp-clinic" data-testid={"my-practice-clinic-" + clinic.id}>
      <span className="mp-clinic-dot" style={{ background:clinic.color }} aria-hidden="true"/>
      <div>
        <h4>{clinic.name}</h4>
        <p>{clinic.address}</p>
        <p className="mp-muted">Юридический исполнитель — клиника · {clinic.offers.filter(o=>o.status!=="archived").length} услуги</p>
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
          <p className="mp-footnote">После изменения сохраните черновик в браузере.</p>
        </form>
      )}
    </article>
  );
}

export default function MyPracticePilot() {
  const [tab,setTab] = useState("overview");
  const [catalog,setCatalog] = useState(() => {
    try {return restoreDraftCatalog(sessionStorage.getItem(DRAFT_STORAGE_KEY));}
    catch {return initialDraftCatalog();}
  });
  const [schedule,setSchedule] = useState(() => {
    try {return restoreScheduleDraft(sessionStorage.getItem(SCHEDULE_DRAFT_STORAGE_KEY),catalog);}
    catch {return initialScheduleDraft();}
  });
  const [scheduleDirty,setScheduleDirty] = useState(false);
  const [scheduleMessage,setScheduleMessage] = useState("");
  const changeSchedule = next => {setSchedule(next);setScheduleDirty(true);setScheduleMessage("");};
  const saveSchedule = () => {
    try {sessionStorage.setItem(SCHEDULE_DRAFT_STORAGE_KEY,JSON.stringify(schedule));setScheduleDirty(false);setScheduleMessage("Тестовое расписание сохранено только в этой вкладке.");}
    catch {setScheduleMessage("Не удалось сохранить в браузере; изменения останутся до закрытия страницы.");}
  };
  const resetSchedule = () => {
    try {sessionStorage.removeItem(SCHEDULE_DRAFT_STORAGE_KEY);} catch {}
    setSchedule(initialScheduleDraft());setScheduleDirty(false);setScheduleMessage("Исходное учебное расписание восстановлено.");
  };
  const [dirty,setDirty] = useState(false);
  const [storageMessage,setStorageMessage] = useState("");
  const changeCatalog = next => { setCatalog(next); setDirty(true); setStorageMessage(""); };
  const saveDraft = () => {
    try { sessionStorage.setItem(DRAFT_STORAGE_KEY,JSON.stringify(catalog)); setDirty(false); setStorageMessage("Тестовый черновик сохранён только в этом браузере."); }
    catch { setStorageMessage("Браузер не разрешил локальное сохранение. Черновик остаётся только на экране."); }
  };
  const resetDraft = () => {
    try {sessionStorage.removeItem(DRAFT_STORAGE_KEY);} catch {}
    setCatalog(initialDraftCatalog());setDirty(false);setStorageMessage("Исходные демоданные восстановлены.");
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
    <header className="mp-header">
      <div>
        <p className="mp-eyebrow">Земляничные поляны · Моя практика</p>
        <h2 id="my-practice-title">Практика врача в одном пространстве</h2>
        <p>Один специалист, несколько клиник, единый каталог услуг и календарь занятости.</p>
      </div>
      <span className="mp-badge">Учебный прототип</span>
    </header>
    <div className="mp-warning" role="note">
      <strong>Только вымышленные данные.</strong> Клиники, врач, цены и расписание демонстрационные.
      Запись, оплата и медицинские действия отключены.
    </div>
    <div className="mp-doctor">
      <div className="mp-avatar" aria-hidden="true">В</div>
      <div>
        <h3>{DEMO_DOCTOR.name}</h3>
        <p>{DEMO_DOCTOR.specialty} · {DEMO_DOCTOR.city}</p>
        <p className="mp-muted">{DEMO_DOCTOR.about}</p>
      </div>
    </div>
    <div className="mp-stats" aria-label="Показатели учебной практики">
      <div><strong>{DEMO_CLINICS.length}</strong><span>места приёма</span></div>
      <div><strong>{countActiveOffers(catalog)}</strong><span>услуг в каталоге</span></div>
      <div><strong>{schedule.length}</strong><span>событий календаря</span></div>
    </div>
    <div className="mp-tabs" role="tablist" aria-label="Разделы моей практики">
      {TABS.map(t=><button key={t.id} type="button" role="tab"
        id={"mp-tab-"+t.id} aria-selected={tab===t.id} aria-controls={"mp-panel-"+t.id}
        className={tab===t.id?"mp-tab active":"mp-tab"} onClick={()=>setTab(t.id)}>{t.label}</button>)}
    </div>
    {tab==="overview" && <div role="tabpanel" id="mp-panel-overview" aria-labelledby="mp-tab-overview">
      <div className="mp-section-title"><h3>Места приёма</h3><p>Каждая клиника остаётся самостоятельным исполнителем медицинских услуг.</p></div>
      <div className="mp-two-col">{catalog.map(c=><ClinicCard clinic={c} key={c.id} onServices={switchToClinic}/>)}</div>
      <div className="mp-next">
        <h4>Как подключить врача</h4>
        <p>Согласование с клиниками → проверка услуг и цен → запись через канал клиники → календарь реальной занятости.</p>
        <button type="button" className="mp-primary" onClick={()=>setTab("calendar")}>Посмотреть учебное расписание</button>
      </div>
    </div>}
    {tab==="services" && <div role="tabpanel" id="mp-panel-services" aria-labelledby="mp-tab-services">
      <div className="mp-section-title"><h3>Каталог услуг</h3><p>Стоимость и продолжительность зависят от места приёма.</p></div>
      <div className="mp-filters">
        <label className="mp-field">Клиника<select value={clinicFilter} onChange={e=>setClinicFilter(e.target.value)}>
          <option value="all">Все клиники</option>
          {catalog.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        <label className="mp-field">Формат<select value={formatFilter} onChange={e=>setFormatFilter(e.target.value)}>
          <option value="all">Все форматы</option><option value="offline">Очный приём</option>
          <option value="online">Дистанционно*</option>
        </select></label>
      </div>
      <div className="mp-two-col">{offers.map(o=><OfferCard key={o.id} offer={o} onSaveEdit={saveOfferFromCard}/>)}</div>
      {!offers.length && <p className="mp-muted">По этим условиям учебных услуг нет.</p>}
      <div className="mp-services-save">
        <span>{dirty ? "Есть изменения, ещё не сохранённые в браузере" : (storageMessage || "Изменения можно сохранить в браузере")}</span>
        <button type="button" className="mp-primary" onClick={saveDraft}
          disabled={!dirty} data-testid="mp-save-catalog-services">Сохранить черновик в браузере</button>
      </div>
      <p className="mp-footnote">* Дистанционные медицинские услуги возможны только при соблюдении закона, правил и лицензии клиники. Это не публичная оферта.</p>
    </div>}
    {tab==="manage" && <div role="tabpanel" id="mp-panel-manage" aria-labelledby="mp-tab-manage">
      <MyPracticeCatalogEditor catalog={catalog} onChange={changeCatalog} onSave={saveDraft} onReset={resetDraft} dirty={dirty} storageMessage={storageMessage}/>
    </div>}
    {tab==="finance" && <div role="tabpanel" id="mp-panel-finance" aria-labelledby="mp-tab-finance">
      <MyPracticeFinancialDemo catalog={catalog}/>
    </div>}
    {tab==="patients" && <div role="tabpanel" id="mp-panel-patients" aria-labelledby="mp-tab-patients">
      <MyPracticePatientConnectionDemo/>
    </div>}
    {tab==="calendar" && <div role="tabpanel" id="mp-panel-calendar" aria-labelledby="mp-tab-calendar">
      <div className="mp-section-title"><h3>Общий календарь</h3><p>Редактируемые учебные записи и занятость — без реальных персональных или медицинских данных.</p></div>
      <MyPracticeCalendar catalog={catalog} entries={schedule} onChange={changeSchedule}
        onSave={saveSchedule} onReset={resetSchedule} dirty={scheduleDirty} storageMessage={scheduleMessage}
        monday={monday} setMonday={setMonday} clinic={calendarClinic} setClinic={setCalendarClinic}/>
    </div>}
  </section>;
}
