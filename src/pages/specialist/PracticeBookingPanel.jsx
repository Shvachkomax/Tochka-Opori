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

function ServiceForm({ item, places, organizationId, onSaved, onCancel }) {
  const [name, setName] = useState(item?.name || "");
  const [price, setPrice] = useState(item ? String(item.price_kop / 100) : "");
  const [duration, setDuration] = useState(String(item?.duration_min || 60));
  const [placeId, setPlaceId] = useState(item?.place_id || "");
  const [format, setFormat] = useState(item?.format || "offline");
  const [published, setPublished] = useState(item?.is_active === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setName(item?.name || ""); setPrice(item ? String(item.price_kop / 100) : "");
    setDuration(String(item?.duration_min || 60)); setPlaceId(item?.place_id || "");
    setFormat(item?.format || "offline"); setPublished(item?.is_active === true);
  }, [item]);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await callPractice("savePracticeService", {
        id: item?.id, name, price_kop: Math.round(Number(price) * 100), duration_min: Number(duration),
        place_id: placeId || null, format, is_active: published, organization_id: organizationId,
      });
      setName(""); setPrice(""); setPublished(false); await onSaved(); onCancel?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} data-testid="a2-service-form">
    <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Название
      <input data-testid="a2-service-name" value={name} onChange={(event) => setName(event.target.value)} required style={fieldStyle} />
    </label>
    <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Цена, ₽
      <input data-testid="a2-service-price" type="number" min="0" step="1" value={price} onChange={(event) => setPrice(event.target.value)} required style={fieldStyle} />
    </label>
    <p>Пациент увидит {Math.ceil(Number(price || 0) * 10).toLocaleString("ru-RU")} кредитов. Курс 10 кредитов = 1 ₽.</p>
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
    <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0" }}>
      <input data-testid="a2-service-published" type="checkbox" checked={published} onChange={(event) => setPublished(event.target.checked)} />
      Опубликовать для прикреплённых пациентов
    </label>
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

