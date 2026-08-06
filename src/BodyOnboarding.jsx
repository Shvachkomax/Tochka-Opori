import React, { useState, useEffect } from "react";
import { getClientToken } from "./lib/clientToken.js";
import PlateGuide from "./PlateGuide.jsx";
import { getBodySession } from "./lib/sessionAccess.js";

const TRACKERS = [
  { value: "apple_health", label: "Apple Health" },
  { value: "google_fit", label: "Google Fit" },
  { value: "garmin", label: "Garmin" },
  { value: "fitbit", label: "Fitbit" },
  { value: "samsung_health", label: "Samsung Health" },
  { value: "xiaomi", label: "Xiaomi / Mi Fitness" },
  { value: "other", label: "Другое" },
  { value: "none", label: "Не использую" },
];

const TRACKED_METRICS = [
  { value: "steps", label: "Шаги" },
  { value: "workouts", label: "Тренировки" },
  { value: "heart_rate", label: "Пульс" },
  { value: "sleep", label: "Сон" },
  { value: "calories", label: "Потраченные калории" },
  { value: "other", label: "Другое" },
];

const CALORIE_MODES = [
  { value: "regular", label: "Регулярно" },
  { value: "sometimes", label: "Иногда" },
  { value: "no", label: "Не веду" },
  { value: "do_not_want", label: "Не хочу считать калории" },
];

const DATA_ENTRY = [
  { value: "manual", label: "Вручную" },
  { value: "automatic", label: "Автоматически" },
  { value: "undecided", label: "Пока не решил" },
];

const PRIORITY_METRICS = [
  { value: "weight", label: "Вес" },
  { value: "waist", label: "Талия" },
  { value: "nutrition", label: "Питание" },
  { value: "steps", label: "Шаги" },
  { value: "workouts", label: "Тренировки" },
  { value: "sleep", label: "Сон" },
  { value: "energy", label: "Энергия" },
  { value: "mood", label: "Настроение" },
];

const SUPPORT_STYLES = [
  { value: "gentle", label: "Мягкий" },
  { value: "structured", label: "Структурированный" },
  { value: "motivational", label: "Больше мотивации" },
  { value: "analytical", label: "Больше анализа" },
];

