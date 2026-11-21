import React, { useState, useEffect } from "react";
import { getBodySession } from "./lib/sessionAccess.js";
import PracticePatientBooking from "./pages/specialist/PracticePatientBooking.jsx";

const BODY_TOPICS = [
  { value: "labs", label: "Анализы" },
  { value: "medications_supplements", label: "Лекарства и БАДы" },
  { value: "diary_nutrition", label: "Питание / дневник" },
  { value: "other", label: "Другой вопрос" },
];

const TOPIC_LABELS = Object.fromEntries(BODY_TOPICS.map((topic) => [topic.value, topic.label]));
const FORMAT_LABELS = { text: "письменно", phone: "по телефону", video: "онлайн", offline: "очно" };

const STATUS_LABELS = {
  submitted: "Отправлен",
  accepted: "Принят",
  needs_clarification: "Нужно уточнение",
  scheduled: "Запланирован",
  answered: "Есть ответ",
  completed: "Завершён",
  cancelled: "Отменён",
  expired: "Истёк",
  refunded: "Возврат",
};

const STATUS_COLORS = {
  submitted: "#8a7e72", accepted: "#5f8b7a", needs_clarification: "#e8a857",
  scheduled: "#6b8fc7", answered: "#7D9A89", completed: "#7D9A89",
  cancelled: "#b5473f", expired: "#b5473f", refunded: "#8a7e72",
};

async function apiCall(action, body) {
  const saved = getBodySession();
  const res = await fetch("/api/session", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, session_id: saved.sessionId, access_token: saved.accessToken, ...body }),
  });
  return res.json();
}

