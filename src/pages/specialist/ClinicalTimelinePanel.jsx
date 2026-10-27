import React, { useEffect, useRef, useState } from "react";

// UI for an explicitly synthetic example or authorized read-only patient chronology.
// No clinical records are stored in localStorage/sessionStorage or sent to analytics.
const COLORS = { ink: "#294338", accent: "#B85C4A", faint: "#F6F0E7", line: "#E1D6C9" };
const TYPES = {
  initial_or_followup_contact: "Первичное обращение или повторный визит",
  health_diary: "Дневник состояния",
  observation: "Клиническое наблюдение",
  clinician_decision: "Решение специалиста",
  medication_prescribed: "Назначение врача",
  medication_order_changed: "Изменение назначения",
  medication_reported: "Препарат со слов пациента",
  medication_history_changed: "Изменение списка препаратов",
  intake_reported: "Сообщение о приёме",
  clinical_outcome: "Повторная оценка",
  service_request: "Запрос специалисту",
  checkin_recorded: "Ежедневная отметка пациента",
};
const SOURCES = {
  clinician_ordered: "Назначено врачом", clinician_entered: "Записано врачом",
  clinician_confirmed: "Подтверждено врачом", patient_reported: "Со слов пациента",
  ai_extracted: "Извлечено ИИ — не проверено",
  ai_inferred: "Гипотеза ИИ — не подтверждена", system_generated: "Событие сервиса",
  unknown: "Источник не установлен",
};
const D = (day) => `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`;
const SYNTHETIC = Object.freeze({
  support: [
    { at: D(1), type: "initial_or_followup_contact", provenance: "patient_reported",
      details: { note: "Жалобы на тревогу и плохой сон. ИИ не ставил диагноз." } },
    { at: D(3), type: "clinician_decision", provenance: "clinician_entered",
      details: { note: "Врач описал предварительную оценку и план наблюдения." } },
    { at: D(4), type: "medication_prescribed", provenance: "clinician_ordered",
      details: { note: "Условное назначение «Препарат А», без рекомендаций по дозировке." } },
    { at: D(14), type: "checkin_recorded", provenance: "patient_reported",
      details: { note: "Пациент сообщает об улучшении сна и сохранении тревоги." } },
    { at: D(21), type: "clinical_outcome", provenance: "clinician_entered",
      details: { note: "Врач повторно оценил состояние; причинный эффект терапии не установлен." } },
  ],
  body: [
    { at: D(2), type: "initial_or_followup_contact", provenance: "patient_reported",
      details: { note: "Жалобы на нарушение сна и увеличение веса." } },
    { at: D(5), type: "health_diary", provenance: "patient_reported",
      details: { weight_kg: 83.4, sleep_hours: 6.5, note: "Первая запись в дневнике." } },
    { at: D(12), type: "medication_reported", provenance: "patient_reported",
      details: { note: "Пациент сообщил о ранее полученном назначении; врач его пока не подтвердил." } },
    { at: D(22), type: "health_diary", provenance: "patient_reported",
      details: { weight_kg: 82.1, sleep_hours: 7.2, note: "Повторная запись в дневнике." } },
    { at: D(25), type: "clinical_outcome", provenance: "clinician_entered",
      details: { note: "Изменение показателей зарегистрировано. Причина изменений неизвестна." } },
  ],
});
const formatDate = (x) => {
  const t = new Date(x);
  return Number.isNaN(t.getTime()) ? "Дата не определена"
    : t.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};
