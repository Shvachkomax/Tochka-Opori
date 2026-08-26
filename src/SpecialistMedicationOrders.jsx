import React, { useEffect, useState } from "react";

const SAFE_PERMISSION_KEYS = [
  ["view_authorized_order", "Показывать назначение"],
  ["show_authorized_schedule", "Показывать расписание"],
  ["explain_authorized_order", "Разрешить объяснение назначения"],
  ["remind_authorized_schedule", "Разрешить напоминания"],
  ["prepare_question_for_clinician", "Помогать подготовить вопрос"],
];

const FREQUENCIES = [
  ["once_daily", "1 раз в день"],
  ["twice_daily", "2 раза в день"],
  ["three_times_daily", "3 раза в день"],
  ["every_other_day", "через день"],
  ["weekly", "1 раз в неделю"],
];

const ROUTES = [
  ["oral", "внутрь"],
  ["sublingual", "под язык"],
  ["topical", "местно"],
  ["inhaled", "ингаляционно"],
  ["intramuscular", "внутримышечно"],
  ["intravenous", "внутривенно"],
  ["subcutaneous", "подкожно"],
  ["transdermal", "трансдермально"],
];

const inputStyle = { width: "100%", border: "1px solid rgba(46,42,37,.15)", borderRadius: 9, padding: "9px 10px", fontSize: 13, background: "#fff", color: "#2E2A25" };
const fieldStyle = { marginBottom: 10 };

function toDateTimeInput(value) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function initialForm(order = null) {
  const schedule = order?.schedules?.[0];
  return {
    conceptId: order?.medication_concept_id || "",
    name: order?.medication_name || "",
    formulation: order?.formulation || "",
    strength: order?.strength_value || "",
    unit: order?.strength_unit || "mg",
    route: order?.route_code || "oral",
    validFrom: order?.valid_from ? toDateTimeInput(order.valid_from) : toDateTimeInput(new Date().toISOString()),
    validUntil: order?.valid_until ? toDateTimeInput(order.valid_until) : "",
    frequency: schedule?.frequency_code || "once_daily",
    dose: schedule?.dose_amount || "",
    doseUnit: schedule?.dose_unit || order?.strength_unit || "mg",
    phaseEnd: schedule?.phase_end_at ? schedule.phase_end_at.slice(0, 16) : "",
    phases: order?.schedules?.length > 1 ? order.schedules.map((phase) => ({
      dose: phase.dose_amount,
      doseUnit: phase.dose_unit,
      frequency: phase.frequency_code,
      start: toDateTimeInput(phase.phase_start_at),
      end: phase.phase_end_at ? toDateTimeInput(phase.phase_end_at) : "",
    })) : [],
    mode: order?.schedules?.length > 1 ? "titration" : "fixed",
    decisionText: "",
    decisionRationale: "",
    clinicianInstruction: order?.clinician_instruction || "",
    permissionKeys: order?.ai_permission_keys || ["view_authorized_order", "show_authorized_schedule"],
  };
}

function toIso(value) {
  if (!value) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  return new Date(`${normalized}+03:00`).toISOString();
}

