import React, { useEffect, useRef, useState } from "react";

// Authorized read-only patient chronology.
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
const MEDICATION_STATES = {
  revoked:"отменено врачом", superseded:"заменено последующей версией",
  activation_recorded:"начало назначения зарегистрировано",not_confirmed:"статус не подтверждён",
};

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
  note: "Описание", medication_name: "Препарат", strength_value: "Сила лекарственной формы",
  strength_unit: "Единица силы", weight_kg: "Масса, кг", sleep_hours: "Сон, ч",
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
    {Array.isArray(item.details?.schedules) && item.details.schedules.length > 0 && (
      <div style={{ marginTop: 7, padding: 9, background: "#F8F2EA", borderRadius: 8, fontSize: 12 }}>
        <strong>Схема, зафиксированная врачом:</strong>
        {item.details.schedules.map((p, i) => <div key={i} style={{ marginTop: 5 }}>
          Этап {p.phase_number ?? i + 1}: {p.dose_amount ?? "доза не указана"} {p.dose_unit || ""}
          {p.frequency_code ? ` · ${p.frequency_code}` : ""}
          {p.phase_start_at ? ` · с ${formatDate(p.phase_start_at)}` : ""}
          {p.phase_end_at ? ` до ${formatDate(p.phase_end_at)}` : ""}
        </div>)}
      </div>
    )}
    {item.validation_status && item.validation_status !== "clinician_confirmed"
      && <div style={{ fontSize: 11, color: "#997A55", marginTop: 4 }}>Статус проверки: {item.validation_status === "unreviewed" ? "не проверено" : item.validation_status}</div>}
  </div>;
}
export default function ClinicalTimelinePanel({ module = "support", clientRef = null, organizationId = null }) {
  const [expanded, setExpanded] = useState(false);
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
  const events = history?.events || [];
  const courses = history?.treatment_courses || [];
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
        История выбранного пациента доступна только после проверки ваших прав. Данные не
        загружаются автоматически.
      </p>
      {clientRef ? <>
        <button type="button" disabled={status === "loading"} onClick={load}
          style={{ padding: "8px 12px", borderRadius: 8, border: 0,
            cursor: status === "loading" ? "wait" : "pointer",
            background: COLORS.ink, color: "white", marginBottom: 12 }}>
          {status === "loading" ? "Проверяем доступ…" : history ? "Обновить историю" : "Загрузить историю"}
        </button>
        {error && <p role="alert" style={{ color: "#A03030", fontSize: 13 }}>{error}</p>}
        {!history && status !== "loading" && !error && <p style={{ fontSize: 13, color: "#817B70" }}>
          Нажмите кнопку, чтобы запросить доступ к истории выбранного пациента.
        </p>}
        {history?.summary && <p style={{ fontSize: 13 }}>
          Последние данные от пациента: {history.summary.last_patient_contact_at
            ? formatDate(history.summary.last_patient_contact_at) : "нет"}.
          Отсутствие записи не означает выздоровления.
        </p>}
        {history?.integrity?.reconciliation_required && <p role="status" style={{ fontSize: 13, color: "#9F5E36" }}>
          Найдены расхождения между первичными записями и клиническим журналом; нужна проверка.
        </p>}
      </> : <p role="status" style={{ fontSize: 13, color: "#817B70" }}>
        Сначала выберите пациента.
      </p>}
      {history && <div style={{ borderLeft: `2px solid ${COLORS.line}`, paddingTop: 5, paddingLeft: 18, marginLeft: 7 }}>
        {events.length ? events.map((e, i) => <EventCard key={`${e.at}:${e.source || e.type}:${i}`} entry={e} />)
          : <p style={{ fontSize: 13 }}>Клинических событий пока нет.</p>}
      </div>}
      {history && courses.length > 0 && (
        <div style={{ marginTop: 16, padding: 12,
          border: `1px solid ${COLORS.line}`, borderRadius: 12 }}>
          <strong style={{ display: "block", marginBottom: 10 }}>
            История врачебных назначений
          </strong>
          {courses.map((course, ci) => <div key={ci} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: "#765F54" }}>
              Курс {ci + 1}: {MEDICATION_STATES[course.latest_recorded_state] || "статус неизвестен"}
            </div>
            {(course.versions || []).map((version, vi) => <div key={vi}
              style={{ padding: "10px 12px", borderLeft: `2px solid ${COLORS.accent}`,
                background: COLORS.faint, borderRadius: 8, marginTop: 9 }}>
              <div style={{ fontWeight: 650 }}>
                Версия № {version.version} · {formatDate(version.issued_at)}
              </div>
              <div style={{ fontSize: 13, marginTop: 5 }}>
                {version.medication_name || "Название не указано"}
                {" · "}Сила формы: {version.formulation_strength ?? "?"} {version.strength_unit || ""}
              </div>
              {(version.schedules || []).map((phase, pi) => <div key={pi}
                style={{ fontSize: 13, marginTop: 4 }}>
                Этап {phase.phase_number ?? pi + 1}: доза приёма {phase.dose_amount ?? "?"}
                {" "}{phase.dose_unit || ""}
                {phase.frequency_code ? ` · ${phase.frequency_code}` : ""}
              </div>)}
              <div style={{ fontSize: 12, marginTop: 5, color: "#78695E" }}>
                {MEDICATION_STATES[version.order_record_state] || "статус неизвестен"}.
                {" "}Автор: {version.author_status === "prescriber_recorded_not_signed"
                  ? "указан в записи назначения, электронная подпись не проверена"
                  : "не подтверждён"}.
              </div>
            </div>)}
          </div>)}
        </div>
      )}
      <p style={{ fontSize: 12, color: "#817B70" }}>
        Хронология не подтверждает диагноз, эффективность терапии или выздоровление. Не изменяйте
        назначения и дозировки без согласования с лечащим врачом. Данные доступны только для просмотра.
      </p>
    </>}
  </section>;
}
