import React, { useCallback, useEffect, useState } from "react";
import PracticeTour from "./PracticeTour.jsx";
import { tourStepReady, tourStorageKey } from "../../../lib/my-practice/onboarding-tour.js";

// Authenticated, server-backed «Моя практика» for the test contour.
// Places, services, availability and bookings come only from Test Supabase.

const fieldStyle = { width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" };
const primaryStyle = { padding: "9px 16px", borderRadius: 9, background: "#2F5D50", color: "#fff", border: 0, fontWeight: 700, cursor: "pointer" };
const secondaryStyle = { padding: "6px 10px", borderRadius: 8, background: "#fff", border: "1px solid #ddd", cursor: "pointer" };
const formats = { offline: "Очно", online: "Онлайн", phone: "По телефону", video: "Видеосвязь" };
const weekdays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

async function callPractice(action, data = {}) {
  const response = await fetch("/api/practice-booking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action, ...data }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || "Ошибка запроса");
  return result;
}

function PlaceForm({ item, organizationId, onSaved, onCancel }) {
  const [name, setName] = useState(item?.name || "");
  const [address, setAddress] = useState(item?.address || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setName(item?.name || ""); setAddress(item?.address || ""); }, [item]);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await callPractice("savePracticePlace", { id: item?.id, name, address, organization_id: organizationId });
      setName(""); setAddress(""); await onSaved(); onCancel?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} data-testid="a2-place-form">
    <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Название
      <input data-testid="a2-place-name" value={name} onChange={(event) => setName(event.target.value)} required style={fieldStyle} />
    </label>
    <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Адрес (необязательно)
      <input value={address} onChange={(event) => setAddress(event.target.value)} style={fieldStyle} />
    </label>
    <button disabled={busy} data-testid="a2-place-save" style={primaryStyle}>{busy ? "Сохранение…" : item ? "Сохранить место" : "Добавить место"}</button>
    {item && <button type="button" onClick={onCancel} style={{ ...secondaryStyle, marginLeft: 8 }}>Отмена</button>}
    {error && <p role="alert" style={{ color: "#a33" }}>{error}</p>}
  </form>;
}