export default function PracticeBookingPanel({ organizationId = null, storageScope = "server-practice", onBookingsChange }) {
  const [places, setPlaces] = useState([]);
  const [services, setServices] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [finance, setFinance] = useState(null);
  const [editingPlace, setEditingPlace] = useState(null);
  const [editingService, setEditingService] = useState(null);
  const [editingAvailability, setEditingAvailability] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const reload = useCallback(async () => {
    setError(""); setInfo(""); setLoading(true);
    const context = { organization_id: organizationId };
    try {
      const [placeResult, serviceResult, availabilityResult, bookingResult, financeResult] = await Promise.all([
        callPractice("listPracticePlaces", context), callPractice("listPracticeServices", context),
        callPractice("listPracticeAvailability", context), callPractice("listPracticeBookings", context),
        callPractice("getPracticeFinance", context),
      ]);
      setPlaces(placeResult.places || []); setServices(serviceResult.services || []);
      setAvailability(availabilityResult.availability || []); setBookings(bookingResult.bookings || []);
      setFinance(financeResult); onBookingsChange?.(bookingResult.bookings || []);
    } catch (err) {
      setError(`${err.message || "Не удалось загрузить."} Данные не заменены пустым состоянием.`);
    } finally { setLoading(false); }
  }, [organizationId, onBookingsChange]);
  useEffect(() => { reload(); }, [reload]);

  async function mutate(action, payload, success) {
    setError(""); setInfo("");
    try {
      await callPractice(action, { organization_id: organizationId, ...payload });
      await reload(); setInfo(success);
    } catch (err) { setError(err.message); }
  }
  async function complete(id) { await mutate("completePracticeBooking", { booking_id: id }, "Приём завершён."); }

  const tourKey = tourStorageKey(storageScope);
  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(() => {
    try { const value = Number(localStorage.getItem(tourKey)); return Number.isInteger(value) && value >= 0 && value < 3 ? value : 0; }
    catch { return 0; }
  });
  function openTour() { setTourStep(0); setTourActive(true); }
  function changeTourStep(next) { setTourStep(next); try { localStorage.setItem(tourKey, String(next)); } catch {} }
  function closeTour() { setTourActive(false); try { localStorage.setItem(tourKey, String(tourStep)); } catch {} }
  function finishTour() { setTourActive(false); setTourStep(0); try { localStorage.removeItem(tourKey); } catch {} }
  const activeServices = services.filter((service) => service.is_active);

  return <section className="my-practice-pilot" data-testid="a2-booking-panel" style={{ border: "1px solid #e3ddcf", borderRadius: 16, padding: 20, background: "#FFFEFB", maxWidth: 640, margin: "0 auto" }}>
    <h2 style={{ margin: "0 0 8px" }}>Моя практика</h2>
    <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>Серверный каталог тестового контура: места, услуги, рабочие часы и записи пациентов.</p>
    <button type="button" onClick={openTour} data-testid="mp-start-tour" style={secondaryStyle}>▶ Обучение по кабинету</button>
    {loading && <p role="status">Обновляем серверные данные…</p>}
    {error && <p role="alert" style={{ color: "#a33" }}>{error}</p>}
    {info && <p role="status" style={{ color: "#2F5D50" }}>{info}</p>}

    <div data-tour-target="places">
      <h3>Места работы</h3>
      {!places.length && !loading && <p>Добавьте место работы или онлайн-приём.</p>}
      {places.map((place) => <div key={place.id} data-testid="a2-place-row" style={{ padding: "7px 0", borderBottom: "1px solid #eee" }}>
        <strong>{place.name}</strong>{place.address ? <span style={{ color: "#777" }}> · {place.address}</span> : null}
        <button type="button" onClick={() => setEditingPlace(place)} style={{ ...secondaryStyle, marginLeft: 8 }}>Редактировать</button>
        <button type="button" onClick={() => mutate("deletePracticePlace", { id: place.id }, "Место удалено.")} style={{ ...secondaryStyle, marginLeft: 6 }}>Удалить</button>
      </div>)}
      <PlaceForm key={editingPlace?.id || "new-place"} item={editingPlace} organizationId={organizationId} onSaved={reload} onCancel={() => setEditingPlace(null)} />
    </div>

    <div data-tour-target="services">
      <h3>Услуги</h3>
      {!services.length && !loading && <p>Услуг пока нет. Новая услуга остаётся черновиком, пока вы явно не включите публикацию.</p>}
      {services.map((service) => <div key={service.id} data-testid="a2-service-row" style={{ padding: "7px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
        <strong>{service.name}</strong> · {formats[service.format]} · {service.duration_min} мин · {(service.price_kop / 100).toLocaleString("ru-RU")} ₽ · {Number(service.price_credits || 0).toLocaleString("ru-RU")} кредитов · <span>{service.is_active ? "Опубликована" : "Черновик"}</span>
        <button type="button" onClick={() => setEditingService(service)} style={{ ...secondaryStyle, marginLeft: 8 }}>Редактировать</button>
        {service.is_active && <button type="button" onClick={() => mutate("deactivatePracticeService", { id: service.id }, "Публикация услуги остановлена.")} style={{ ...secondaryStyle, marginLeft: 6 }}>Снять с публикации</button>}
      </div>)}
      <ServiceForm key={editingService?.id || "new-service"} item={editingService} places={places} organizationId={organizationId} onSaved={reload} onCancel={() => setEditingService(null)} />
    </div>

    <div data-tour-target="calendar">
      <h3>Расписание</h3>
      {!availability.length && !loading && <p style={{ fontSize: 13, color: "#777" }}>Рабочие часы пока не заданы.</p>}
      {availability.map((entry) => <div key={entry.id} data-testid="a2-availability-row" style={{ padding: "7px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
        {entry.weekday >= 1 && entry.weekday <= 7 ? weekdays[entry.weekday - 1] : "Дата"} · {entry.start_time}–{entry.end_time}
        <button type="button" onClick={() => setEditingAvailability(entry)} style={{ ...secondaryStyle, marginLeft: 8 }}>Редактировать</button>
        <button type="button" onClick={() => mutate("deletePracticeAvailability", { id: entry.id }, "Рабочие часы удалены.")} style={{ ...secondaryStyle, marginLeft: 6 }}>Удалить</button>
      </div>)}
      <AvailabilityForm key={editingAvailability?.id || "new-availability"} item={editingAvailability} organizationId={organizationId} onSaved={reload} onCancel={() => setEditingAvailability(null)} />
    </div>

    <h3>Записи пациентов</h3>
    <button type="button" onClick={reload} data-testid="a2-refresh-bookings" style={secondaryStyle}>Обновить записи</button>
    {!bookings.length && !loading && <p style={{ fontSize: 13, color: "#777" }}>Записей пока нет.</p>}
    {bookings.map((booking) => <div key={booking.id} data-testid="a2-booking-row" style={{ padding: "7px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
      <span>{new Date(booking.starts_at).toLocaleString("ru-RU")}</span> · {booking.practice_services?.name || "Приём"} · {booking.status}
      {booking.status === "confirmed" && <button onClick={() => complete(booking.id)} data-testid="a2-complete" style={{ ...primaryStyle, marginLeft: 10 }}>Приём завершён</button>}
    </div>)}

    <h3>Финансы</h3>
    <p>Начислено специалисту: <strong>{Number(finance?.specialist_credits || 0).toLocaleString("ru-RU")} кредитов</strong>.</p>
    <p>Комиссия сервиса: {Number(finance?.service_fee_credits || 0).toLocaleString("ru-RU")} кредитов. Выплаты в рублях не подключены.</p>
    <p style={{ fontSize: 12, color: "#999" }}>Опубликовано услуг: {activeServices.length}. Рабочих интервалов: {availability.length}.</p>

    {tourActive && <PracticeTour step={tourStep}
      onNext={() => tourStep === 2 ? finishTour() : changeTourStep(tourStep + 1)}
      onSkip={() => tourStep === 2 ? finishTour() : changeTourStep(tourStep + 1)}
      onClose={closeTour}
      ready={tourStepReady(tourStep, { places: places.length, offers: activeServices.length, events: availability.length, dirty: false, scheduleDirty: false })} />}
  </section>;
}
