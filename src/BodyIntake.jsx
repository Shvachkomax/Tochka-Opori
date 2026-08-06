import React, { useState } from "react";
import { getClientToken } from "./lib/clientToken.js";

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
  training_current: "Тренируетесь ли сейчас?",
  training_types: "Какие тренировки бывают?",
  training_limitations: "Есть ли ограничения или дискомфорт при нагрузке?",
  sleep_bedtime: "Во сколько обычно ложитесь?",
  sleep_wake_time: "Во сколько обычно встаете?",
  sleep_schedule_shift: "Есть ли сильная разница между буднями и выходными?",
  daily_drinks: "Что вы пьете в течение дня?",
  water_l_estimate: "Сколько примерно воды в день? (если знаете)",
  meals_per_day: "Сколько обычно приемов пищи в день?",
  food_organization: "Как обычно организовано питание?",
  red_flags_check: "Отметьте, если что-то из этого было в последнее время",
};

const SEX_OPTIONS = [
  { value: "male", label: "Мужской" },
  { value: "female", label: "Женский" },
  { value: "prefer_not_to_say", label: "Не хочу указывать" },
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

const TRAINING_CURRENT_OPTIONS = [
  { value: "none", label: "Нет" },
  { value: "irregular", label: "Да, нерегулярно" },
  { value: "1_2_week", label: "Да, 1–2 раза в неделю" },
  { value: "3plus_week", label: "Да, 3+ раза в неделю" },
];

const TRAINING_TYPES_OPTIONS = [
  { value: "strength", label: "Силовые" },
  { value: "cardio", label: "Кардио" },
  { value: "walking", label: "Ходьба" },
  { value: "pool", label: "Бассейн" },
  { value: "stretching", label: "Растяжка / мобилити" },
  { value: "group", label: "Групповые занятия" },
  { value: "other", label: "Другое" },
];

const SLEEP_SHIFT_OPTIONS = [
  { value: "no", label: "Нет, примерно одинаково" },
  { value: "slight", label: "Небольшая разница" },
  { value: "yes", label: "Да, сильно отличается" },
];

const DRINKS_OPTIONS = [
  { value: "water", label: "Вода" },
  { value: "tea", label: "Чай" },
  { value: "coffee", label: "Кофе" },
  { value: "sweet", label: "Сладкие напитки" },
  { value: "juice", label: "Соки" },
  { value: "energy", label: "Энергетики" },
  { value: "alcohol", label: "Алкоголь" },
  { value: "rarely_water", label: "Почти не пью воду" },
  { value: "other_drinks", label: "Другое" },
];

const MEALS_OPTIONS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4plus", label: "4+" },
  { value: "irregular", label: "Нерегулярно" },
];

