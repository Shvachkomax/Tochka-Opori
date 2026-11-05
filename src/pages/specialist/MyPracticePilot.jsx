import React, { useMemo, useState } from "react";
import {
  DEMO_DOCTOR, DEMO_CLINICS, DEMO_BUSY_BLOCKS,
  filterOffers, addDaysUTC, busyBlocksForWeek, canPublishBookingLink, rubles,
} from "../../../lib/my-practice/pilot-data.js";
import "./MyPracticePilot.css";
import MyPracticeCatalogEditor from "./MyPracticeCatalogEditor.jsx";
import {initialDraftCatalog,restoreDraftCatalog,countActiveOffers,DRAFT_STORAGE_KEY} from "../../../lib/my-practice/catalog-draft.js";

// Чистый визуальный прототип. Никаких запросов к API, личных или медицинских данных.
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const TABS = [
  { id: "overview", label: "Обзор" },
  { id: "services", label: "Услуги" },
  { id: "calendar", label: "Занятость" },
  { id: "manage", label: "Управление" },
];
const formatDay = day => new Intl.DateTimeFormat("ru-RU", {
  day:"numeric", month:"short", timeZone:"UTC",
}).format(new Date(day + "T12:00:00Z"));

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

function OfferCard({ offer }) {
  const verified = canPublishBookingLink({
    clinicApproved:offer.verifiedForPublication,
    doctorAuthorized:false,
    bookingUrl:offer.bookingUrl,
  });
  return (
    <article className="mp-offer" data-testid={"my-practice-offer-" + offer.id}>
      <div className="mp-offer-top">
        <span className="mp-format">{offer.format === "online" ? "Дистанционно*" : "Очно"}</span>
        <strong>{rubles(offer.priceRub)}</strong>
      </div>
      <h4>{offer.name}</h4>
      <p>{offer.clinicName}</p>
      <p className="mp-muted">{offer.minutes} мин · {offer.address}</p>
      {verified
        ? <a href={offer.bookingUrl} target="_blank" rel="noopener noreferrer">Перейти к записи клиники</a>
        : <p className="mp-booking-disabled">Запись недоступна: требуется подключение клиники</p>}
    </article>
  );
}

function Calendar({ monday, setMonday, clinic, setClinic }) {
  const blocks = useMemo(() => busyBlocksForWeek(DEMO_BUSY_BLOCKS, monday, clinic), [monday, clinic]);
  const clinicsById = new Map(DEMO_CLINICS.map(c => [c.id, c]));
  return (
    <section aria-label="Демонстрационный календарь занятости" data-testid="my-practice-calendar">
      <div className="mp-calendar-controls">
        <div className="mp-week-nav">
          <button type="button" onClick={() => setMonday(addDaysUTC(monday,-7))} aria-label="Предыдущая неделя">‹</button>
          <strong>{formatDay(monday)} — {formatDay(addDaysUTC(monday,6))}</strong>
          <button type="button" onClick={() => setMonday(addDaysUTC(monday,7))} aria-label="Следующая неделя">›</button>
        </div>
        <label className="mp-field">Место приёма
          <select value={clinic} onChange={event=>setClinic(event.target.value)}>
            <option value="all">Все клиники</option>
            {DEMO_CLINICS.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <div className="mp-calendar-scroll">
        <div className="mp-week-grid">
          {DAYS.map((label,index)=>{
            const day = addDaysUTC(monday,index);
            const dayBlocks = blocks.filter(b=>b.day===day);
            return <div className="mp-day" key={day} data-testid={"my-practice-day-"+day}>
              <div className="mp-day-head"><strong>{label}</strong><span>{formatDay(day)}</span></div>
              {dayBlocks.length ? dayBlocks.map(b=>{
                const place=clinicsById.get(b.clinicId);
                return <div key={b.id} className="mp-busy" style={{borderLeftColor:place?.color||"#89978f"}}>
                  <strong>{b.start}–{b.end}</strong>
                  <span>{place?.name||"Демо-клиника"}</span>
                  <small>Занят · демо</small>
                </div>;
              }) : <p className="mp-no-block">Нет сведений о занятости</p>}
            </div>;
          })}
        </div>
      </div>
      <p className="mp-footnote">Это занятость, а не свободные слоты. Пустое время не означает доступную запись. Синхронизации с клиниками нет.</p>
    </section>
  );
}

export default function MyPracticePilot() {
  const [tab,setTab] = useState("overview");
  const [catalog,setCatalog] = useState(() => {
    try {return restoreDraftCatalog(sessionStorage.getItem(DRAFT_STORAGE_KEY));}
    catch {return initialDraftCatalog();}
  });
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
      <div><strong>{DEMO_BUSY_BLOCKS.length}</strong><span>блоков занятости</span></div>
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
      <div className="mp-two-col">{offers.map(o=><OfferCard key={o.id} offer={o}/>)}</div>
      {!offers.length && <p className="mp-muted">По этим условиям учебных услуг нет.</p>}
      <p className="mp-footnote">* Дистанционные медицинские услуги возможны только при соблюдении закона, правил и лицензии клиники. Это не публичная оферта.</p>
    </div>}
    {tab==="manage" && <div role="tabpanel" id="mp-panel-manage" aria-labelledby="mp-tab-manage">
      <MyPracticeCatalogEditor catalog={catalog} onChange={changeCatalog} onSave={saveDraft} onReset={resetDraft} dirty={dirty} storageMessage={storageMessage}/>
    </div>}
    {tab==="calendar" && <div role="tabpanel" id="mp-panel-calendar" aria-labelledby="mp-tab-calendar">
      <div className="mp-section-title"><h3>Общая занятость</h3><p>Без фамилий пациентов, диагнозов и медицинских сведений.</p></div>
      <Calendar monday={monday} setMonday={setMonday} clinic={calendarClinic} setClinic={setCalendarClinic}/>
    </div>}
  </section>;
}
