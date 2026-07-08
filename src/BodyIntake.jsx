import React, { useState } from "react";

const FIELD_LABELS = {
  display_name: "Как к вам обращаться?",
  sex: "Пол",
  age: "Возраст",
  goal: "Ваша цель",
  goal_custom: "Опишите вашу цель",
  height_cm: "Рост (см)",
  weight_kg: "Вес (кг)",
  waist_cm: "Объём талии (см) — необязательно",
  work_activity_level: "Уровень физической активности на работе",
  daily_steps_estimate: "Сколько шагов в день вы проходите?",
  health_limitations: "Ограничения по здоровью (необязательно)",
  sleep_hours_estimate: "Сколько часов в сутки вы спите?",
  nutrition_main_problem: "Главная проблема питания",
  red_flags_check: "Отметьте, если что-то из этого было в последнее время",
};

const SEX_OPTIONS = [
  { value: "male", label: "Мужской" },
  { value: "female", label: "Женский" },
  { value: "other", label: "Другой" },
  { value: "prefer_not", label: "Не хочу указывать" },
];

const GOAL_OPTIONS = [
  { value: "improve_wellbeing", label: "Улучшить самочувствие" },
  { value: "slimness", label: "Стройность" },
  { value: "custom", label: "Свой вариант" },
];

const ACTIVITY_OPTIONS = [
  { value: "sedentary", label: "Сидячая работа (офис, за рулём)" },
  { value: "light", label: "Лёгкая активность (передвигаюсь пешком)" },
  { value: "moderate", label: "Умеренная (поднимаю грузы, много хожу)" },
  { value: "heavy", label: "Тяжёлый физический труд" },
];

const STEPS_OPTIONS = [
  { value: "less_3000", label: "Меньше 3000" },
  { value: "3000_6000", label: "3000–6000" },
  { value: "6000_10000", label: "6000–10000" },
  { value: "more_10000", label: "Больше 10000" },
];

const SLEEP_OPTIONS = [
  { value: "less_5", label: "Меньше 5 часов" },
  { value: "5_6", label: "5–6 часов" },
  { value: "6_7", label: "6–7 часов" },
  { value: "7_8", label: "7–8 часов" },
  { value: "more_8", label: "Больше 8 часов" },
];

const NUTRITION_OPTIONS = [
  { value: "overeating", label: "Переедание" },
  { value: "unhealthy_food", label: "Нездоровый выбор продуктов" },
  { value: "irregular", label: "Нерегулярное питание" },
  { value: "portion_control", label: "Контроль порций" },
  { value: "snacking", label: "Частые перекусы" },
  { value: "other", label: "Другое" },
];

const RED_FLAGS_OPTIONS = [
  { value: "chest_pain", label: "Боль в груди" },
  { value: "severe_dizziness", label: "Сильное головокружение" },
  { value: "unexplained_weight_loss", label: "Необъяснимая потеря веса" },
  { value: "blood_in_stool", label: "Кровь в стуле" },
  { value: "fainting", label: "Обмороки" },
  { value: "none", label: "Ничего из перечисленного" },
];

const s = {
  form: { maxWidth: 680, margin: "0 auto", padding: "0 24px 60px" },
  heading: { fontSize: 28, fontWeight: 800, marginBottom: 8, letterSpacing: "-0.03em", color: "#2f2925" },
  subheading: { color: "#665c52", fontSize: 15, lineHeight: 1.5, marginBottom: 28 },
  field: { marginBottom: 22 },
  label: { display: "block", color: "#5f574f", fontSize: 15, fontWeight: 600, marginBottom: 6 },
  optional: { color: "#8d8378", fontWeight: 400, fontSize: 12 },
  input: {
    width: "100%", height: 48, padding: "0 16px", borderRadius: 14,
    border: "1px solid #d8cec1", background: "#ffffff",
    color: "#2f2925", fontSize: 16, outline: "none",
    fontFamily: "inherit", boxSizing: "border-box",
  },
  select: {
    width: "100%", height: 48, padding: "0 16px", borderRadius: 14,
    border: "1px solid #d8cec1", background: "#ffffff",
    color: "#2f2925", fontSize: 16, outline: "none", appearance: "auto", boxSizing: "border-box",
  },
  textarea: {
    width: "100%", minHeight: 100, padding: 14, borderRadius: 14,
    border: "1px solid #d8cec1", background: "#ffffff",
    color: "#2f2925", fontSize: 16, outline: "none", resize: "vertical",
    fontFamily: "inherit", boxSizing: "border-box",
  },
  checkboxGroup: { display: "flex", flexDirection: "column", gap: 10 },
  checkboxRow: { display: "flex", alignItems: "center", gap: 10, cursor: "pointer", color: "#5f574f", fontSize: 15 },
  checkbox: { width: 20, height: 20, accentColor: "#86a08f", flexShrink: 0 },
  error: { color: "#b5473f", fontSize: 13, marginTop: 4 },
  button: {
    width: "100%", height: 52, borderRadius: 20, background: "#7D9A89",
    color: "#ffffff", fontWeight: 800, fontSize: 16, border: 0, cursor: "pointer", marginTop: 8,
  },
  buttonDisabled: {
    width: "100%", height: 52, borderRadius: 20,
    background: "#c4d0c6", color: "#ffffff",
    fontWeight: 800, fontSize: 16, border: 0, cursor: "not-allowed", marginTop: 8,
  },
  progressBar: { background: "#e8e2d8", borderRadius: 999, height: 6, marginBottom: 28, overflow: "hidden" },
  progressFill: { background: "#86a08f", height: "100%", borderRadius: 999, transition: "width .3s" },
};