const friendly = (value) => {
  if (value === null || value === undefined || typeof value === "object") return null;
  if (typeof value === "boolean") return value ? "да" : "нет";
  return String(value);
};
const NOTES = {
  note: "Описание", medication_name: "Препарат", strength_value: "Дозировка",
  strength_unit: "Единица", weight_kg: "Масса, кг", sleep_hours: "Сон, ч",
  value_numeric: "Значение", unit: "Единица измерения", concept: "Показатель",
  outcome_type: "Оцениваемый результат", direction: "Динамика",
  followup_complete: "Оценка завершена", clinician_assessed: "Проверено врачом",
  intake_status: "Отметка приёма", status: "Статус", decision_type: "Тип решения",
  superseded_by_newer_record: "Заменено более новой записью",
  event_type: "Тип события",
};
function EventCard({ entry: item }) {
  const label = TYPES[item.type] || item.label || "Клиническое событие";
  const details = Object.entries(item.details || {}).filter(([k, v]) =>
    v !== null && v !== undefined && v !== "" && NOTES[k] && (k !== "superseded_by_newer_record" || v === true));
  return <div style={{ position: "relative", paddingLeft: 26, marginBottom: 20 }}>
    <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 4, width: 12, height: 12,
      borderRadius: 20, background: COLORS.accent, border: "3px solid #F6F0E7" }} />
    <div style={{ fontSize: 12, color: "#766C60", marginBottom: 4 }}>{formatDate(item.at)} · {SOURCES[item.provenance] || SOURCES.unknown}</div>
    <div style={{ fontWeight: 750, marginBottom: 6 }}>{label}</div>
    {details.map(([key, val]) => <div key={key} style={{ fontSize: 13, lineHeight: 1.6 }}>
      <span style={{ color: "#6D716A" }}>{NOTES[key]}: </span>{friendly(val)}
    </div>)}
    {item.validation_status && item.validation_status !== "clinician_confirmed"
      && <div style={{ fontSize: 11, color: "#997A55", marginTop: 4 }}>Статус проверки: {item.validation_status === "unreviewed" ? "не проверено" : item.validation_status}</div>}
  </div>;
}
export default function ClinicalTimelinePanel({ module = "support", clientRef = null, organizationId = null }) {
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState("demo");
  const [demoModule, setDemoModule] = useState(module === "body" ? "body" : "support");
  const [history, setHistory] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const abortRef = useRef(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const load = async () => {
    if (!clientRef || status === "loading") return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading"); setError(""); setHistory(null);
    try {
      const result = await fetch("/api/specialist", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getClinicalTimeline", module,
          client_ref: clientRef, organization_id: organizationId }),
        signal: controller.signal,
      });
      const data = await result.json().catch(() => ({}));
      if (!result.ok || !data.ok) throw new Error(data.error || "Хронология недоступна");
      if (!data.coverage?.complete) throw new Error("Получена неполная история; данные скрыты");
      if (!controller.signal.aborted) { setHistory(data); setStatus("ready"); }
    } catch (e) {
      if (!controller.signal.aborted) {
        setStatus("error"); setError(e.message || "Не удалось получить хронологию");
      }
    }
  };
  const demo = view === "demo";
  const events = demo ? SYNTHETIC[demoModule] : (history?.events || []);
  return <section data-testid="clinical-timeline-panel" style={{
    marginBottom: 20, padding: 20, border: `1px solid ${COLORS.line}`, borderRadius: 16,
    background: "#FFFDF9", color: COLORS.ink,
  }}>
    <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
      <div>
        <strong style={{ fontSize: 17 }}>Клиническая хронология</strong>
        <div style={{ fontSize: 12, marginTop: 4, color: "#756F67" }}>История событий по источникам · только просмотр</div>
      </div>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(x => !x)}
        style={{ padding: "8px 12px", background: COLORS.faint, color: COLORS.ink,
          border: `1px solid ${COLORS.line}`, borderRadius: 8, cursor: "pointer" }}>
        {expanded ? "Свернуть" : "Открыть"}
      </button>
    </div>
    {expanded && <>
      <p style={{ color: "#836750", fontSize: 13 }}>
        Учебный пример использует только вымышленные данные. История пациента доступна только
        после отдельного включения защищённого сервера и проверки разрешений.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button type="button" onClick={() => setView("demo")}
          style={{ padding: "7px 12px", borderRadius: 8, cursor: "pointer",
            color: demo ? "#fff" : COLORS.ink, background: demo ? COLORS.accent : COLORS.faint, border: 0 }}>
          Учебный пример
        </button>
        {clientRef && <button type="button" onClick={() => setView("patient")}
          style={{ padding: "7px 12px", borderRadius: 8, cursor: "pointer",
            color: !demo ? "#fff" : COLORS.ink, background: !demo ? COLORS.accent : COLORS.faint, border: 0 }}>
          История выбранного пациента
        </button>}
      </div>
      {demo && <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button type="button" onClick={() => setDemoModule("support")} aria-pressed={demoModule === "support"}
          style={{ padding: "6px 10px", borderRadius: 8, cursor: "pointer",
            border: `1px solid ${COLORS.line}`, background: demoModule === "support" ? "#FCEDE8" : "white" }}>Support</button>
        <button type="button" onClick={() => setDemoModule("body")} aria-pressed={demoModule === "body"}
          style={{ padding: "6px 10px", borderRadius: 8, cursor: "pointer",
            border: `1px solid ${COLORS.line}`, background: demoModule === "body" ? "#FCEDE8" : "white" }}>Health</button>
      </div>}
      {!demo && <>
        <button type="button" disabled={status === "loading"} onClick={load}
          style={{ padding: "8px 12px", borderRadius: 8, border: 0, cursor: "pointer",
            background: COLORS.ink, color: "white", marginBottom: 12 }}>
          {status === "loading" ? "Проверяем доступ…" : "Загрузить защищённую историю"}
        </button>
        {error && <p role="alert" style={{ color: "#A03030", fontSize: 13 }}>{error}</p>}
        {!history && <p style={{ fontSize: 13, color: "#817B70" }}>
          Данные не загружаются автоматически. Доступ может быть закрыт до проверки российского медицинского контура.
        </p>}
        {history?.summary && <p style={{ fontSize: 13 }}>
          Последние данные от пациента: {history.summary.last_patient_contact_at
            ? formatDate(history.summary.last_patient_contact_at) : "нет"}.
          Отсутствие записи не означает выздоровления.
        </p>}
        {history?.integrity?.reconciliation_required && <p role="status" style={{ fontSize: 13, color: "#9F5E36" }}>
          Найдены расхождения между первичными записями и клиническим журналом; нужна проверка.
        </p>}
      </>}
      {(demo || history) && <div style={{ borderLeft: `2px solid ${COLORS.line}`, paddingTop: 5, paddingLeft: 18, marginLeft: 7 }}>
        {events.length ? events.map((e, i) => <EventCard key={`${e.at}:${e.source || e.type}:${i}`} entry={e} />)
          : <p style={{ fontSize: 13 }}>Клинических событий пока нет.</p>}
      </div>}
      <p style={{ fontSize: 12, color: "#817B70" }}>
        Это хронология записей, а не подтверждение диагноза, эффективности терапии или выздоровления.
        Публикация в Clinical Knowledge и исследовательский экспорт здесь отключены.
      </p>
    </>}
  </section>;
}