function ServiceForm({ item, places, organizationId, module, allowedModules, onSaved, onCancel }) {
  const [name, setName] = useState(item?.name || "");
  const [price, setPrice] = useState(item ? String(item.price_kop / 100) : "");
  const [duration, setDuration] = useState(String(item?.duration_min || 60));
  const [placeId, setPlaceId] = useState(item?.place_id || "");
  const [format, setFormat] = useState(item?.format || "offline");
  const defaultModules = module === "all" ? allowedModules : [module];
  const [modules, setModules] = useState(item?.modules?.length ? item.modules : defaultModules);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setName(item?.name || ""); setPrice(item ? String(item.price_kop / 100) : "");
    setDuration(String(item?.duration_min || 60)); setPlaceId(item?.place_id || "");
    setFormat(item?.format || "offline");
    setModules(item?.modules?.length ? item.modules : (module === "all" ? allowedModules : [module]));
  }, [item, module, allowedModules]);
  async function submit(event) {
    event.preventDefault();
    if (!modules.length) { setError("Выберите Support, Health или оба раздела."); return; }
    setBusy(true); setError("");
    try {
      await callPractice("savePracticeService", {
        id: item?.id, name, price_kop: Math.round(Number(price) * 100), duration_min: Number(duration),
        place_id: placeId || null, format, modules, module, is_active: true, organization_id: organizationId,
      });
      setName(""); setPrice(""); await onSaved(); onCancel?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} data-testid="a2-service-form">
    <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Название
      <input data-testid="a2-service-name" value={name} onChange={(event) => setName(event.target.value)} required style={fieldStyle} />
    </label>
    <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Цена, ₽
      <input data-testid="a2-service-price" type="number" min="0" step="1" value={price} onChange={(event) => setPrice(event.target.value)} required style={fieldStyle} />
    </label>
    <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Длительность, минут
      <input type="number" min="15" max="240" step="5" value={duration} onChange={(event) => setDuration(event.target.value)} style={fieldStyle} />
    </label>
    <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Формат
      <select value={format} onChange={(event) => setFormat(event.target.value)} style={fieldStyle}>
        {Object.entries(formats).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Место приёма
      <select data-testid="a2-service-place" value={placeId} onChange={(event) => setPlaceId(event.target.value)} style={fieldStyle}>
        <option value="">Без места</option>
        {places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
      </select>
    </label>
    {!places.length && <p>Добавьте место работы или выберите онлайн-формат.</p>}
    <fieldset style={{ border: 0, padding: 0, margin: "10px 0" }}>
      <legend style={{ fontSize: 13, marginBottom: 6 }}>Показывать услугу в кабинетах</legend>
      {[["support", "Support"], ["body", "Health"]].map(([value, label]) => (
        <label key={value} style={{ display: "inline-flex", gap: 6, alignItems: "center", marginRight: 14 }}>
          <input type="checkbox" data-testid={`a2-service-module-${value}`} checked={modules.includes(value)} disabled={!allowedModules.includes(value)}
            onChange={(event) => setModules((current) => event.target.checked
              ? [...new Set([...current, value])]
              : current.filter((entry) => entry !== value))} />
          {label}
        </label>
      ))}
    </fieldset>
    <button disabled={busy} data-testid="a2-service-save" style={primaryStyle}>{busy ? "Сохранение…" : item ? "Сохранить услугу" : "Добавить услугу"}</button>
    {item && <button type="button" onClick={onCancel} style={{ ...secondaryStyle, marginLeft: 8 }}>Отмена</button>}
    {error && <p role="alert" style={{ color: "#a33" }}>{error}</p>}
  </form>;
}

function AvailabilityForm({ item, organizationId, onSaved, onCancel }) {
  const [weekday, setWeekday] = useState(String(item?.weekday || 1));
  const [startTime, setStartTime] = useState(item?.start_time || "09:00");
  const [endTime, setEndTime] = useState(item?.end_time || "18:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setWeekday(String(item?.weekday || 1)); setStartTime(item?.start_time || "09:00"); setEndTime(item?.end_time || "18:00");
  }, [item]);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await callPractice("savePracticeAvailability", {
        id: item?.id, organization_id: organizationId, weekday: Number(weekday), start_time: startTime, end_time: endTime,
      });
      await onSaved(); onCancel?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} data-testid="a2-availability-form" style={{ marginTop: 8 }}>
    <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>День недели
      <select data-testid="a2-availability-weekday" value={weekday} onChange={(event) => setWeekday(event.target.value)} style={fieldStyle}>
        {weekdays.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
      </select>
    </label>
    <div style={{ display: "flex", gap: 8 }}>
      <label style={{ flex: 1, fontSize: 13 }}>С<input data-testid="a2-availability-start" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} style={fieldStyle} /></label>
      <label style={{ flex: 1, fontSize: 13 }}>До<input data-testid="a2-availability-end" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} style={fieldStyle} /></label>
    </div>
    <button disabled={busy} data-testid="a2-availability-save" style={{ ...primaryStyle, marginTop: 10 }}>{busy ? "Сохраняем…" : item ? "Сохранить часы" : "Добавить рабочие часы"}</button>
    {item && <button type="button" onClick={onCancel} style={{ ...secondaryStyle, marginLeft: 8 }}>Отмена</button>}
    {error && <p role="alert" style={{ color: "#a33" }}>{error}</p>}
  </form>;
}

function AvailabilityExceptionForm({ organizationId, onSaved, onCancel }) {
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await callPractice("savePracticeAvailability", {
        organization_id: organizationId, weekday: 0, exception_date: date,
        start_time: "00:00", end_time: "23:59", note,
      });
      await onSaved(); onCancel?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} data-testid="a2-availability-exception-form" style={{ marginTop: 10, padding: 12, background: "#F8F4EC", borderRadius: 10 }}>
    <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Дата выходного или исключения
      <input data-testid="a2-availability-exception-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required style={fieldStyle} />
    </label>
    <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Комментарий (необязательно)
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Например: отпуск" style={fieldStyle} />
    </label>
    <button disabled={busy} data-testid="a2-availability-exception-save" style={primaryStyle}>{busy ? "Сохраняем…" : "Добавить исключение"}</button>
    <button type="button" onClick={onCancel} style={{ ...secondaryStyle, marginLeft: 8 }}>Отмена</button>
    {error && <p role="alert" style={{ color: "#a33" }}>{error}</p>}
  </form>;
}

