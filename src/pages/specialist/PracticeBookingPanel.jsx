import React, { useEffect, useState } from "react";

// A2: server-side booking section for the doctor cabinet (test contour).
// Tabs: Места | Услуги | Расписание | Записи | Финансы (тест).
// All data comes from /api/practice-booking (Test Supabase); nothing is persisted in browser.

async function callPractice(action, data = {}) {
  const res = await fetch("/api/practice-booking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action, ...data }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(json.error || "Ошибка запроса");
  }
  return json;
}

function NewPlaceForm({ onSaved }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await callPractice("savePracticePlace", { name, address });
      setName(""); setAddress("");
      await onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} data-testid="a2-place-form">
      <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Название
        <input data-testid="a2-place-name" value={name} onChange={(e) => setName(e.target.value)} required style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
      </label>
      <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Адрес (необязательно)
        <input value={address} onChange={(e) => setAddress(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
      </label>
      <button disabled={busy} data-testid="a2-place-save" style={{ padding: "9px 16px", borderRadius: 9, background: "#2F5D50", color: "#fff", border: 0, fontWeight: 700, cursor: "pointer" }}>
        {busy ? "Сохранение…" : "Добавить место"}
      </button>
      {error && <p role="alert" style={{ color: "#a33" }}>{error}</p>}
    </form>
  );
}

