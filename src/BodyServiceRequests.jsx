import React, { useState, useEffect } from "react";
import { getClientToken } from "./lib/clientToken.js";
import { getBodySession } from "./lib/sessionAccess.js";

const REQUEST_TYPES = [
  { value: "text_question", label: "Онлайн-вопрос", desc: "Ответ текстом в течение 24 часов", credits: 300 },
  { value: "phone_call", label: "Телефонный звонок", desc: "Специалист согласует время", credits: 700 },
  { value: "video_call", label: "Видеоконсультация", desc: "Для подробного разговора", credits: 1500 },
  { value: "offline_visit", label: "Очная консультация", desc: "Время и стоимость уточнит специалист", credits: null },
  { value: "diary_review", label: "Разбор дневника", desc: "Специалист посмотрит последние записи", credits: 500 },
  { value: "labs_medications_review", label: "Разбор анализов и препаратов", desc: "Для вопросов по анализам, лекарствам и БАДам", credits: 700 },
  { value: "other", label: "Другой запрос", desc: "", credits: 300 },
];

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

function getLocalDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function apiCall(action, body) {
  let token;
  try { token = await getClientToken("body", "session"); } catch {}
  const hdrs = { "Content-Type": "application/json" };
  if (token) hdrs["Authorization"] = `Bearer ${token}`;
  const saved = getBodySession();
  const res = await fetch("/api/session", {
    method: "POST", headers: hdrs,
    body: JSON.stringify({ action, session_id: saved.sessionId, access_token: saved.accessToken, ...body }),
  });
  return res.json();
}

