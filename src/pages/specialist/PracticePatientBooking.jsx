// A2 patient booking section for existing patient cabinet (test contour).
// Uses session_id + access_token from the existing authorized patient cabinet —
// does not invent a new patient registry. All data comes from Test Supabase via
// /api/practice-booking with verified session identity (not body fields).
import React, { useEffect, useState } from "react";

async function callPractice(action, data = {}) {
  const res = await fetch("/api/practice-booking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action, ...data }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || "Ошибка запроса");
  return json;
}

function NewBookingForm({ services, session, token, onSaved }) {
  const [serviceId, setServiceId] = useState(services[0]?.service_id || "");
  const [day, setDay] = useState("");
  const [slots, setSlots] = useState([]);
  const [startTime, setStartTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadSlots() {
    if (!serviceId || !day) return;
    setError(""); setMessage("");
    try {
      const res = await callPractice("getPracticeSlots", { service_id: serviceId, day });
      setSlots(res.free || []);
      if (!res.free?.length) setMessage("На этот день свободных слотов нет.");
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { loadSlots(); }, [serviceId, day]);

  async function reserve() {
    if (!startTime) return setError("Выберите свободное время.");
    setBusy(true); setError(""); setMessage("");
    const idemKey = `patient-${session}-${Date.now()}`;
    try {
      const res = await callPractice("reservePracticeBooking", {
        service_id: serviceId, day, start_time: startTime,
        idempotency_key: idemKey,
        session_id: session, access_token: token,
      });
      setMessage(`Запись создана (статус: ${res.status}).`);
      await onSaved(res.booking_id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div data-testid="a2-patient-booking">
      <h4 style={{ margin: "12px 0 8px" }}>Новая запись</h4>
      {services.length === 0 ? (
        <p style={{ fontSize: 13, color: "#666" }}>Услуг пока нет. Врач должен создать услугу в кабинете.</p>
      ) : (<>
        <label style={{ display: "block", fontSize: 13, marginBottom: 8 }}>Услуга
          <select data-testid="a2-patient-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}>
            {services.map((s) => <option key={s.service_id} value={s.service_id}>{s.name} · {(s.price_kop / 100).toLocaleString("ru-RU")} ₽ · {s.duration_min} мин</option>)}
          </select>
        </label>
        <label style={{ display: "block", fontSize: 13, marginBottom: 8 }}>Дата
          <input data-testid="a2-patient-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
        </label>
        <label style={{ display: "block", fontSize: 13, marginBottom: 8 }}>Свободное время
          <select data-testid="a2-patient-slot" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}>
            <option value="">— выберите —</option>
            {slots.map((s) => <option key={s.starts_at} value={s.start_time}>{s.start_time}</option>)}
          </select>
        </label>
        <button disabled={busy} onClick={reserve} data-testid="a2-patient-reserve" style={{ padding: "9px 16px", borderRadius: 9, background: "#2F5D50", color: "#fff", border: 0, fontWeight: 700, cursor: "pointer" }}>
          {busy ? "Резервируем…" : "Забронировать"}
        </button>
      </>)}
      {message && <p role="status" style={{ color: "#2F5D50" }}>{message}</p>}
      {error && <p role="alert" style={{ color: "#a33" }}>{error}</p>}
    </div>
  );
}

export default function PracticePatientBooking({ sessionId, accessToken, doctorExpertId }) {
  const [services, setServices] = useState([]);
  const [lastBookingId, setLastBookingId] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => { listServices(); }, []);
  async function listServices() {
    setError("");
    try {
      const res = await callPractice("listPracticeDoctorServices", { expert_id: doctorExpertId });
      setServices(res.services || []);
    } catch (e) { setError(e.message); }
  }

  async function onReserved(id) {
    setLastBookingId(id);
    setInfo("Запись создана. Подтверждение: выберите «Подтвердить оплату» ниже.");
  }

  async function testPay() {
    setError(""); setInfo("");
    if (!lastBookingId) return setError("Сначала создайте запись.");
    try {
      const res = await callPractice("confirmPracticeTestPayment", { booking_id: lastBookingId, session_id: sessionId, access_token: accessToken });
      setInfo(`Оплата подтверждена (тест). Статус: ${res.status}.`);
    } catch (e) { setError(e.message); }
  }

  async function cancel() {
    setError(""); setInfo("");
    if (!lastBookingId) return setError("Сначала создайте запись.");
    try {
      const res = await callPractice("cancelPracticeBookingPublic", { booking_id: lastBookingId, session_id: sessionId, access_token: accessToken });
      setInfo(`Запись отменена. Статус: ${res.status}.`);
    } catch (e) { setError(e.message); }
  }

  return (
    <section data-testid="a2-patient-panel" style={{ border: "1px solid #e3ddcf", borderRadius: 16, padding: 20, background: "#FFFEFB" }}>
      <h3 style={{ margin: "0 0 6px" }}>Запись на приём</h3>
      <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>Запись делается через вашу проверенную сессию. Тестовая оплата помечена как TEST.</p>
      {error && <p role="alert" style={{ color: "#a33" }}>{error}</p>}
      {info && <p role="status" style={{ color: "#2F5D50" }}>{info}</p>}
      <NewBookingForm services={services} session={sessionId} token={accessToken} onSaved={onReserved} />
      {lastBookingId && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={testPay} data-testid="a2-patient-pay" style={{ padding: "8px 14px", borderRadius: 8, background: "#2F5D50", color: "#fff", border: 0, cursor: "pointer" }}>Подтвердить оплату (тест)</button>
          <button onClick={cancel} data-testid="a2-patient-cancel" style={{ padding: "8px 14px", borderRadius: 8, background: "#fff", border: "1px solid #c33", color: "#c33", cursor: "pointer" }}>Отменить</button>
        </div>
      )}
    </section>
  );
}