function NewServiceForm({ places, organizationId, onSaved }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("60");
  const [placeId, setPlaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await callPractice("savePracticeService", {
        name, price_kop: Math.round(Number(price) * 100), duration_min: Number(duration),
        place_id: placeId || null, organization_id: organizationId || null,
      });
      setName(""); setPrice("");
      await onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} data-testid="a2-service-form">
      <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Название
        <input data-testid="a2-service-name" value={name} onChange={(e) => setName(e.target.value)} required style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
      </label>
      <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Цена, ₽
        <input data-testid="a2-service-price" type="number" min="0" step="1" value={price} onChange={(e) => setPrice(e.target.value)} required style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
      </label>
      <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Длительность, минут
        <input type="number" min="15" max="240" step="5" value={duration} onChange={(e) => setDuration(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
      </label>
      <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Место приёма
        <select data-testid="a2-service-place" value={placeId} onChange={(e) => setPlaceId(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}>
          <option value="">Без места</option>
          {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <button disabled={busy} data-testid="a2-service-save" style={{ padding: "9px 16px", borderRadius: 9, background: "#2F5D50", color: "#fff", border: 0, fontWeight: 700, cursor: "pointer" }}>
        {busy ? "Сохранение…" : "Добавить услугу"}
      </button>
      {error && <p role="alert" style={{ color: "#a33" }}>{error}</p>}
    </form>
  );
}

function NewAvailabilityForm({ organizationId, onSaved }) {
  const [weekday, setWeekday] = useState("1");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const weekdays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await callPractice("savePracticeAvailability", {
        organization_id: organizationId || null,
        weekday: Number(weekday), start_time: startTime, end_time: endTime,
      });
      await onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} data-testid="a2-availability-form" style={{ marginTop: 8 }}>
      <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>День недели
        <select data-testid="a2-availability-weekday" value={weekday} onChange={(e) => setWeekday(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}>
          {weekdays.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
        </select>
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ flex: 1, fontSize: 13 }}>С
          <input data-testid="a2-availability-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ width: "100%", padding: 9, borderRadius: 8, border: "1px solid #ddd" }} />
        </label>
        <label style={{ flex: 1, fontSize: 13 }}>До
          <input data-testid="a2-availability-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ width: "100%", padding: 9, borderRadius: 8, border: "1px solid #ddd" }} />
        </label>
      </div>
      <button disabled={busy} data-testid="a2-availability-save" style={{ padding: "9px 16px", borderRadius: 9, background: "#2F5D50", color: "#fff", border: 0, fontWeight: 700, cursor: "pointer" }}>
        {busy ? "Сохраняем…" : "Добавить рабочие часы"}
      </button>
      {error && <p role="alert" style={{ color: "#a33" }}>{error}</p>}
    </form>
  );
}

export default function PracticeBookingPanel({ organizationId = null }) {
  const [places, setPlaces] = useState([]);
  const [services, setServices] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [finance, setFinance] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function reload() {
    setError(""); setInfo("");
    try {
      const [p, s, a, b, f] = await Promise.all([
        callPractice("listPracticePlaces").catch(() => ({ places: [] })),
        callPractice("listPracticeServices").catch(() => ({ services: [] })),
        callPractice("listPracticeAvailability").catch(() => ({ availability: [] })),
        callPractice("listPracticeBookings", { organization_id: organizationId || null }).catch(() => ({ bookings: [] })),
        callPractice("getPracticeFinance").catch(() => ({ payable: [], payable_total_kop: 0 })),
      ]);
      setPlaces(p.places || []); setServices(s.services || []); setAvailability(a.availability || []);
      setBookings(b.bookings || []); setFinance(f);
    } catch (err) { setError(err.message || "Не удалось загрузить."); }
  }
  useEffect(() => { reload(); }, [organizationId]);

  async function complete(id, who) {
    setError(""); setInfo("");
    try {
      const res = await callPractice("completePracticeBooking", { booking_id: id });
      setInfo(`Запись завершена. Комиссия: ${res.commission_id ? "начислена" : "нет"}`);
    } catch (err) { setError(err.message); }
    await reload();
  }

  return (
    <section data-testid="a2-booking-panel" style={{ border: "1px solid #e3ddcf", borderRadius: 16, padding: 20, background: "#FFFEFB" }}>
      <h3 style={{ margin: "0 0 8px" }}>Серверное бронирование (тест)</h3>
      <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
        Данные хранятся в тестовой базе и не зависят от браузера. Пациент видит только свободные интервалы;
        внутренние документы не открываются.
      </p>
      {error && <p role="alert" style={{ color: "#a33" }}>{error}</p>}
      {info && <p role="status" style={{ color: "#2F5D50" }}>{info}</p>}

      <h4>Места работы</h4>
      {places.map((p) => <div key={p.id} data-testid="a2-place-row" style={{ padding: "7px 0", borderBottom: "1px solid #eee" }}>
        <strong>{p.name}</strong>{p.address ? <span style={{ color: "#777" }}> · {p.address}</span> : null}
      </div>)}
      <NewPlaceForm onSaved={reload} />

      <h4>Услуги</h4>
      {services.map((s) => (
        <div key={s.id} data-testid="a2-service-row" style={{ padding: "7px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
          {s.name} · {s.duration_min} мин · {(s.price_kop / 100).toLocaleString("ru-RU")} ₽
        </div>
      ))}
      <NewServiceForm places={places} organizationId={organizationId} onSaved={reload} />

      <h4>Расписание</h4>
      {availability.length === 0 && <p style={{ fontSize: 13, color: "#777" }}>Рабочие часы пока не заданы.</p>}
      {availability.map((a) => <div key={a.id} data-testid="a2-availability-row" style={{ padding: "7px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
        {a.weekday >= 1 && a.weekday <= 7 ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][a.weekday - 1] : "Дата"} · {a.start_time}–{a.end_time}
      </div>)}
      <NewAvailabilityForm organizationId={organizationId} onSaved={reload} />

      <h4>Записи пациентов</h4>
      {bookings.length === 0 && <p style={{ fontSize: 13, color: "#777" }}>Записей пока нет.</p>}
      {bookings.map((b) => (
        <div key={b.id} data-testid="a2-booking-row" style={{ padding: "7px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
          <span>{new Date(b.starts_at).toLocaleString("ru-RU")}</span> · {b.status}
          {b.status === "confirmed" && <button onClick={() => complete(b.id, "doctor")} data-testid="a2-complete" style={{ marginLeft: 10, padding: "5px 12px", borderRadius: 8, background: "#2F5D50", color: "#fff", border: 0, cursor: "pointer" }}>Приём завершён</button>}
        </div>
      ))}

      <h4>Финансы (тест, 20%)</h4>
      <p style={{ fontSize: 13 }}>К выплате начислено: <strong>{finance ? (finance.payable_total_kop / 100).toLocaleString("ru-RU") : "0"} ₽</strong> (симуляция, без реальных выплат).</p>
      <p style={{ fontSize: 12, color: "#999" }}>Рабочие часы: {availability.length} записей. Отпуск/выходные — через расписание демо.</p>
    </section>
  );
}