export default function BodyServiceRequests({ onBack }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // list | new | detail
  const [selectedRequest, setSelectedRequest] = useState(null);

  // New request form
  const [requestType, setRequestType] = useState("");
  const [message, setMessage] = useState("");
  const [includeDiary, setIncludeDiary] = useState(true);
  const [includePlates, setIncludePlates] = useState(false);
  const [includeWeekly, setIncludeWeekly] = useState(false);
  const [includeHealthCtx, setIncludeHealthCtx] = useState(false);
  const [contactPhone, setContactPhone] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
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
    if (!requestType || !message.trim()) {
      setSubmitError("Выберите тип запроса и укажите сообщение.");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      const data = await apiCall("createBodyServiceRequest", {
        request_type: requestType,
        message: message.trim(),
        context_options: {
          include_recent_diary: includeDiary,
          include_plate_history: includePlates,
          include_weekly_summary: includeWeekly,
          include_health_context: includeHealthCtx,
        },
        client_contact: contactPhone || preferredTime ? { phone: contactPhone, preferred_time: preferredTime } : {},
      });
      if (!data.ok) throw new Error(data.error || "Не удалось отправить.");
      setView("list");
      setMessage("");
      setRequestType("");
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

  const config = REQUEST_TYPES.find(r => r.value === requestType);
  const needContact = config && ["phone_call", "video_call", "offline_visit"].includes(config.value);

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
          <button onClick={() => setView("new")} style={{ width: "100%", padding: "12px 20px", borderRadius: 14, border: 0, background: "#5f8b7a", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", marginBottom: 20, fontFamily: "inherit" }}>
            Новый запрос
          </button>

          {loading ? (
            <div style={{ textAlign: "center", color: "#8a7e72", padding: 20 }}>Загрузка...</div>
          ) : requests.length === 0 ? (
            <div style={{ textAlign: "center", color: "#8a7e72", padding: 20, fontSize: 14 }}>Пока нет запросов.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {requests.map(r => (
                <div key={r.id} onClick={() => { setSelectedRequest(r); setView("detail"); }} style={{ padding: "12px 16px", borderRadius: 12, border: "1px solid #e8e2d8", background: "#faf6ef", cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#2f2925" }}>{r.title || REQUEST_TYPES.find(t => t.value === r.request_type)?.label || r.request_type}</div>
                    <span style={{ fontSize: 12, color: STATUS_COLORS[r.status] || "#8a7e72", fontWeight: 600 }}>{STATUS_LABELS[r.status] || r.status}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#5f574f", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.message}</div>
                  <div style={{ fontSize: 12, color: "#8a7e72" }}>
                    {new Date(r.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                    {r.reserved_credits > 0 && ` · ${r.reserved_credits} кредитов`}
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
          <div style={{ fontSize: 16, fontWeight: 600, color: "#2f2925", marginBottom: 12 }}>Какой запрос отправить специалисту?</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {REQUEST_TYPES.map(rt => (
              <button key={rt.value} onClick={() => setRequestType(rt.value)} style={{
                padding: "12px 16px", borderRadius: 12, border: `1px solid ${requestType === rt.value ? "#7D9A89" : "#e8e2d8"}`,
                background: requestType === rt.value ? "#e8f0ea" : "#fff", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#2f2925" }}>{rt.label}</div>
                <div style={{ fontSize: 13, color: "#8a7e72" }}>{rt.desc}</div>
                {rt.credits != null && <div style={{ fontSize: 12, color: "#7D9A89", marginTop: 2 }}>{rt.credits} кредитов</div>}
              </button>
            ))}
          </div>

          {requestType === "labs_medications_review" && (
            <div style={{ padding: 12, borderRadius: 10, background: "#fdf6ee", border: "1px solid #e8d5b8", marginBottom: 16, fontSize: 13, color: "#92400e" }}>
              Специалист не заменяет врача. Не меняйте лекарства и дозировки без назначения врача.
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 14, fontWeight: 600, color: "#2f2925", marginBottom: 6, display: "block" }}>Что хотите уточнить?</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Опишите вопрос своими словами..." style={{ width: "100%", minHeight: 120, padding: 12, borderRadius: 12, border: "1px solid #d8cec1", background: "#fff", fontSize: 14, outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#2f2925", marginBottom: 8 }}>Приложить контекст</div>
            {[
              { v: includeDiary, s: setIncludeDiary, l: "Последние 7 дней дневника" },
              { v: includePlates, s: setIncludePlates, l: "Наблюдения по питанию и фото" },
              { v: includeWeekly, s: setIncludeWeekly, l: "Недельный итог" },
              { v: includeHealthCtx, s: setIncludeHealthCtx, l: "Здоровье, анализы и препараты" },
            ].map(c => (
              <label key={c.l} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer", fontSize: 13, color: "#5f574f" }}>
                <input type="checkbox" checked={c.v} onChange={e => c.s(e.target.checked)} />
                {c.l}
              </label>
            ))}
          </div>

          {needContact && (
            <div style={{ marginBottom: 16, padding: 16, borderRadius: 12, background: "#faf6ef", border: "1px solid #e8e2d8" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#2f2925", marginBottom: 8 }}>Контактные данные</div>
              <div style={{ marginBottom: 8 }}>
                <input value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="Телефон" style={{ width: "100%", height: 44, padding: "0 14px", borderRadius: 12, border: "1px solid #d8cec1", background: "#fff", fontSize: 14, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div>
                <input value={preferredTime} onChange={e => setPreferredTime(e.target.value)} placeholder="Удобное время (например, вечером после 18:00)" style={{ width: "100%", height: 44, padding: "0 14px", borderRadius: 12, border: "1px solid #d8cec1", background: "#fff", fontSize: 14, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
            </div>
          )}

          <div style={{ fontSize: 12, color: "#8a7e72", marginBottom: 12, lineHeight: 1.5 }}>
            Кредиты списываются только после ответа специалиста. Сейчас списание не выполняется автоматически — это тестовый режим.
          </div>

          {submitError && <div style={{ color: "#b5473f", fontSize: 14, marginBottom: 12 }}>{submitError}</div>}

          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={handleSubmit} disabled={submitting} style={{ flex: 1, padding: "12px 20px", borderRadius: 16, border: 0, background: "#5f8b7a", color: "#fff", fontWeight: 700, fontSize: 15, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.6 : 1, fontFamily: "inherit" }}>
              {submitting ? "Отправка..." : "Отправить запрос"}
            </button>
            <button onClick={() => setView("list")} disabled={submitting} style={{ padding: "12px 20px", borderRadius: 16, border: "1px solid #d8cec1", background: "#ede7dc", color: "#2f2925", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Detail view */}
      {view === "detail" && selectedRequest && (
        <div>
          <div style={{ padding: 16, borderRadius: 12, border: "1px solid #e8e2d8", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#2f2925" }}>{selectedRequest.title || selectedRequest.request_type}</div>
              <span style={{ fontSize: 13, color: STATUS_COLORS[selectedRequest.status], fontWeight: 600 }}>{STATUS_LABELS[selectedRequest.status]}</span>
            </div>
            <div style={{ fontSize: 13, color: "#8a7e72", marginBottom: 8 }}>
              {new Date(selectedRequest.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
              {selectedRequest.specialist_name && ` · ${selectedRequest.specialist_name}`}
              {selectedRequest.reserved_credits > 0 && ` · ${selectedRequest.reserved_credits} кредитов`}
            </div>
            <div style={{ fontSize: 14, color: "#2f2925", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{selectedRequest.message}</div>
          </div>

          {selectedRequest.specialist_response && (
            <div style={{ padding: 16, borderRadius: 12, background: "#f0f5f1", border: "1px solid #c4d0c6", marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#2f2925", marginBottom: 6 }}>Ответ специалиста</div>
              <div style={{ fontSize: 14, color: "#5f574f", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{selectedRequest.specialist_response}</div>
            </div>
          )}

          {selectedRequest.scheduled_at && (
            <div style={{ padding: 12, borderRadius: 10, background: "#e8f0ea", border: "1px solid #c4d0c6", marginBottom: 16, fontSize: 13, color: "#2f2925" }}>
              Запланировано: {new Date(selectedRequest.scheduled_at).toLocaleString("ru-RU")}
              {selectedRequest.scheduled_comment && ` — ${selectedRequest.scheduled_comment}`}
            </div>
          )}

          <div style={{ display: "flex", gap: 12 }}>
            {["submitted", "accepted", "needs_clarification", "scheduled"].includes(selectedRequest.status) && (
              <button onClick={() => handleCancel(selectedRequest.id)} style={{ flex: 1, padding: "12px 20px", borderRadius: 16, border: "1px solid #d8cec1", background: "#fff", color: "#b5473f", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
                Отменить запрос
              </button>
            )}
            <button onClick={() => setView("list")} style={{ padding: "12px 20px", borderRadius: 16, border: "1px solid #d8cec1", background: "#ede7dc", color: "#2f2925", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
              К списку
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