export default function PracticeBookingPanel({
  organizationId = null,
  module = "support",
  allowedModules = ["support", "body"],
  storageScope = "server-practice",
  onBookingsChange,
  section = "all",
  bookingScope = "current",
  financeScope = "current",
  organizationName = "Частная практика",
  memberships = [],
  onOpenClient,
  tour,
}) {
  const serviceAllowedModules = Array.isArray(allowedModules) && allowedModules.length ? allowedModules : [module];
  const [places, setPlaces] = useState([]);
  const [services, setServices] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [finance, setFinance] = useState(null);
  const [editingPlace, setEditingPlace] = useState(null);
  const [editingService, setEditingService] = useState(null);
  const [editingAvailability, setEditingAvailability] = useState(null);
  const [showAvailabilityForm, setShowAvailabilityForm] = useState(false);
  const [showExceptionForm, setShowExceptionForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [calendarView, setCalendarView] = useState("list");

  const reload = useCallback(async () => {
    setError(""); setInfo(""); setLoading(true);
    const context = { organization_id: organizationId };
    try {
      const [placeResult, serviceResult, availabilityResult, bookingResult, financeResult] = await Promise.all([
        callPractice("listPracticePlaces", context), callPractice("listPracticeServices", context),
        callPractice("listPracticeAvailability", context),
        callPractice("listPracticeBookings", { ...context, module, organization_scope: bookingScope === "all" ? "all" : undefined }),
        callPractice("getPracticeFinance", { ...context, module, organization_scope: financeScope === "all" ? "all" : undefined }),
      ]);
      setPlaces(placeResult.places || []); setServices(serviceResult.services || []);
      setAvailability(availabilityResult.availability || []); setBookings(bookingResult.bookings || []);
      setFinance(financeResult); onBookingsChange?.(bookingResult.bookings || []);
    } catch (err) {
      setError(`${err.message || "Не удалось загрузить."} Данные не заменены пустым состоянием.`);
    } finally { setLoading(false); }
  }, [organizationId, module, bookingScope, financeScope, onBookingsChange]);
  useEffect(() => { reload(); }, [reload]);

  async function mutate(action, payload, success) {
    setError(""); setInfo("");
    try {
      await callPractice(action, { organization_id: organizationId, ...payload });
      await reload(); setInfo(success);
    } catch (err) { setError(err.message); }
  }
  async function complete(booking) { await mutate("completePracticeBooking", { booking_id: booking.id, module: booking.module }, "Приём завершён."); }
  async function restoreDefaultAvailability() {
    const confirmed = window.confirm("Восстановить расписание 09:00–18:00 на все дни недели? Текущие часы и исключения будут отключены. Существующие записи пациентов сохранятся.");
    if (!confirmed) return;
    await mutate("resetPracticeAvailabilityDefaults", { confirmed: true }, "Стандартное расписание восстановлено.");
    setEditingAvailability(null); setShowAvailabilityForm(false); setShowExceptionForm(false);
  }

  const tourKey = tourStorageKey(storageScope);
  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(() => {
    try { const value = Number(localStorage.getItem(tourKey)); return Number.isInteger(value) && value >= 0 && value < 3 ? value : 0; }
    catch { return 0; }
  });
  const controlledTour = Boolean(tour);
  const currentTourStep = controlledTour ? tour.step : tourStep;
  const currentTourActive = controlledTour ? tour.active : tourActive;
  function openTour() {
    if (controlledTour) return tour.onStart?.();
    setTourStep(0); setTourActive(true);
  }
  function changeTourStep(next) {
    if (controlledTour) return tour.onStep?.(next);
    setTourStep(next); try { localStorage.setItem(tourKey, String(next)); } catch {}
  }
  function closeTour() {
    if (controlledTour) return tour.onClose?.();
    setTourActive(false); try { localStorage.setItem(tourKey, String(tourStep)); } catch {}
  }
  function finishTour() {
    if (controlledTour) return tour.onFinish?.();
    setTourActive(false); setTourStep(0); try { localStorage.removeItem(tourKey); } catch {}
  }
  const activeServices = services.filter((service) => service.is_active);
  const weeklyAvailability = availability.filter((entry) => !entry.exception_date && entry.weekday >= 1 && entry.weekday <= 7);
  const availabilityExceptions = availability.filter((entry) => entry.exception_date && entry.is_active !== false);
  const savedWeekdays = new Set(weeklyAvailability.map((entry) => entry.weekday));

  const showOverview = section === "overview";
  const showPlaces = section === "all" || section === "places" || (currentTourActive && currentTourStep === 0);
  const showServices = section === "all" || section === "services" || (currentTourActive && currentTourStep === 1);
  const showCalendar = section === "all" || section === "calendar" || (currentTourActive && currentTourStep === 2);
  const showFinance = section === "all" || section === "finance";
  const upcomingBookings = bookings.filter((booking) => new Date(booking.starts_at).getTime() >= Date.now()).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const todayKey = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const visibleBookings = calendarView === "day"
    ? upcomingBookings.filter((booking) => String(booking.starts_at).slice(0, 10) === todayKey)
    : calendarView === "week"
      ? upcomingBookings.filter((booking) => new Date(booking.starts_at) < weekEnd)
      : upcomingBookings;

  return <section className="my-practice-pilot" data-testid="a2-booking-panel" style={{ border: "1px solid #e3ddcf", borderRadius: 16, padding: 20, background: "#FFFEFB", maxWidth: 860, margin: "0 auto" }}>
    <h2 style={{ margin: "0 0 8px" }}>{showOverview ? "Практика" : section === "calendar" ? "Календарь и расписание" : section === "services" ? "Услуги и цены" : section === "places" ? "Места работы" : section === "finance" ? "Финансы" : "Моя практика"}</h2>
    <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>Данные сохраняются на сервере и показываются только в разрешённом рабочем контексте.</p>
    {showOverview && <>
      <button type="button" onClick={openTour} data-testid="mp-start-tour" style={secondaryStyle}>▶ Обучение по кабинету</button>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16, fontSize: 13, color: "#4D5D55" }}>
        <span>Мест: {places.length}</span><span>·</span><span>Опубликованных услуг: {activeServices.length}</span><span>·</span><span>Предстоящих записей: {upcomingBookings.length}</span>
      </div>
    </>}
    {loading && <p role="status">Обновляем серверные данные…</p>}
    {error && <p role="alert" style={{ color: "#a33" }}>{error}</p>}
    {info && <p role="status" style={{ color: "#2F5D50" }}>{info}</p>}

    {showPlaces && <div data-tour-target="places">
      <h3>Места работы</h3>
      <p style={{ fontSize: 13, color: "#666" }}>Текущий рабочий контекст: <strong>{organizationName}</strong>. Физическое место приёма не даёт доступа к данным организации.</p>
      {memberships.length > 0 && <p style={{ fontSize: 12, color: "#777" }}>Подтверждённые организации: {memberships.map((membership) => membership.organization_name || "Организация").join(", ")}.</p>}
      {!places.length && !loading && <p>Добавьте место работы или онлайн-приём.</p>}
      {places.map((place) => <div key={place.id} data-testid="a2-place-row" style={{ padding: "7px 0", borderBottom: "1px solid #eee" }}>
        <strong>{place.name}</strong>{place.address ? <span style={{ color: "#777" }}> · {place.address}</span> : null}
        <button type="button" onClick={() => setEditingPlace(place)} style={{ ...secondaryStyle, marginLeft: 8 }}>Редактировать</button>
        <button type="button" onClick={() => mutate("deletePracticePlace", { id: place.id }, "Место удалено.")} style={{ ...secondaryStyle, marginLeft: 6 }}>Удалить</button>
      </div>)}
      <PlaceForm key={editingPlace?.id || "new-place"} item={editingPlace} organizationId={organizationId} onSaved={reload} onCancel={() => setEditingPlace(null)} />
    </div>}

    {showServices && <div data-tour-target="services">
      <h3>Услуги</h3>
      {!services.length && !loading && <p>Услуг пока нет. Новая услуга остаётся черновиком, пока вы явно не включите публикацию.</p>}
      {services.map((service) => <div key={service.id} data-testid="a2-service-row" style={{ padding: "7px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
        <strong>{service.name}</strong> · {formats[service.format]} · {service.duration_min} мин · {(service.price_kop / 100).toLocaleString("ru-RU")} ₽ · {Number(service.price_credits || 0).toLocaleString("ru-RU")} кредитов · {(service.modules || ["support", "body"]).map((entry) => entry === "body" ? "Health" : "Support").join(" + ")} · <span>{service.is_active ? "Опубликована" : "Черновик"}</span>
        <button type="button" onClick={() => setEditingService(service)} style={{ ...secondaryStyle, marginLeft: 8 }}>Редактировать</button>
        {service.is_active && <button type="button" onClick={() => mutate("deactivatePracticeService", { id: service.id }, "Публикация услуги остановлена.")} style={{ ...secondaryStyle, marginLeft: 6 }}>Снять с публикации</button>}
      </div>)}
      <ServiceForm key={editingService?.id || `new-service-${module}`} item={editingService} places={places} organizationId={organizationId} module={module} allowedModules={serviceAllowedModules} onSaved={reload} onCancel={() => setEditingService(null)} />
    </div>}

    {showCalendar && <div data-tour-target="calendar">
      <h3>Расписание</h3>
      <p style={{ fontSize: 13, color: "#666" }}>Рабочие часы сохраняются на сервере. Выходные и исключения не создают свободных слотов.</p>
      {!weeklyAvailability.length && !loading && <p style={{ fontSize: 13, color: "#777" }}>Рабочие часы пока не заданы.</p>}
      {weeklyAvailability.map((entry) => <div key={entry.id} data-testid="a2-availability-row" style={{ padding: "9px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
        <strong>{weekdays[entry.weekday - 1]}</strong> · {entry.is_active === false ? "Выходной" : `${entry.start_time}–${entry.end_time}`}
        <button type="button" onClick={() => { setEditingAvailability(entry); setShowAvailabilityForm(true); }} style={{ ...secondaryStyle, marginLeft: 8 }}>Редактировать</button>
        <button type="button" onClick={() => mutate("setPracticeAvailabilityStatus", { id: entry.id, is_active: entry.is_active === false }, entry.is_active === false ? "День снова рабочий." : "День отмечен выходным.")} style={{ ...secondaryStyle, marginLeft: 6 }}>
          {entry.is_active === false ? "Сделать рабочим" : "Сделать выходным"}
        </button>
      </div>)}
      {savedWeekdays.size < 7 && !showAvailabilityForm && <button type="button" onClick={() => { setEditingAvailability(null); setShowAvailabilityForm(true); }} style={{ ...secondaryStyle, marginTop: 10 }}>Добавить рабочий интервал</button>}
      {showAvailabilityForm && <AvailabilityForm key={editingAvailability?.id || "new-availability"} item={editingAvailability} organizationId={organizationId} onSaved={reload} onCancel={() => { setEditingAvailability(null); setShowAvailabilityForm(false); }} />}

      <div style={{ marginTop: 16 }}>
        <strong style={{ fontSize: 14 }}>Исключения</strong>
        {!availabilityExceptions.length && <p style={{ fontSize: 13, color: "#777" }}>Исключений пока нет.</p>}
        {availabilityExceptions.map((entry) => <div key={entry.id} data-testid="a2-availability-exception-row" style={{ padding: "7px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
          {new Date(`${entry.exception_date}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
          {entry.note ? ` · ${entry.note}` : " · выходной"}
          <button type="button" onClick={() => mutate("deletePracticeAvailability", { id: entry.id }, "Исключение удалено.")} style={{ ...secondaryStyle, marginLeft: 8 }}>Удалить исключение</button>
        </div>)}
        {!showExceptionForm && <button type="button" onClick={() => setShowExceptionForm(true)} style={{ ...secondaryStyle, marginTop: 10 }}>Добавить исключение</button>}
        {showExceptionForm && <AvailabilityExceptionForm organizationId={organizationId} onSaved={reload} onCancel={() => setShowExceptionForm(false)} />}
      </div>
      <button type="button" onClick={restoreDefaultAvailability} data-testid="a2-availability-reset" style={{ ...secondaryStyle, marginTop: 14 }}>Восстановить 09:00–18:00 на всю неделю</button>
      <h3 style={{ marginTop: 22 }}>Записи пациентов</h3>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }} aria-label="Вид календаря">
        {[["day", "День"], ["week", "Неделя"], ["list", "Список"]].map(([value, label]) => <button key={value} type="button" onClick={() => setCalendarView(value)} style={{ ...secondaryStyle, ...(calendarView === value ? { borderColor: "#2F5D50", color: "#2F5D50", fontWeight: 700 } : {}) }}>{label}</button>)}
        <button type="button" onClick={reload} data-testid="a2-refresh-bookings" style={secondaryStyle}>Обновить</button>
      </div>
      {!visibleBookings.length && !loading && <p style={{ fontSize: 13, color: "#777" }}>Предстоящих записей для выбранного вида нет.</p>}
      {visibleBookings.map((booking) => <div key={booking.id} data-testid="a2-booking-row" style={{ padding: "9px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
        <div><strong>{new Date(booking.starts_at).toLocaleString("ru-RU")}</strong> · {booking.practice_services?.name || "Приём"}</div>
        <div style={{ color: "#666", fontSize: 12, marginTop: 3 }}>{booking.module === "body" ? "Health" : "Support"} · {booking.organization_name || "Частная практика"}{booking.place_name ? ` · ${booking.place_name}` : ""} · {booking.status}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
          {booking.client_ref && <button type="button" onClick={() => onOpenClient?.({ client_ref: booking.client_ref, module: booking.module })} style={secondaryStyle}>Открыть карту</button>}
          {booking.status === "confirmed" && (booking.organization_id || null) === (organizationId || null) && <button onClick={() => complete(booking)} data-testid="a2-complete" style={primaryStyle}>Приём завершён</button>}
        </div>
      </div>)}
    </div>}

    {showFinance && <div data-testid="practice-finance-section">
      <h3>Финансы</h3>
      {!finance?.transactions?.length && !loading ? <p style={{ fontSize: 13, color: "#777" }}>Проведённых операций в выбранном контексте пока нет.</p> : <>
        <p>Начислено специалисту (условные кредиты): <strong>{Number(finance?.specialist_credits || 0).toLocaleString("ru-RU")} кредитов</strong>.</p>
        <p>Комиссия сервиса по проведённым операциям: {Number(finance?.service_fee_credits || 0).toLocaleString("ru-RU")} кредитов. Выплаты в рублях не подключены.</p>
        {(finance?.breakdown || []).map((item) => <div key={`${item.module}:${item.organization_id || "private"}`} style={{ padding: "9px 0", borderBottom: "1px solid #eee", fontSize: 13 }}>
          <strong>{item.module === "body" ? "Health" : "Support"}</strong> · {item.organization_name}: {Number(item.booking_cost_kop / 100).toLocaleString("ru-RU")} ₽ записей, комиссия {Number(item.commission_kop / 100).toLocaleString("ru-RU")} ₽, списано {Number(item.charged_credits).toLocaleString("ru-RU")} кредитов, возврат {Number(item.refunded_credits).toLocaleString("ru-RU")}
        </div>)}
      </>}
      <p style={{ fontSize: 12, color: "#999" }}>Суммы основаны на сохранённых кредитных операциях; внешние платежи и выплаты не имитируются.</p>
    </div>}

    {currentTourActive && <PracticeTour step={currentTourStep}
      onNext={() => currentTourStep === 2 ? finishTour() : changeTourStep(currentTourStep + 1)}
      onSkip={() => currentTourStep === 2 ? finishTour() : changeTourStep(currentTourStep + 1)}
      onClose={closeTour}
      ready={tourStepReady(currentTourStep, { places: places.length, offers: activeServices.length, events: weeklyAvailability.filter((entry) => entry.is_active !== false).length, dirty: false, scheduleDirty: false })} />}
  </section>;
}