export default function BodyServiceRequests({ onBack }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // list | new | booking | detail
  const [selectedRequest, setSelectedRequest] = useState(null);

  // New request form
  const [serviceTopic, setServiceTopic] = useState("");
  const [message, setMessage] = useState("");
  const [includeDiary, setIncludeDiary] = useState(true);
  const [includePlates, setIncludePlates] = useState(false);
  const [includeWeekly, setIncludeWeekly] = useState(false);
  const [includeHealthCtx, setIncludeHealthCtx] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    loadRequests();
  }, []);

  async function loadRequests() {
    setLoading(true);
    try {
      const data = await apiCall("getBodyServiceRequests");
      if (data.ok) setRequests(data.requests || []);
    } catch {}
    setLoading(false);
  }

  async function handleSubmit() {
    if (!serviceTopic || !message.trim()) {
      setSubmitError("Выберите тему и укажите сообщение.");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      const data = await apiCall("createBodyServiceRequest", {
        service_topic: serviceTopic,
        message: message.trim(),
        context_options: {
          include_recent_diary: includeDiary,
          include_plate_history: includePlates,
          include_weekly_summary: includeWeekly,
          include_health_context: includeHealthCtx,
        },
      });
      if (!data.ok) throw new Error(data.error || "Не удалось отправить.");
      setView("list");
      setMessage("");
      setServiceTopic("");
      loadRequests();
    } catch (e) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id) {
    if (!window.confirm("Отменить запрос?")) return;
    try {
      const data = await apiCall("cancelBodyServiceRequest", { request_id: id });
      if (data.ok) loadRequests();
    } catch {}
  }

  const bodySession = getBodySession();

  return (
    <div style={{ maxWidth: 780, margin: "32px auto 64px", padding: "0 16px", width: "100%", boxSizing: "border-box" }}>
      <button onClick={onBack} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #d8cec1", background: "#fff", cursor: "pointer", fontSize: 13, color: "#5f574f", marginBottom: 16 }}>
        ← Назад в кабинет
      </button>

      <div style={{ fontSize: 22, fontWeight: 700, color: "#2f2925", marginBottom: 8, fontFamily: "Georgia, serif" }}>
        Связаться со специалистом
      </div>
      <div style={{ fontSize: 14, color: "#8a7e72", marginBottom: 20, lineHeight: 1.5 }}>
        Это запрос человеку-специалисту, а не AI-ответ.
      </div>

      {/* List view */}
      {view === "list" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 20 }}>
            <button onClick={() => setView("new")} style={{ padding: "14px 20px", borderRadius: 14, border: 0, background: "#5f8b7a", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>
              Задать вопрос специалисту
            </button>
            <button onClick={() => setView("booking")} style={{ padding: "14px 20px", borderRadius: 14, border: "1px solid #7D9A89", background: "#fff", color: "#5f8b7a", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>
              Записаться к своему специалисту
            </button>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", color: "#8a7e72", padding: 20 }}>Загрузка...</div>
          ) : requests.length === 0 ? (
            <div style={{ textAlign: "center", color: "#8a7e72", padding: 20, fontSize: 14 }}>Пока нет запросов.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {requests.map(r => (
                <div key={r.id} onClick={() => { setSelectedRequest(r); setView("detail"); }} style={{ padding: "12px 16px", borderRadius: 12, border: `1px solid ${r.status === "answered" ? "#c4d0c6" : "#e8e2d8"}`, background: r.status === "answered" ? "#f0f5f1" : "#faf6ef", cursor: "pointer" }}>
                  <div className="body-service-request-detail-head" style={{ marginBottom: 4 }}>
                    <div className="body-service-request-detail-title" style={{ fontSize: 14, fontWeight: 600, color: "#2f2925" }}>{r.title || r.request_type}</div>
                    <div className="body-service-request-badges">
                      {r.status === "answered" && <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#e8f0ea", color: "#5f8b7a", fontWeight: 600 }}>Есть ответ</span>}
                      {r.status === "scheduled" && <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#e8f0ea", color: "#6b8fc7", fontWeight: 600 }}>Запланировано</span>}
                      <span style={{ fontSize: 12, color: STATUS_COLORS[r.status] || "#8a7e72", fontWeight: 600 }}>{STATUS_LABELS[r.status] || r.status}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: "#5f574f", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.message}</div>
                  <div style={{ fontSize: 12, color: "#8a7e72" }}>
                    {new Date(r.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                    {r.price_credits != null ? ` · ${r.price_credits.toLocaleString("ru-RU")} кредитов` : " · Стоимость уточняется специалистом"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* New request form */}
      {view === "new" && (
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#2f2925", marginBottom: 12 }}>С чем хотите обратиться?</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {BODY_TOPICS.map((topic) => (
              <button key={topic.value} onClick={() => { setServiceTopic(topic.value); setSubmitError(""); }} style={{
                padding: "12px 16px", borderRadius: 12, border: `1px solid ${serviceTopic === topic.value ? "#7D9A89" : "#e8e2d8"}`,
                background: serviceTopic === topic.value ? "#e8f0ea" : "#fff", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#2f2925" }}>{topic.label}</div>
              </button>
            ))}
          </div>

          {serviceTopic === "medications_supplements" && (
            <div style={{ padding: 12, borderRadius: 10, background: "#fdf6ee", border: "1px solid #e8d5b8", marginBottom: 16, fontSize: 13, color: "#92400e" }}>
              Специалист не заменяет врача. Не меняйте лекарства и дозировки без назначения врача.
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 14, fontWeight: 600, color: "#2f2925", marginBottom: 6, display: "block" }}>Что хотите уточнить?</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Опишите вопрос своими словами..." style={{ width: "100%", minHeight: 120, padding: 12, borderRadius: 12, border: "1px solid #d8cec1", background: "#fff", color: "#2f2925", fontSize: 14, outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#2f2925", marginBottom: 8 }}>Приложить контекст</div>
            {[
              { v: includeDiary, s: setIncludeDiary, l: "Последние 7 дней дневника" },
              { v: includePlates, s: setIncludePlates, l: "Наблюдения по питанию и фото" },
              { v: includeWeekly, s: setIncludeWeekly, l: "Недельный итог" },
              { v: includeHealthCtx, s: setIncludeHealthCtx, l: "Здоровье, анализы и препараты" },
            ].map(c => (
              <label key={c.l} className="body-service-request-context-row" style={{ fontSize: 13, color: "#5f574f" }}>
                <input type="checkbox" className="body-service-request-context-check" checked={c.v} onChange={e => c.s(e.target.checked)} />
                <span className="body-service-request-context-label">{c.l}</span>
              </label>
            ))}
          </div>

          <div style={{ fontSize: 12, color: "#8a7e72", marginBottom: 12, lineHeight: 1.5 }}>
            Стоимость уточняется специалистом. Отправка вопроса не резервирует и не списывает кредиты.
          </div>

          {submitError && <div style={{ color: "#b5473f", fontSize: 14, marginBottom: 12 }}>{submitError}</div>}

          <div className="body-service-request-actions">
            <button onClick={handleSubmit} disabled={submitting} className="body-service-request-primary" style={{ flex: 1, padding: "12px 20px", borderRadius: 16, border: 0, background: "#5f8b7a", color: "#fff", fontWeight: 700, fontSize: 15, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.6 : 1, fontFamily: "inherit" }}>
              {submitting ? "Отправка..." : "Отправить запрос"}
            </button>
            <button onClick={() => setView("list")} disabled={submitting} className="body-service-request-secondary" style={{ padding: "12px 20px", borderRadius: 16, border: "1px solid #d8cec1", background: "#ede7dc", color: "#2f2925", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {view === "booking" && (
        <div>
          <button onClick={() => setView("list")} style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid #d8cec1", background: "#fff", cursor: "pointer", marginBottom: 12 }}>
            ← К вопросам
          </button>
          <PracticePatientBooking
            sessionId={bodySession.sessionId}
            accessToken={bodySession.accessToken}
            module="body"
          />
        </div>
      )}

      {/* Detail view */}
      {view === "detail" && selectedRequest && (
        <div>
          <div style={{ padding: 16, borderRadius: 12, border: "1px solid #e8e2d8", marginBottom: 16 }}>
            <div className="body-service-request-detail-head">
              <div className="body-service-request-detail-title" style={{ fontSize: 16, fontWeight: 600, color: "#2f2925" }}>{selectedRequest.title || selectedRequest.request_type}</div>
              <div className="body-service-request-badges">
                {selectedRequest.status === "answered" && <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#e8f0ea", color: "#5f8b7a", fontWeight: 600 }}>Ответ специалиста получен</span>}
                {selectedRequest.status === "scheduled" && <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#e8f0ea", color: "#6b8fc7", fontWeight: 600 }}>Консультация запланирована</span>}
                {selectedRequest.status === "completed" && <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#e8f0ea", color: "#7D9A89", fontWeight: 600 }}>Запрос завершён</span>}
                {selectedRequest.status === "cancelled" && <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#fdf2f2", color: "#b5473f", fontWeight: 600 }}>Запрос отменён</span>}
                <span style={{ fontSize: 13, color: STATUS_COLORS[selectedRequest.status], fontWeight: 600 }}>{STATUS_LABELS[selectedRequest.status]}</span>
              </div>
            </div>
            <div style={{ fontSize: 13, color: "#8a7e72", marginBottom: 8 }}>
              {new Date(selectedRequest.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
              {selectedRequest.specialist_name && ` · ${selectedRequest.specialist_name}`}
              {selectedRequest.service_topic && ` · тема: ${TOPIC_LABELS[selectedRequest.service_topic] || selectedRequest.service_topic}`}
              {selectedRequest.meeting_format && ` · формат: ${FORMAT_LABELS[selectedRequest.meeting_format] || selectedRequest.meeting_format}`}
              {selectedRequest.price_credits != null ? ` · Стоимость: ${selectedRequest.price_credits.toLocaleString("ru-RU")} кредитов` : " · Стоимость уточняется специалистом"}
            </div>
            <div style={{ fontSize: 14, color: "#2f2925", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{selectedRequest.message}</div>
            {/* Contact info */}
            {selectedRequest.client_contact && (selectedRequest.client_contact.phone || selectedRequest.client_contact.preferred_date) && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#5f574f", padding: "6px 10px", borderRadius: 8, background: "#faf6ef" }}>
                {selectedRequest.client_contact.phone && <span>Тел: {selectedRequest.client_contact.phone}</span>}
                {selectedRequest.client_contact.preferred_date && <span> · Дата: {selectedRequest.client_contact.preferred_date}</span>}
                {selectedRequest.client_contact.preferred_time_from && <span> · С {selectedRequest.client_contact.preferred_time_from}</span>}
                {selectedRequest.client_contact.preferred_time_to && <span> до {selectedRequest.client_contact.preferred_time_to}</span>}
                {selectedRequest.client_contact.preferred_time_text && <span> · {selectedRequest.client_contact.preferred_time_text}</span>}
              </div>
            )}
          </div>

          {selectedRequest.specialist_response && (
            <div style={{ padding: 16, borderRadius: 12, background: "#f0f5f1", border: "1px solid #c4d0c6", marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#2f2925", marginBottom: 6 }}>Ответ специалиста</div>
              <div style={{ fontSize: 14, color: "#5f574f", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{selectedRequest.specialist_response}</div>
              {selectedRequest.answered_at && (
                <div style={{ fontSize: 12, color: "#8a7e72", marginTop: 6 }}>{new Date(selectedRequest.answered_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</div>
              )}
            </div>
          )}

          {selectedRequest.scheduled_at && (
            <div style={{ padding: 12, borderRadius: 10, background: "#e8f0ea", border: "1px solid #c4d0c6", marginBottom: 16, fontSize: 13, color: "#2f2925" }}>
              Консультация запланирована: {new Date(selectedRequest.scheduled_at).toLocaleString("ru-RU")}
              {selectedRequest.scheduled_comment && ` — ${selectedRequest.scheduled_comment}`}
            </div>
          )}

          <div className="body-service-request-actions">
            {["submitted", "accepted", "needs_clarification", "scheduled"].includes(selectedRequest.status) && (
              <button onClick={() => handleCancel(selectedRequest.id)} className="body-service-request-secondary" style={{ flex: 1, padding: "12px 20px", borderRadius: 16, border: "1px solid #d8cec1", background: "#fff", color: "#b5473f", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
                Отменить запрос
              </button>
            )}
            <button onClick={() => setView("list")} className="body-service-request-secondary" style={{ padding: "12px 20px", borderRadius: 16, border: "1px solid #d8cec1", background: "#ede7dc", color: "#2f2925", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
              К списку
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