export default function SpecialistMedicationOrders({ data, onCreate, onSupersede, onRevoke }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [form, setForm] = useState(initialForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const concepts = data?.concepts || [];
  const orders = data?.orders || [];
  const current = orders.find((order) => ["active", "scheduled"].includes(order.effective_state));

  useEffect(() => {
    if (!form.conceptId && concepts[0]) {
      setForm((previous) => ({ ...previous, conceptId: concepts[0].id, name: concepts[0].display_name }));
    }
  }, [concepts, form.conceptId]);

  function update(key, value) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function selectConcept(value) {
    const concept = concepts.find((item) => item.id === value);
    setForm((previous) => ({ ...previous, conceptId: value, name: concept?.display_name || previous.name }));
  }

  function openCreate(order = null) {
    setEditingOrder(order);
    setForm(initialForm(order));
    setError("");
    setFormOpen(true);
  }

  function buildSchedules() {
    const validFrom = toIso(form.validFrom);
    if (form.mode === "fixed") {
      return [{
        phase_number: 1,
        dosing_mode: "fixed",
        phase_start_at: validFrom,
        phase_end_at: toIso(form.phaseEnd),
        dose_amount: Number(form.dose),
        dose_unit: form.doseUnit,
        frequency_code: form.frequency,
        route_code: form.route,
        administration_time_local: null,
        timezone: "Europe/Moscow",
        max_daily_dose_amount: null,
        max_daily_dose_unit: null,
      }];
    }
    const rows = form.phases.length ? form.phases : [{ dose: form.dose, doseUnit: form.doseUnit, frequency: form.frequency, start: form.validFrom, end: form.phaseEnd }];
    return rows.map((phase, index) => ({
      phase_number: index + 1,
      dosing_mode: "titration",
      phase_start_at: toIso(phase.start || (index === 0 ? form.validFrom : rows[index - 1].end)),
      phase_end_at: toIso(phase.end),
      dose_amount: Number(phase.dose),
      dose_unit: phase.doseUnit,
      frequency_code: phase.frequency,
      route_code: form.route,
      administration_time_local: null,
      timezone: "Europe/Moscow",
      max_daily_dose_amount: null,
      max_daily_dose_unit: null,
    }));
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setError("");
    const payload = {
      medication_concept_id: form.conceptId,
      formulation_snapshot: form.formulation || null,
      strength_value: Number(form.strength),
      strength_unit: form.unit,
      route_code: form.route,
      valid_from: toIso(form.validFrom),
      valid_until: toIso(form.validUntil),
      schedules: buildSchedules(),
      permission_keys: form.permissionKeys,
      decision_text: form.decisionText,
      decision_rationale: form.decisionRationale || null,
      clinician_instruction: form.clinicianInstruction || null,
      creation_idempotency_key: crypto.randomUUID(),
    };
    if (!payload.medication_concept_id || !payload.strength_value || !payload.schedules[0].dose_amount || !payload.decision_text.trim()) {
      setError("Заполните препарат, дозировку, расписание и решение специалиста.");
      return;
    }
    setSaving(true);
    try {
      if (editingOrder) await onSupersede(editingOrder, payload);
      else await onCreate(payload);
      setFormOpen(false);
      setEditingOrder(null);
    } catch (submitError) {
      setError(submitError.message || "Не удалось сохранить назначение.");
    } finally {
      setSaving(false);
    }
  }

  function addPhase() {
    setForm((previous) => ({
      ...previous,
      mode: "titration",
      phases: previous.phases.length ? previous.phases : [{ dose: previous.dose, doseUnit: previous.doseUnit, frequency: previous.frequency, start: previous.validFrom, end: previous.phaseEnd }, { dose: "", doseUnit: previous.doseUnit, frequency: previous.frequency, start: "", end: "" }],
    }));
  }

  const stateLabels = { active: "Действует", scheduled: "Запланировано", revoked: "Отозвано", superseded: "Заменено", completed: "Завершено", expired: "Истекло" };

  return (
    <div style={{ marginTop: 18 }} data-testid="specialist-medication-orders">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Лечение / Назначения</div>
        {data?.can_manage && !formOpen && (
          <button type="button" style={{ padding: "7px 10px", border: 0, borderRadius: 8, background: "#B85C4A", color: "#fff", cursor: "pointer", fontSize: 12 }} onClick={() => openCreate()}>
            Новое назначение
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 10 }}>Модуль: Точка Опоры. Назначение создаётся только специалистом с подтверждённым правом на назначение.</div>

      {orders.length === 0 && <div style={{ fontSize: 13, color: "#7A7268", padding: "10px 0" }}>Назначений пока нет.</div>}
      {orders.map((order) => (
        <div key={order.order_ref} style={{ padding: 12, borderRadius: 11, border: "1px solid rgba(46,42,37,.1)", marginBottom: 8, background: order === current ? "#F2F6F2" : "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 13 }}>{order.medication_name} · {order.strength_value} {order.strength_unit}</strong>
            <span style={{ fontSize: 11, color: "#5F7D6C", fontWeight: 700 }}>{stateLabels[order.effective_state] || order.effective_state}</span>
          </div>
          <div style={{ fontSize: 12, color: "#7A7268", marginTop: 4 }}>Версия {order.version_number} · {order.route_code} · с {new Date(order.valid_from).toLocaleDateString("ru-RU")}</div>
          {order.schedules?.map((phase) => <div key={phase.phase_number} style={{ fontSize: 12, color: "#5F574F", marginTop: 5 }}>Фаза {phase.phase_number}: {phase.dose_amount} {phase.dose_unit}, {phase.frequency_code}{phase.phase_end_at ? ` до ${new Date(phase.phase_end_at).toLocaleDateString("ru-RU")}` : " далее"}</div>)}
          {data?.can_manage && order.effective_state === "active" && (
            <div style={{ display: "flex", gap: 7, marginTop: 9, flexWrap: "wrap" }}>
              <button type="button" style={{ padding: "6px 9px", borderRadius: 7, border: "1px solid rgba(46,42,37,.15)", background: "#fff", cursor: "pointer", fontSize: 11 }} onClick={() => openCreate(order)}>Создать новую версию</button>
              <button type="button" style={{ padding: "6px 9px", borderRadius: 7, border: "1px solid rgba(184,92,74,.3)", background: "#fff", color: "#B85C4A", cursor: "pointer", fontSize: 11 }} onClick={async () => { if (window.confirm("Отозвать назначение?")) await onRevoke(order); }}>Отозвать назначение</button>
            </div>
          )}
        </div>
      ))}

      {formOpen && (
        <form onSubmit={submit} style={{ marginTop: 12, padding: 14, borderRadius: 12, background: "#FAF6EF", border: "1px solid rgba(46,42,37,.1)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{editingOrder ? "Новая версия назначения" : "Новое назначение"}</div>
          <div style={fieldStyle}><label style={{ fontSize: 11, color: "#7A7268" }}>Препарат</label><select style={inputStyle} value={form.conceptId} onChange={(e) => selectConcept(e.target.value)}><option value="">Выберите из справочника</option>{concepts.map((concept) => <option key={concept.id} value={concept.id}>{concept.display_name}</option>)}</select></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={fieldStyle}><label style={{ fontSize: 11, color: "#7A7268" }}>Доза препарата</label><input style={inputStyle} type="number" min="0.001" step="any" value={form.strength} onChange={(e) => update("strength", e.target.value)} /></div>
            <div style={fieldStyle}><label style={{ fontSize: 11, color: "#7A7268" }}>Единица</label><select style={inputStyle} value={form.unit} onChange={(e) => update("unit", e.target.value)}><option>mg</option><option>g</option><option>mcg</option><option>ml</option><option>unit</option><option>%</option></select></div>
          </div>
          <div style={fieldStyle}><label style={{ fontSize: 11, color: "#7A7268" }}>Форма / способ применения</label><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><input style={inputStyle} placeholder="Форма выпуска" value={form.formulation} onChange={(e) => update("formulation", e.target.value)} /><select style={inputStyle} value={form.route} onChange={(e) => update("route", e.target.value)}>{ROUTES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}><button type="button" style={{ ...inputStyle, cursor: "pointer", background: form.mode === "fixed" ? "#E2EBE4" : "#fff" }} onClick={() => update("mode", "fixed")}>Фиксированная доза</button><button type="button" style={{ ...inputStyle, cursor: "pointer", background: form.mode === "titration" ? "#E2EBE4" : "#fff" }} onClick={() => update("mode", "titration")}>Фазы титрации</button></div>
          {form.mode === "fixed" ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><div style={fieldStyle}><label style={{ fontSize: 11, color: "#7A7268" }}>Доза за приём</label><input style={inputStyle} type="number" min="0.001" step="any" value={form.dose} onChange={(e) => update("dose", e.target.value)} /></div><div style={fieldStyle}><label style={{ fontSize: 11, color: "#7A7268" }}>Единица дозы</label><select style={inputStyle} value={form.doseUnit} onChange={(e) => update("doseUnit", e.target.value)}><option>mg</option><option>g</option><option>mcg</option><option>ml</option><option>unit</option><option>%</option></select></div><div style={fieldStyle}><label style={{ fontSize: 11, color: "#7A7268" }}>Кратность</label><select style={inputStyle} value={form.frequency} onChange={(e) => update("frequency", e.target.value)}>{FREQUENCIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div style={fieldStyle}><label style={{ fontSize: 11, color: "#7A7268" }}>Конец фазы</label><input style={inputStyle} type="datetime-local" value={form.phaseEnd} onChange={(e) => update("phaseEnd", e.target.value)} /></div></div> : <div>{(form.phases.length ? form.phases : [{ dose: form.dose, doseUnit: form.doseUnit, frequency: form.frequency, start: form.validFrom, end: form.phaseEnd }]).map((phase, index) => <div key={index} style={{ padding: 8, marginBottom: 7, borderRadius: 8, background: "#fff" }}><div style={{ fontSize: 11, fontWeight: 700, marginBottom: 5 }}>Фаза {index + 1}</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}><input style={inputStyle} type="number" min="0.001" step="any" placeholder="Доза" value={phase.dose} onChange={(e) => setForm((p) => ({ ...p, phases: (p.phases.length ? p.phases : [{ ...phase }]).map((row, i) => i === index ? { ...row, dose: e.target.value } : row) }))} /><select style={inputStyle} value={phase.frequency} onChange={(e) => setForm((p) => ({ ...p, phases: (p.phases.length ? p.phases : [{ ...phase }]).map((row, i) => i === index ? { ...row, frequency: e.target.value } : row) }))}>{FREQUENCIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input style={inputStyle} type="datetime-local" placeholder="Начало" value={phase.start || (index === 0 ? form.validFrom : "")} readOnly={index === 0} onChange={(e) => setForm((p) => ({ ...p, phases: p.phases.map((row, i) => i === index ? { ...row, start: e.target.value } : row) }))} /><input style={inputStyle} type="datetime-local" placeholder="Конец" value={phase.end} onChange={(e) => setForm((p) => ({ ...p, phases: (p.phases.length ? p.phases : [{ ...phase }]).map((row, i) => i === index ? { ...row, end: e.target.value } : row) }))} /></div></div>)}<button type="button" style={{ ...inputStyle, cursor: "pointer" }} onClick={addPhase}>Добавить фазу</button></div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}><div style={fieldStyle}><label style={{ fontSize: 11, color: "#7A7268" }}>Начало назначения (Europe/Moscow)</label><input style={inputStyle} type="datetime-local" value={form.validFrom} onChange={(e) => update("validFrom", e.target.value)} /></div><div style={fieldStyle}><label style={{ fontSize: 11, color: "#7A7268" }}>Окончание назначения (Europe/Moscow)</label><input style={inputStyle} type="datetime-local" value={form.validUntil} onChange={(e) => update("validUntil", e.target.value)} /></div></div>
          <div style={fieldStyle}><label style={{ fontSize: 11, color: "#7A7268" }}>Клиническое решение</label><textarea style={{ ...inputStyle, minHeight: 54, resize: "vertical" }} value={form.decisionText} onChange={(e) => update("decisionText", e.target.value)} placeholder="Почему назначение выбрано" /></div>
          <div style={fieldStyle}><label style={{ fontSize: 11, color: "#7A7268" }}>Обоснование решения (для истории)</label><textarea style={{ ...inputStyle, minHeight: 54, resize: "vertical" }} value={form.decisionRationale} onChange={(e) => update("decisionRationale", e.target.value)} placeholder="Дополнительное клиническое обоснование" /></div>
          <div style={fieldStyle}><label style={{ fontSize: 11, color: "#7A7268" }}>Инструкция пациенту</label><textarea style={{ ...inputStyle, minHeight: 54, resize: "vertical" }} value={form.clinicianInstruction} onChange={(e) => update("clinicianInstruction", e.target.value)} placeholder="Текст, который можно показать пациенту" /></div>
          <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: "#7A7268", marginBottom: 5 }}>Безопасные будущие возможности AI</div>{SAFE_PERMISSION_KEYS.map(([key, label]) => <label key={key} style={{ display: "block", fontSize: 12, marginBottom: 4 }}><input type="checkbox" checked={form.permissionKeys.includes(key)} onChange={(e) => update("permissionKeys", e.target.checked ? [...form.permissionKeys, key] : form.permissionKeys.filter((item) => item !== key))} /> {label}</label>)}</div>
          {error && <div style={{ color: "#991B1B", fontSize: 12, marginBottom: 8 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}><button type="submit" disabled={saving} style={{ padding: "8px 12px", border: 0, borderRadius: 8, background: "#B85C4A", color: "#fff", cursor: saving ? "default" : "pointer", fontSize: 12 }}>{saving ? "Сохраняем..." : "Активировать"}</button><button type="button" style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(46,42,37,.15)", background: "#fff", cursor: "pointer", fontSize: 12 }} onClick={() => { setFormOpen(false); setEditingOrder(null); }}>Отмена</button></div>
        </form>
      )}
    </div>
  );
}