export default function BodyIntake({ onComplete }) {
  const [fields, setFields] = useState({
    display_name: "",
    sex: "",
    age: "",
    goal: "",
    goal_custom: "",
    height_cm: "",
    weight_kg: "",
    waist_cm: "",
    work_activity_level: "",
    daily_steps_estimate: "",
    health_limitations: "",
    sleep_hours_estimate: "",
    nutrition_main_problem: "",
    red_flags_check: [],
  });

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  function set(field, value) {
    setFields(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }));
    if (submitError) setSubmitError("");
  }

  function toggleRedFlag(value) {
    setFields(prev => {
      const current = prev.red_flags_check;
      if (value === "none") return { ...prev, red_flags_check: ["none"] };
      const filtered = current.filter(v => v !== "none");
      if (current.includes(value)) return { ...prev, red_flags_check: filtered.filter(v => v !== value) };
      return { ...prev, red_flags_check: [...filtered, value] };
    });
  }

  function validate() {
    const errs = {};
    if (!fields.display_name.trim()) errs.display_name = "Укажите, как к вам обращаться";
    if (!fields.sex) errs.sex = "Выберите пол";
    if (!fields.age || isNaN(fields.age) || fields.age < 10 || fields.age > 120) errs.age = "Укажите возраст (10–120)";
    if (!fields.goal) errs.goal = "Выберите цель";
    if (fields.goal === "custom" && !fields.goal_custom.trim()) errs.goal_custom = "Опишите вашу цель";
    if (!fields.height_cm || isNaN(fields.height_cm) || fields.height_cm < 100 || fields.height_cm > 250) errs.height_cm = "Укажите рост (100–250 см)";
    if (!fields.weight_kg || isNaN(fields.weight_kg) || fields.weight_kg < 20 || fields.weight_kg > 400) errs.weight_kg = "Укажите вес (20–400 кг)";
    if (!fields.work_activity_level) errs.work_activity_level = "Выберите уровень активности";
    if (!fields.daily_steps_estimate) errs.daily_steps_estimate = "Оцените количество шагов";
    if (!fields.sleep_hours_estimate) errs.sleep_hours_estimate = "Оцените сон";
    if (!fields.nutrition_main_problem) errs.nutrition_main_problem = "Выберите главную проблему питания";
    if (!fields.red_flags_check.length) errs.red_flags_check = "Отметьте симптомы или «ничего из перечисленного»";
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");

    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module: "body",
          stage: "intake_completed",
          answers: fields,
          text: "Анкета здоровья заполнена, проанализируй данные.",
        }),
      });
      const json = await res.json();
      onComplete(json);
    } catch (err) {
      console.error("Body intake submit error:", err);
      setSubmitError("Не удалось подготовить план. Попробуйте ещё раз или продолжите диалог текстом.");
      setSubmitting(false);
    }
  }

  const totalFields = 13;
  const filled = Object.entries(fields).filter(([k, v]) => {
    if (k === "goal_custom") return false;
    if (k === "waist_cm" || k === "health_limitations") return false;
    if (k === "red_flags_check") return v.length > 0;
    return v !== "";
  }).length;
  const progress = Math.min(filled / totalFields, 1);

  function input(key, type = "text", placeholder = "") {
    return (
      <div style={s.field}>
        <label style={s.label}>{FIELD_LABELS[key]}</label>
        <input className="body-intake-input" style={s.input} type={type} placeholder={placeholder} value={fields[key]} onChange={e => set(key, e.target.value)} />
        {errors[key] && <div style={s.error}>{errors[key]}</div>}
      </div>
    );
  }

  function select(key, options, placeholder = "Выберите...") {
    return (
      <div style={s.field}>
        <label style={s.label}>{FIELD_LABELS[key]}</label>
        <select style={{ ...s.select, color: fields[key] ? "#2f2925" : "#8d8378" }} value={fields[key]} onChange={e => set(key, e.target.value)}>
          <option value="" disabled>{placeholder}</option>
          {options.map(o => <option key={o.value} value={o.value} style={{ color: "#020617" }}>{o.label}</option>)}
        </select>
        {errors[key] && <div style={s.error}>{errors[key]}</div>}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={s.form}>
      <style>{`
        .body-intake-input:focus,
        .body-intake-select:focus,
        .body-intake-textarea:focus {
          border-color: #86a08f !important;
          box-shadow: 0 0 0 3px rgba(134,160,143,.18) !important;
        }
        .body-intake-input::placeholder,
        .body-intake-textarea::placeholder {
          color: #8d8378 !important;
        }
      `}</style>
      <h2 style={s.heading}>Давайте познакомимся</h2>
      <p style={s.subheading}>Несколько вопросов, чтобы понять вашу ситуацию. Мы не собираем ФИО и не храним личные данные.</p>

      <div style={s.progressBar}>
        <div style={{ ...s.progressFill, width: `${progress * 100}%` }} />
      </div>

      {input("display_name", "text", "Имя или псевдоним")}
      {select("sex", SEX_OPTIONS)}
      {input("age", "number", "Например: 30")}
      {select("goal", GOAL_OPTIONS)}
      {fields.goal === "custom" && input("goal_custom", "text", "Опишите вашу цель")}
      {input("height_cm", "number", "Например: 170")}
      {input("weight_kg", "number", "Например: 70")}
      {input("waist_cm", "number", "Например: 80")}

      <div style={s.field}>
        <label style={s.label}>{FIELD_LABELS.work_activity_level}</label>
        <select className="body-intake-select" style={{ ...s.select, color: fields.work_activity_level ? "#2f2925" : "#8d8378" }} value={fields.work_activity_level} onChange={e => set("work_activity_level", e.target.value)}>
          <option value="" disabled>Выберите...</option>
          {ACTIVITY_OPTIONS.map(o => <option key={o.value} value={o.value} style={{ color: "#020617" }}>{o.label}</option>)}
        </select>
        {errors.work_activity_level && <div style={s.error}>{errors.work_activity_level}</div>}
      </div>

      {select("daily_steps_estimate", STEPS_OPTIONS)}
      {select("sleep_hours_estimate", SLEEP_OPTIONS)}
      {select("nutrition_main_problem", NUTRITION_OPTIONS)}

      <div style={s.field}>
        <label style={s.label}>{FIELD_LABELS.health_limitations} <span style={s.optional}>(необязательно)</span></label>
        <textarea className="body-intake-textarea" style={s.textarea} value={fields.health_limitations} onChange={e => set("health_limitations", e.target.value)} placeholder="Например: проблемы с коленями, гипертония, диабет..." />
      </div>

      <div style={s.field}>
        <label style={s.label}>{FIELD_LABELS.red_flags_check}</label>
        <div style={s.checkboxGroup}>
          {RED_FLAGS_OPTIONS.map(o => (
            <label key={o.value} style={s.checkboxRow}>
              <input style={s.checkbox} type="checkbox" checked={fields.red_flags_check.includes(o.value)} onChange={() => toggleRedFlag(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
        {errors.red_flags_check && <div style={s.error}>{errors.red_flags_check}</div>}
      </div>

      {submitError && (
        <div style={{ color: "#b5473f", fontSize: 14, marginTop: 12, lineHeight: 1.5 }}>
          {submitError}
        </div>
      )}

      <button type="submit" disabled={submitting} style={submitting ? s.buttonDisabled : s.button}>
        {submitting ? "Готовим план…" : "Получить план"}
      </button>
    </form>
  );
}