function Chip({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 14px", borderRadius: 10,
        border: active ? "1px solid #86a08f" : "1px solid #d8cec1",
        background: active ? "#e8f0ea" : "#fff",
        cursor: "pointer", fontSize: 14,
        color: active ? "#2f2925" : "#5f574f",
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}

export default function BodyOnboarding({ onComplete, onSkip }) {
  const [step, setStep] = useState(0); // 0=intro, 1=preferences
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Preferences state
  const [trackerUsed, setTrackerUsed] = useState(null);
  const [trackerName, setTrackerName] = useState("");
  const [trackedMetrics, setTrackedMetrics] = useState([]);
  const [calorieMode, setCalorieMode] = useState(null);
  const [calorieApp, setCalorieApp] = useState("");
  const [dataEntry, setDataEntry] = useState(null);
  const [priorityMetrics, setPriorityMetrics] = useState([]);
  const [supportStyle, setSupportStyle] = useState(null);

  useEffect(() => {
    // Load existing onboarding if any
    async function load() {
      const saved = getBodySession();
      if (!saved.sessionId || !saved.accessToken) return;
      try {
        let token;
        try { token = await getClientToken("body", "session"); } catch {}
        const hdrs = { "Content-Type": "application/json" };
        if (token) hdrs["Authorization"] = `Bearer ${token}`;
        const res = await fetch("/api/session", {
          method: "POST",
          headers: hdrs,
          body: JSON.stringify({ action: "getBodyOnboarding", session_id: saved.sessionId, access_token: saved.accessToken }),
        });
        const data = await res.json();
        if (data.ok && data.onboarding) {
          const o = data.onboarding;
          if (o.intro_completed) {
            setStep(1);
          }
          setTrackerUsed(o.activity_tracker_used);
          setTrackerName(o.activity_tracker_name || "");
          setTrackedMetrics(o.tracked_metrics || []);
          setCalorieMode(o.calorie_tracking_mode);
          setCalorieApp(o.calorie_tracking_app || "");
          setDataEntry(o.data_entry_preference);
          setPriorityMetrics(o.priority_metrics || []);
          setSupportStyle(o.support_style);
        }
      } catch (e) {
        // Silent — onboarding is optional
      }
    }
    load();
  }, []);

  function toggleArray(item, arr, setter) {
    setter(arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item]);
  }

  async function saveAndComplete() {
    setLoading(true);
    setError("");
    const saved = getBodySession();
    if (!saved.sessionId || !saved.accessToken) {
      setError("Сессия не найдена.");
      setLoading(false);
      return;
    }
    try {
      let token;
      try { token = await getClientToken("body", "session"); } catch {}
      const hdrs = { "Content-Type": "application/json" };
      if (token) hdrs["Authorization"] = `Bearer ${token}`;

      const onboarding = {
        intro_completed: true,
        activity_tracker_used: trackerUsed != null && trackerUsed !== "none",
        activity_tracker_name: trackerUsed === "other" ? trackerName : (trackerUsed && trackerUsed !== "none" ? trackerUsed : null),
        tracked_metrics: trackedMetrics,
        calorie_tracking_mode: calorieMode,
        calorie_tracking_app: calorieApp || null,
        data_entry_preference: dataEntry,
        priority_metrics: priorityMetrics,
        support_style: supportStyle,
      };

      const res = await fetch("/api/session", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ action: "saveBodyOnboarding", session_id: saved.sessionId, access_token: saved.accessToken, onboarding }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Не удалось сохранить настройки.");
      }
      onComplete();
    } catch (e) {
      setError(e.message || "Ошибка сохранения.");
    } finally {
      setLoading(false);
    }
  }

  const s = {
    page: { maxWidth: 640, margin: "32px auto 64px", padding: "0 16px", width: "100%", boxSizing: "border-box" },
    h2: { fontSize: 22, fontWeight: 700, color: "#2f2925", marginBottom: 8, fontFamily: "Georgia, serif" },
    p: { color: "#665c52", fontSize: 15, lineHeight: 1.6, marginBottom: 16 },
    section: { padding: 20, borderRadius: 16, background: "#faf6ef", border: "1px solid #e8e2d8", marginBottom: 20 },
    label: { fontSize: 14, fontWeight: 600, color: "#2f2925", marginBottom: 8, marginTop: 16 },
    row: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 },
    input: { width: "100%", height: 44, padding: "0 14px", borderRadius: 12, border: "1px solid #d8cec1", background: "#fff", color: "#2f2925", fontSize: 15, outline: "none", fontFamily: "inherit", boxSizing: "border-box" },
    primary: { width: "100%", height: 52, borderRadius: 16, border: 0, background: "#5f8b7a", color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: "inherit" },
    secondary: { width: "100%", height: 48, borderRadius: 14, border: "1px solid #d8cec1", background: "#ede7dc", color: "#2f2925", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" },
  };

  // Step 0: Intro
  if (step === 0) {
    return (
      <div style={s.page}>
        <div style={s.h2}>Как работает дневник</div>
        <div style={s.p}>
          Дневник помогает замечать связи между питанием, активностью и самочувствием.
          Здесь нет строгих норм — только наблюдение и поддержка.
        </div>

        <div style={s.section}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#2f2925", marginBottom: 12 }}>Зачем отмечать питание?</div>
          <div style={{ fontSize: 14, color: "#5f574f", lineHeight: 1.6, marginBottom: 12 }}>
            Чтобы увидеть привычки и связи: как состав тарелки влияет на энергию, сон и настроение.
            Не для подсчёта калорий, а для понимания.
          </div>
        </div>

        <div style={s.section}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#2f2925", marginBottom: 12 }}>Зачем фотографировать тарелки?</div>
          <div style={{ fontSize: 14, color: "#5f574f", lineHeight: 1.6 }}>
            Фото помогает увидеть, из чего состоит приём пищи: достаточно ли овощей, белка, клетчатки.
            Это ориентир, а не точный расчёт калорий.
          </div>
        </div>

        {/* Plate scheme */}
        <div style={s.section}>
          <PlateGuide />
        </div>

        <div style={s.section}>
          <div style={{ fontSize: 14, color: "#5f574f", lineHeight: 1.6 }}>
            • Оценка по фотографии приблизительная<br/>
            • Это не точный расчёт калорий<br/>
            • Сервис не заменяет врача<br/>
            • При медицинских вопросах обращайтесь к специалисту
          </div>
        </div>

        <button onClick={() => setStep(1)} style={s.primary}>Понятно, продолжить</button>
        <div style={{ height: 12 }} />
        <button onClick={onSkip} style={s.secondary}>Вернуться в кабинет</button>
      </div>
    );
  }

  // Step 1: Preferences
  return (
    <div style={s.page}>
      <div style={s.h2}>Настройте дневник под себя</div>
      <div style={s.p}>Эти настройки помогут AI лучше понимать ваш контекст.</div>

      {error && <div style={{ color: "#b5473f", fontSize: 14, marginBottom: 12 }}>{error}</div>}

      <div style={s.section}>
        <div style={s.label}>Пользуетесь ли вы трекером активности?</div>
        <div style={s.row}>
          {TRACKERS.map(t => (
            <Chip key={t.value} label={t.label} active={trackerUsed === t.value} onClick={() => setTrackerUsed(t.value)} />
          ))}
        </div>
        {trackerUsed === "other" && (
          <input style={s.input} value={trackerName} onChange={e => setTrackerName(e.target.value)} placeholder="Название трекера" />
        )}
      </div>

      <div style={s.section}>
        <div style={s.label}>Какие данные доступны?</div>
        <div style={s.row}>
          {TRACKED_METRICS.map(m => (
            <Chip key={m.value} label={m.label} active={trackedMetrics.includes(m.value)} onClick={() => toggleArray(m.value, trackedMetrics, setTrackedMetrics)} />
          ))}
        </div>
      </div>

      <div style={s.section}>
        <div style={s.label}>Ведёте ли вы подсчёт калорий?</div>
        <div style={s.row}>
          {CALORIE_MODES.map(c => (
            <Chip key={c.value} label={c.label} active={calorieMode === c.value} onClick={() => setCalorieMode(c.value)} />
          ))}
        </div>
      </div>

      <div style={s.section}>
        <div style={s.label}>Как предпочитаете вносить данные?</div>
        <div style={s.row}>
          {DATA_ENTRY.map(d => (
            <Chip key={d.value} label={d.label} active={dataEntry === d.value} onClick={() => setDataEntry(d.value)} />
          ))}
        </div>
      </div>

      <div style={s.section}>
        <div style={s.label}>Что важнее всего отслеживать?</div>
        <div style={s.row}>
          {PRIORITY_METRICS.map(p => (
            <Chip key={p.value} label={p.label} active={priorityMetrics.includes(p.value)} onClick={() => toggleArray(p.value, priorityMetrics, setPriorityMetrics)} />
          ))}
        </div>
      </div>

      <div style={s.section}>
        <div style={s.label}>Стиль поддержки</div>
        <div style={s.row}>
          {SUPPORT_STYLES.map(st => (
            <Chip key={st.value} label={st.label} active={supportStyle === st.value} onClick={() => setSupportStyle(st.value)} />
          ))}
        </div>
      </div>

      <button onClick={saveAndComplete} disabled={loading} style={{ ...s.primary, opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
        {loading ? "Сохранение..." : "Готово"}
      </button>
      <div style={{ height: 12 }} />
      <button onClick={onComplete} style={s.secondary}>Пропустить</button>
    </div>
  );
}