const FOOD_ORG_OPTIONS = [
  { value: "self_cook", label: "Готовлю сам / сама" },
  { value: "cafeteria", label: "Ем в столовой / кафе / общепите" },
  { value: "ready_meal", label: "Заказываю готовую еду" },
  { value: "take_away", label: "Беру еду с собой" },
  { value: "snacks", label: "Часто перекусываю из магазина" },
  { value: "irregular_food", label: "Ем нерегулярно, как получится" },
  { value: "other_food", label: "Другое" },
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
  form: { maxWidth: 680, margin: "0 auto", padding: "0 24px 60px", width: "100%", boxSizing: "border-box", overflowX: "hidden" },
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
    training_current: "",
    training_types: [],
    training_limitations: "",
    sleep_bedtime: "",
    sleep_wake_time: "",
    sleep_schedule_shift: "",
    daily_drinks: [],
    water_l_estimate: "",
    meals_per_day: "",
    food_organization: [],
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

  function toggleMulti(key, value) {
    setFields(prev => {
      const current = prev[key];
      if (current.includes(value)) return { ...prev, [key]: current.filter(v => v !== value) };
      return { ...prev, [key]: [...current, value] };
    });
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
    if (fields.training_current && fields.training_current !== "none" && fields.training_types.length === 0) errs.training_types = "Укажите типы тренировок";
    if (!fields.meals_per_day) errs.meals_per_day = "Укажите количество приёмов пищи";
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

    // Read referral info from localStorage
    const bodyReferralSource = localStorage.getItem("body_referral_source") || "self_signup";
    const bodySpecialistId = localStorage.getItem("body_specialist_id") || null;
    const bodySpecialistName = localStorage.getItem("body_specialist_name") || null;

    try {
      let token;
      try { token = await getClientToken("body", "analyze"); } catch {}
      const hdrs = { "Content-Type": "application/json" };
      if (token) hdrs["Authorization"] = `Bearer ${token}`;

      let res = await fetch("/api/analyze", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          module: "body",
          stage: "intake_completed",
          answers: fields,
          text: "Анкета здоровья заполнена, проанализируй данные.",
          source: bodyReferralSource,
          specialist_id: bodySpecialistId,
          specialist_name: bodySpecialistName,
        }),
      });

      if (res.status === 401 && token) {
        try { token = await getClientToken("body", "analyze"); } catch {}
        hdrs["Authorization"] = `Bearer ${token}`;
        res = await fetch("/api/analyze", {
          method: "POST",
          headers: hdrs,
          body: JSON.stringify({
            module: "body",
            stage: "intake_completed",
            answers: fields,
            text: "Анкета здоровья заполнена, проанализируй данные.",
            source: bodyReferralSource,
            specialist_id: bodySpecialistId,
            specialist_name: bodySpecialistName,
          }),
        });
      }

      const json = await res.json();
      onComplete(json);
    } catch (err) {
      console.error("Body intake submit error:", err);
      setSubmitError("Не удалось подготовить план. Попробуйте ещё раз или продолжите диалог текстом.");
      setSubmitting(false);
    }
  }

  const totalFields = 20;
  const filled = Object.entries(fields).filter(([k, v]) => {
    if (k === "goal_custom") return false;
    const optional = ["waist_cm", "health_limitations", "training_limitations", "water_l_estimate", "sleep_bedtime", "sleep_wake_time"];
    if (optional.includes(k)) return false;
    if (k === "red_flags_check" || k === "training_types" || k === "daily_drinks" || k === "food_organization") return v.length > 0;
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
    <form data-body-intake onSubmit={handleSubmit} style={s.form}>
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

        .healthRedFlagsBlock {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          overflow: visible;
          margin-top: 24px;
        }
        .healthRedFlagsTitle {
          color: #5f574f;
          font-size: 22px;
          font-weight: 700;
          line-height: 1.25;
          margin-bottom: 16px;
        }
        .healthRedFlagsList {
          display: flex;
          flex-direction: column;
          gap: 14px;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
        .healthRedFlagItem {
          display: grid;
          grid-template-columns: 24px minmax(0, 1fr);
          column-gap: 12px;
          align-items: start;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          padding: 0;
          margin: 0;
          color: #5f574f;
          font-size: 16px;
          font-weight: 500;
          line-height: 1.35;
          cursor: pointer;
          position: static;
          transform: none;
        }
        .healthRedFlagCheckbox {
          width: 22px;
          height: 22px;
          min-width: 22px;
          margin: 2px 0 0 0;
          padding: 0;
          accent-color: #86a08f;
          position: static;
          transform: none;
        }
        .healthRedFlagText {
          display: block;
          min-width: 0;
          width: auto;
          max-width: 100%;
          color: #5f574f;
          font-size: 16px;
          line-height: 1.35;
          white-space: normal;
          overflow-wrap: break-word;
          word-break: normal;
          position: static;
          transform: none;
          margin: 0;
          padding: 0;
        }

        .healthCheckboxList {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 6px;
        }
        .healthCheckboxItem {
          display: grid;
          grid-template-columns: 24px minmax(0, 1fr);
          align-items: start;
          gap: 10px;
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          cursor: pointer;
          color: #5f574f;
          font-size: 15px;
          line-height: 1.35;
          padding: 0;
          margin: 0;
          position: static;
          transform: none;
        }
        .healthCheckboxInput {
          width: 20px;
          height: 20px;
          min-width: 20px;
          margin: 2px 0 0 0;
          padding: 0;
          accent-color: #86a08f;
          position: static;
          transform: none;
        }
        .healthCheckboxText {
          display: block;
          min-width: 0;
          max-width: 100%;
          white-space: normal;
          overflow-wrap: break-word;
          word-break: normal;
          line-height: 1.35;
          margin: 0;
          padding: 0;
          position: static;
          transform: none;
        }

        @media (max-width: 640px) {
          form[data-body-intake] {
            max-width: 100% !important;
            padding-left: 20px !important;
            padding-right: 20px !important;
            overflow-x: hidden !important;
          }
          .healthRedFlagsBlock,
          .healthRedFlagsList,
          .healthRedFlagItem {
            width: 100% !important;
            max-width: 100% !important;
            box-sizing: border-box !important;
            overflow: visible !important;
          }
          .healthRedFlagItem {
            display: grid !important;
            grid-template-columns: 24px minmax(0, 1fr) !important;
            column-gap: 12px !important;
            align-items: start !important;
            justify-content: start !important;
          }
          .healthRedFlagText {
            min-width: 0 !important;
            max-width: 100% !important;
            white-space: normal !important;
            overflow-wrap: break-word !important;
            word-break: normal !important;
            margin-left: 0 !important;
            position: static !important;
            transform: none !important;
          }
          .healthCheckboxList {
            width: 100% !important;
            box-sizing: border-box !important;
          }
          .healthCheckboxItem {
            display: grid !important;
            grid-template-columns: 24px minmax(0, 1fr) !important;
            gap: 10px !important;
            align-items: start !important;
            width: 100% !important;
            box-sizing: border-box !important;
          }
          .healthCheckboxText {
            min-width: 0 !important;
            max-width: 100% !important;
            white-space: normal !important;
            overflow-wrap: break-word !important;
            word-break: normal !important;
            font-size: 15px !important;
            position: static !important;
            transform: none !important;
          }
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

      <div style={{ ...s.field, marginTop: 32 }}>
        <div style={{ ...s.label, fontSize: 17, borderBottom: "1px solid #e8e2d8", paddingBottom: 8 }}>Режим сна</div>
      </div>
      {input("sleep_bedtime", "text", "Например: 23:00")}
      {input("sleep_wake_time", "text", "Например: 7:00")}
      {select("sleep_schedule_shift", SLEEP_SHIFT_OPTIONS)}

      {select("nutrition_main_problem", NUTRITION_OPTIONS)}

      <div style={{ ...s.field, marginTop: 32 }}>
        <div style={{ ...s.label, fontSize: 17, borderBottom: "1px solid #e8e2d8", paddingBottom: 8 }}>Тренировки</div>
      </div>
      {select("training_current", TRAINING_CURRENT_OPTIONS)}
      {fields.training_current && fields.training_current !== "none" && (
        <div style={s.field}>
          <label style={s.label}>{FIELD_LABELS.training_types}</label>
          <div className="healthCheckboxList">
            {TRAINING_TYPES_OPTIONS.map(o => (
              <label key={o.value} className="healthCheckboxItem">
                <input className="healthCheckboxInput" type="checkbox" checked={fields.training_types.includes(o.value)} onChange={() => toggleMulti("training_types", o.value)} />
                <span className="healthCheckboxText">{o.label}</span>
              </label>
            ))}
          </div>
          {errors.training_types && <div style={s.error}>{errors.training_types}</div>}
        </div>
      )}
      <div style={s.field}>
        <label style={s.label}>{FIELD_LABELS.training_limitations} <span style={s.optional}>(необязательно)</span></label>
        <textarea className="body-intake-textarea" style={s.textarea} value={fields.training_limitations} onChange={e => set("training_limitations", e.target.value)} placeholder="Например: болят колени при беге, дискомфорт в пояснице..." />
      </div>

      <div style={{ ...s.field, marginTop: 32 }}>
        <div style={{ ...s.label, fontSize: 17, borderBottom: "1px solid #e8e2d8", paddingBottom: 8 }}>Питание и напитки</div>
      </div>
      {select("meals_per_day", MEALS_OPTIONS)}
      <div style={s.field}>
        <label style={s.label}>{FIELD_LABELS.daily_drinks}</label>
        <div className="healthCheckboxList">
          {DRINKS_OPTIONS.map(o => (
            <label key={o.value} className="healthCheckboxItem">
              <input className="healthCheckboxInput" type="checkbox" checked={fields.daily_drinks.includes(o.value)} onChange={() => toggleMulti("daily_drinks", o.value)} />
              <span className="healthCheckboxText">{o.label}</span>
            </label>
          ))}
        </div>
      </div>
      {input("water_l_estimate", "number", "Например: 1.5")}
      <div style={s.field}>
        <label style={s.label}>{FIELD_LABELS.food_organization}</label>
        <div className="healthCheckboxList">
          {FOOD_ORG_OPTIONS.map(o => (
            <label key={o.value} className="healthCheckboxItem">
              <input className="healthCheckboxInput" type="checkbox" checked={fields.food_organization.includes(o.value)} onChange={() => toggleMulti("food_organization", o.value)} />
              <span className="healthCheckboxText">{o.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={s.field}>
        <label style={s.label}>{FIELD_LABELS.health_limitations} <span style={s.optional}>(необязательно)</span></label>
        <textarea className="body-intake-textarea" style={s.textarea} value={fields.health_limitations} onChange={e => set("health_limitations", e.target.value)} placeholder="Например: проблемы с коленями, гипертония, диабет, гипотиреоз..." />
      </div>

      <div className="healthRedFlagsBlock">
        <div className="healthRedFlagsTitle">{FIELD_LABELS.red_flags_check}</div>
        <div className="healthRedFlagsList">
          {RED_FLAGS_OPTIONS.map(o => (
            <label key={o.value} className="healthRedFlagItem">
              <input className="healthRedFlagCheckbox" type="checkbox" checked={fields.red_flags_check.includes(o.value)} onChange={() => toggleRedFlag(o.value)} />
              <span className="healthRedFlagText">{o.label}</span>
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
