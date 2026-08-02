import React, { useState, useRef, useEffect, useCallback } from "react";
import { getClientToken } from "./lib/clientToken.js";
import { withAccessToken, getBodySession } from "./lib/sessionAccess.js";

function getLocalDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const OVER_EATING = [
  { value: "none", label: "Нет" },
  { value: "slight", label: "Немного" },
  { value: "severe", label: "Да, выраженно" },
];

const CRAVINGS = [
  { value: "none", label: "Нет" },
  { value: "moderate", label: "Умеренная" },
  { value: "strong", label: "Сильная" },
];

const SLEEP_QUALITY = [
  { value: "good", label: "Хорошее" },
  { value: "fair", label: "Среднее" },
  { value: "poor", label: "Плохое" },
];

const WORKOUT_TYPES = [
  { value: "strength", label: "Силовая" },
  { value: "cardio", label: "Кардио" },
  { value: "walking", label: "Ходьба" },
  { value: "mobility", label: "Растяжка / мобилити" },
  { value: "functional", label: "Функциональная" },
  { value: "other", label: "Другое" },
];

const WORKOUT_INTENSITY = [
  { value: "light", label: "Легко" },
  { value: "moderate", label: "Средне" },
  { value: "heavy", label: "Тяжело" },
];

const s = {
  form: { maxWidth: 680, margin: "0 auto", padding: "0 24px 60px", width: "100%", boxSizing: "border-box" },
  heading: { fontSize: 28, fontWeight: 800, marginBottom: 8, letterSpacing: "-0.03em", color: "#2f2925" },
  subheading: { color: "#665c52", fontSize: 15, lineHeight: 1.5, marginBottom: 28 },
  section: { marginBottom: 28, padding: 20, borderRadius: 16, background: "#faf6ef", border: "1px solid #e8e2d8" },
  sectionTitle: { fontSize: 17, fontWeight: 700, color: "#2f2925", marginBottom: 16 },
  field: { marginBottom: 16 },
  label: { display: "block", color: "#5f574f", fontSize: 14, fontWeight: 600, marginBottom: 5 },
  optional: { color: "#8d8378", fontWeight: 400, fontSize: 12 },
  input: { width: "100%", height: 44, padding: "0 14px", borderRadius: 12, border: "1px solid #d8cec1", background: "#ffffff", color: "#2f2925", fontSize: 15, outline: "none", fontFamily: "inherit", boxSizing: "border-box" },
  select: { width: "100%", height: 44, padding: "0 14px", borderRadius: 12, border: "1px solid #d8cec1", background: "#ffffff", color: "#2f2925", fontSize: 15, outline: "none", boxSizing: "border-box" },
  textarea: { width: "100%", minHeight: 80, padding: 12, borderRadius: 12, border: "1px solid #d8cec1", background: "#ffffff", color: "#2f2925", fontSize: 15, outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" },
  error: { color: "#b5473f", fontSize: 13, marginTop: 4 },
  button: { width: "100%", height: 50, borderRadius: 20, background: "#7D9A89", color: "#ffffff", fontWeight: 800, fontSize: 16, border: 0, cursor: "pointer", marginTop: 8 },
  buttonDisabled: { width: "100%", height: 50, borderRadius: 20, background: "#c4d0c6", color: "#ffffff", fontWeight: 800, fontSize: 16, border: 0, cursor: "not-allowed", marginTop: 8 },
  row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  row3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 },
  chip: { padding: "8px 14px", borderRadius: 10, border: "1px solid #d8cec1", background: "#ffffff", cursor: "pointer", fontSize: 14, color: "#5f574f", textAlign: "center" },
  chipActive: { padding: "8px 14px", borderRadius: 10, border: "1px solid #86a08f", background: "#e8f0ea", cursor: "pointer", fontSize: 14, color: "#2f2925", fontWeight: 600, textAlign: "center" },
  tinyBtn: { padding: "8px 16px", borderRadius: 10, border: 0, background: "#ede7dc", color: "#5f574f", fontWeight: 600, fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 },
  tinyBtnPrimary: { padding: "8px 16px", borderRadius: 10, border: 0, background: "#7D9A89", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 },
};

function num(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

export default function BodyDiary({ sessionId, onComplete, onCancel }) {
  const today = getLocalDateString();
  const [logDate, setLogDate] = useState(today);
  const [weightKg, setWeightKg] = useState("");
  const [waistCm, setWaistCm] = useState("");
  const [steps, setSteps] = useState("");
  const [activityComment, setActivityComment] = useState("");
  const [workoutDone, setWorkoutDone] = useState(false);
  const [workoutType, setWorkoutType] = useState("");
  const [workoutMinutes, setWorkoutMinutes] = useState("");
  const [workoutIntensity, setWorkoutIntensity] = useState("");
  const [workoutComment, setWorkoutComment] = useState("");
  const [calories, setCalories] = useState("");
  const [mealsCount, setMealsCount] = useState("");
  const [breakfast, setBreakfast] = useState("");
  const [lunch, setLunch] = useState("");
  const [dinner, setDinner] = useState("");
  const [snacks, setSnacks] = useState("");
  const [nutritionComment, setNutritionComment] = useState("");
  const [overeatingLevel, setOvereatingLevel] = useState("");
  const [sweetCravings, setSweetCravings] = useState("");
  const [waterL, setWaterL] = useState("");
  const [waterGlassesDone, setWaterGlassesDone] = useState(0);
  const [waterGoalGlasses, setWaterGoalGlasses] = useState(5);
  const [sleepHours, setSleepHours] = useState("");
  const [sleepQuality, setSleepQuality] = useState("");
  const [energyLevel, setEnergyLevel] = useState(5);
  const [moodLevel, setMoodLevel] = useState(5);
  const [dayText, setDayText] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [photos, setPhotos] = useState([]); // array of { dataUrl, name }
  const [plateAnalysis, setPlateAnalysis] = useState([]);
  const [plateAnalysisLoading, setPlateAnalysisLoading] = useState(false);
  const [plateAnalysisError, setPlateAnalysisError] = useState("");
  const [heicWarning, setHeicWarning] = useState("");
  const plateAnalysisRequestRef = useRef(null);
  const [usageBalance, setUsageBalance] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Voice recording
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    fetch("/api/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withAccessToken({ action: "getUsageBalance", sessionId, module: "body" }, sessionId)),
    })
      .then(r => r.json())
      .then(data => {
        if (data.visible) setUsageBalance(data);
      })
      .catch(() => {});
  }, [sessionId]);

  const startRecording = useCallback(async () => {
    setSubmitError("");

    const saved = getBodySession();
    if (saved.sessionId !== sessionId || !saved.accessToken) {
      setSubmitError("Сессия истекла. Войдите снова по коду продолжения.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (blob.size < 100) return;
        try {
          let token;
          try { token = await getClientToken("body", "transcribe"); } catch {}
          const tHeaders = {
            "Content-Type": "audio/webm",
            "X-Session-Id": sessionId,
            "X-Module": "body",
            "X-Access-Token": saved.accessToken,
          };
          if (token) tHeaders["Authorization"] = `Bearer ${token}`;

          let res = await fetch("/api/transcribe", {
            method: "POST",
            headers: tHeaders,
            body: blob,
          });

          if (res.status === 401 && token) {
            try { token = await getClientToken("body", "transcribe"); } catch {}
            tHeaders["Authorization"] = `Bearer ${token}`;
            res = await fetch("/api/transcribe", {
              method: "POST",
              headers: tHeaders,
              body: blob,
            });
          }

          let data;
          const text = await res.text();
          try { data = JSON.parse(text); } catch { data = null; }
          if (!res.ok || !data || !data.text) {
            if (res.status === 403) {
              setSubmitError("Сессия истекла. Войдите снова по коду продолжения.");
            } else {
              setSubmitError("Не удалось расшифровать запись. Можно написать день текстом.");
            }
            return;
          }
          setVoiceTranscript(data.text);
          setDayText(prev => prev ? prev + "\n" + data.text : data.text);
        } catch (e) {
          console.error("Transcription error:", e);
          setSubmitError("Не удалось расшифровать запись. Можно написать день текстом.");
        }
      };
      mr.start();
      setRecording(true);
      let sec = 0;
      timerRef.current = setInterval(() => { sec++; setRecordingTime(sec); }, 1000);
    } catch (e) {
      console.error("Mic error:", e);
    }
  }, [sessionId]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    setRecordingTime(0);
  }, []);

  function handlePhotoUpload(e) {
    setPlateAnalysis([]);
    setHeicWarning("");
    const files = Array.from(e.target.files || []);
    const heicFiles = files.filter(f => /\.(heic|heif)$/i.test(f.name));
    if (heicFiles.length > 0) {
      setHeicWarning("Формат HEIC пока не поддерживается. Сохраните фотографию в формате JPG, PNG или WebP и загрузите ещё раз.");
    }
    const supportedFiles = files.filter(f => !/\.(heic|heif)$/i.test(f.name));
    const remaining = 6 - photos.length;
    const toAdd = supportedFiles.slice(0, remaining);
    toAdd.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        // Compress: resize if too large
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          const maxDim = 1200;
          if (w > maxDim || h > maxDim) {
            const ratio = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
          setPhotos(prev => [...prev, { dataUrl, name: file.name }]);
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }

  function removePhoto(idx) {
    setPhotos(prev => prev.filter((_, i) => i !== idx));
    setPlateAnalysis([]);
  }

  async function analyzePlatePhotos() {
    const requestId = `plate-${Date.now()}`;
    plateAnalysisRequestRef.current = requestId;
    setPlateAnalysisLoading(true);
    setPlateAnalysisError("");
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
          stage: "plate_photo_analysis",
          session_id: sessionId,
          photos: photos.map(p => p.dataUrl),
          request_id: requestId,
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
            stage: "plate_photo_analysis",
            session_id: sessionId,
            photos: photos.map(p => p.dataUrl),
            request_id: requestId,
          }),
        });
      }

      if (plateAnalysisRequestRef.current !== requestId) return;

      const data = await res.json();
      if (data.ok && Array.isArray(data.results)) {
        const hasAnySuccess = data.results.some(r => !r.error);
        if (hasAnySuccess) {
          setPlateAnalysis(data.results);
        } else {
          const firstError = data.results.find(r => r.error);
          setPlateAnalysisError(firstError?.error || "Не удалось проанализировать фото.");
        }
      } else if (res.status === 402) {
        setPlateAnalysisError("Недостаточно средств для анализа.");
      } else if (res.status === 401) {
        setPlateAnalysisError("Сессия истекла. Войдите снова по коду продолжения.");
      } else {
        setPlateAnalysisError("Не удалось проанализировать фото.");
      }
    } catch {
      if (plateAnalysisRequestRef.current !== requestId) return;
      setPlateAnalysisError("Ошибка при анализе фото. Попробуйте ещё раз.");
    } finally {
      if (plateAnalysisRequestRef.current === requestId) {
        setPlateAnalysisLoading(false);
      }
    }
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    setSubmitting(true);

    const log = {
      log_date: logDate,
      weight_kg: num(weightKg),
      waist_cm: num(waistCm),
      steps: num(steps),
      activity_comment: activityComment || null,
      workout_done: workoutDone,
      workout_type: workoutDone ? workoutType || null : null,
      workout_minutes: workoutDone ? num(workoutMinutes) : null,
      workout_intensity: workoutDone ? workoutIntensity || null : null,
      workout_comment: workoutDone ? workoutComment || null : null,
      calories: num(calories),
      meals_count: num(mealsCount),
      breakfast: breakfast || null,
      lunch: lunch || null,
      dinner: dinner || null,
      snacks: snacks || null,
      nutrition_comment: nutritionComment || null,
      overeating_level: overeatingLevel || null,
      sweet_cravings: sweetCravings || null,
      water_l: num(waterL),
      sleep_hours: num(sleepHours),
      sleep_quality: sleepQuality || null,
      energy_level: energyLevel,
      mood_level: moodLevel,
      day_text: dayText || null,
      voice_transcript: voiceTranscript || null,
      plate_photos: photos.length > 0 ? photos.map(p => p.dataUrl) : null,
      plate_analysis: plateAnalysis.length > 0 ? plateAnalysis : null,
    };

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
          stage: "daily_log_submitted",
          session_id: sessionId,
          daily_log: log,
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
            stage: "daily_log_submitted",
            session_id: sessionId,
            daily_log: log,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok || !data.ok || data.saved !== true) {
        setSubmitError(
          data.error || "Не удалось сохранить дневник. Попробуйте ещё раз."
        );
        setSubmitting(false);
        return;
      }
      onComplete(data);
    } catch (err) {
      console.error("Diary submit error:", err);
      setSubmitError("Не удалось сохранить дневник. Попробуйте ещё раз.");
      setSubmitting(false);
    }
  }

  function chip(label, value, current, setter) {
    return (
      <div
        onClick={() => setter(current === value ? "" : value)}
        style={current === value ? s.chipActive : s.chip}
      >
        {label}
      </div>
    );
  }

  return (
    <form data-body-diary onSubmit={handleSubmit} style={s.form}>
      <style>{`
        form[data-body-diary] input:focus,
        form[data-body-diary] select:focus,
        form[data-body-diary] textarea:focus {
          border-color: #86a08f !important;
          box-shadow: 0 0 0 3px rgba(134,160,143,.18) !important;
        }
        form[data-body-diary] input::placeholder,
        form[data-body-diary] textarea::placeholder {
          color: #8d8378 !important;
        }
        @media (max-width: 640px) {
          form[data-body-diary] {
            max-width: 100% !important;
            padding-left: 20px !important;
            padding-right: 20px !important;
          }
        }
      `}</style>

      {usageBalance && usageBalance.visible && (
        <div style={{ padding: "8px 12px", background: "#f0fdf4", borderRadius: 8, marginBottom: 12, fontSize: 13, color: "#166534" }}>
          Доступный ресурс: {usageBalance.balance.toLocaleString("ru-RU")} кредитов<br />
          <span style={{ fontSize: 11, color: "#6b7280" }}>Тестовый баланс. Деньги не списываются.</span>
        </div>
      )}

      <h2 style={s.heading}>Дневник дня</h2>
      <p style={s.subheading}>Отметьте, как прошёл день. Не нужно идеально — нам важна честная картина.</p>

      {/* Date + body measurements */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Дата и измерения</div>
        <div style={s.row2}>
          <div style={s.field}>
            <label style={s.label}>Дата</label>
            <input style={s.input} type="date" value={logDate} onChange={e => setLogDate(e.target.value)} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Вес, кг <span style={s.optional}>(необязательно)</span></label>
            <input style={s.input} type="number" step="0.1" placeholder="—" value={weightKg} onChange={e => setWeightKg(e.target.value)} />
          </div>
        </div>
        <div style={s.field}>
          <label style={s.label}>Талия, см <span style={s.optional}>(необязательно)</span></label>
          <input style={s.input} type="number" step="0.5" placeholder="—" value={waistCm} onChange={e => setWaistCm(e.target.value)} />
        </div>
      </div>

      {/* Activity */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Активность</div>
        <div style={s.field}>
          <label style={s.label}>Шаги</label>
          <input style={s.input} type="number" placeholder="Например: 7000" value={steps} onChange={e => setSteps(e.target.value)} />
        </div>
        <div style={s.field}>
          <label style={s.label}>Комментарий по активности <span style={s.optional}>(необязательно)</span></label>
          <textarea style={s.textarea} placeholder="Была ли ходьба, движение в течение дня..." value={activityComment} onChange={e => setActivityComment(e.target.value)} />
        </div>
      </div>

      {/* Workout */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Тренировка</div>
        <div role="radiogroup" aria-label="Тренировка" style={{ display: "flex", gap: 0, marginBottom: workoutDone ? 16 : 0, borderRadius: 12, overflow: "hidden", border: "1px solid #d8cec1" }}>
          <button
            type="button"
            role="radio"
            aria-checked={workoutDone}
            onClick={() => { setWorkoutDone(true); }}
            style={{
              flex: 1, padding: "10px 16px", border: 0, cursor: "pointer", fontSize: 14, fontWeight: 600,
              background: workoutDone ? "#7D9A89" : "#f5f0e8",
              color: workoutDone ? "#fff" : "#5f574f",
              transition: "all 0.15s ease",
            }}
          >
            {workoutDone && <span style={{ marginRight: 6 }}>✓</span>}
            Была тренировка
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!workoutDone}
            onClick={() => { setWorkoutDone(false); setWorkoutType(""); setWorkoutMinutes(""); setWorkoutIntensity(""); setWorkoutComment(""); }}
            style={{
              flex: 1, padding: "10px 16px", border: 0, borderLeft: "1px solid #d8cec1", cursor: "pointer", fontSize: 14, fontWeight: 600,
              background: !workoutDone ? "#7D9A89" : "#f5f0e8",
              color: !workoutDone ? "#fff" : "#5f574f",
              transition: "all 0.15s ease",
            }}
          >
            {!workoutDone && <span style={{ marginRight: 6 }}>✓</span>}
            Тренировки не было
          </button>
        </div>
        {workoutDone && (
          <>
            <div style={s.field}>
              <label style={s.label}>Тип тренировки</label>
              <select style={s.select} value={workoutType} onChange={e => setWorkoutType(e.target.value)}>
                <option value="" disabled>Выберите...</option>
                {WORKOUT_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div style={s.row2}>
              <div style={s.field}>
                <label style={s.label}>Длительность, минут</label>
                <input style={s.input} type="number" placeholder="30" value={workoutMinutes} onChange={e => setWorkoutMinutes(e.target.value)} />
              </div>
              <div style={s.field}>
                <label style={s.label}>Интенсивность</label>
                <select style={s.select} value={workoutIntensity} onChange={e => setWorkoutIntensity(e.target.value)}>
                  <option value="" disabled>Выберите...</option>
                  {WORKOUT_INTENSITY.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div style={s.field}>
              <label style={s.label}>Комментарий <span style={s.optional}>(необязательно)</span></label>
              <textarea style={s.textarea} placeholder="Самочувствие во время тренировки, что делали..." value={workoutComment} onChange={e => setWorkoutComment(e.target.value)} />
            </div>
          </>
        )}
      </div>

      {/* Nutrition */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Питание</div>
        <div style={{ fontSize: 13, color: "#8d8378", marginBottom: 14, lineHeight: 1.5 }}>
          Если калории не считали — ничего страшного. Просто кратко опишите еду.
        </div>
        <div style={s.row2}>
          <div style={s.field}>
            <label style={s.label}>Калории <span style={s.optional}>(необязательно)</span></label>
            <input style={s.input} type="number" placeholder="—" value={calories} onChange={e => setCalories(e.target.value)} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Кол-во приёмов пищи</label>
            <input style={s.input} type="number" min="1" max="10" placeholder="3" value={mealsCount} onChange={e => setMealsCount(e.target.value)} />
          </div>
        </div>
        <div style={s.field}>
          <label style={s.label}>Завтрак</label>
          <input style={s.input} placeholder="Что ели на завтрак" value={breakfast} onChange={e => setBreakfast(e.target.value)} />
        </div>
        <div style={s.field}>
          <label style={s.label}>Обед</label>
          <input style={s.input} placeholder="Что ели на обед" value={lunch} onChange={e => setLunch(e.target.value)} />
        </div>
        <div style={s.field}>
          <label style={s.label}>Ужин</label>
          <input style={s.input} placeholder="Что ели на ужин" value={dinner} onChange={e => setDinner(e.target.value)} />
        </div>
        <div style={s.field}>
          <label style={s.label}>Перекусы</label>
          <input style={s.input} placeholder="Что было между приёмами" value={snacks} onChange={e => setSnacks(e.target.value)} />
        </div>
        <div style={s.field}>
          <label style={s.label}>Комментарий по питанию</label>
          <textarea style={s.textarea} placeholder="Было ли что-то необычное, сложности..." value={nutritionComment} onChange={e => setNutritionComment(e.target.value)} />
        </div>
      </div>

      {/* Overeating / cravings */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Переедание и тяга</div>
        <div style={{ marginBottom: 14 }}>
          <label style={s.label}>Было ли переедание?</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {OVER_EATING.map(o => chip(o.label, o.value, overeatingLevel, setOvereatingLevel))}
          </div>
        </div>
        <div>
          <label style={s.label}>Тяга к сладкому / мучному</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {CRAVINGS.map(o => chip(o.label, o.value, sweetCravings, setSweetCravings))}
          </div>
        </div>
      </div>

      {/* Water + Sleep */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Сон и вода</div>
        <div style={s.row2}>
          <div style={s.field}>
            <label style={s.label}>Вода, литры</label>
            <input style={s.input} type="number" step="0.1" placeholder="1.5" value={waterL} onChange={e => setWaterL(e.target.value)} />
            <div style={{ marginTop: 10 }}>
              <label style={{ ...s.label, fontSize: 13, marginBottom: 6 }}>Стаканы воды сегодня ({waterGlassesDone}/{waterGoalGlasses})</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {Array.from({ length: waterGoalGlasses }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setWaterGlassesDone(i < waterGlassesDone ? i : i + 1)}
                    style={{
                      width: 40, height: 40, borderRadius: 10,
                      border: i < waterGlassesDone ? "2px solid #7D9A89" : "2px solid #d8cec1",
                      background: i < waterGlassesDone ? "#e8f0ea" : "#ffffff",
                      color: i < waterGlassesDone ? "#7D9A89" : "#8d8378",
                      fontSize: 18, cursor: "pointer", display: "flex",
                      alignItems: "center", justifyContent: "center",
                      transition: "all .15s",
                    }}
                    title={i < waterGlassesDone ? "Убрать стакан" : "Выпить стакан"}
                  >
                    🥤
                  </button>
                ))}
              </div>
              {waterGlassesDone >= waterGoalGlasses && (
                <div style={{ fontSize: 13, color: "#7D9A89", marginTop: 6, fontWeight: 600 }}>
                  ✓ Отлично, питьевой режим сегодня закрыт.
                </div>
              )}
              {waterGlassesDone > 0 && waterGlassesDone < waterGoalGlasses && (
                <div style={{ fontSize: 12, color: "#8d8378", marginTop: 4 }}>
                  До цели ещё {waterGoalGlasses - waterGlassesDone} {waterGoalGlasses - waterGlassesDone === 1 ? "стакан" : "стакана"}
                </div>
              )}
            </div>
          </div>
          <div style={s.field}>
            <label style={s.label}>Сон, часов</label>
            <input style={s.input} type="number" step="0.5" placeholder="7" value={sleepHours} onChange={e => setSleepHours(e.target.value)} />
          </div>
        </div>
        <div style={s.field}>
          <label style={s.label}>Качество сна</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {SLEEP_QUALITY.map(o => chip(o.label, o.value, sleepQuality, setSleepQuality))}
          </div>
        </div>
      </div>

      {/* Energy + Mood */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Самочувствие</div>
        <div style={s.row2}>
          <div style={s.field}>
            <label style={s.label}>Энергия: {energyLevel}/10</label>
            <input style={{ width: "100%", accentColor: "#86a08f" }} type="range" min="1" max="10" value={energyLevel} onChange={e => setEnergyLevel(Number(e.target.value))} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Настроение: {moodLevel}/10</label>
            <input style={{ width: "100%", accentColor: "#86a08f" }} type="range" min="1" max="10" value={moodLevel} onChange={e => setMoodLevel(Number(e.target.value))} />
          </div>
        </div>
      </div>

      {/* Day comment + Voice */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Комментарий дня</div>
        <div style={s.field}>
          <textarea style={s.textarea} placeholder="Коротко опишите день: что получилось, что помешало, где было сложнее всего..." value={dayText} onChange={e => setDayText(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          {!recording ? (
            <button type="button" onClick={startRecording} style={s.tinyBtnPrimary}>
              🎙 Продиктовать день
            </button>
          ) : (
            <button type="button" onClick={stopRecording} style={{ ...s.tinyBtnPrimary, background: "#b5473f" }}>
              ⏹ Стоп ({formatTime(recordingTime)})
            </button>
          )}
          {voiceTranscript && (
            <span style={{ fontSize: 12, color: "#86a08f" }}>✓ расшифровка добавлена</span>
          )}
        </div>
      </div>

      {/* Photos */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Фото тарелок</div>
        <div style={{ fontSize: 13, color: "#8d8378", marginBottom: 14, lineHeight: 1.5 }}>
          Сфотографируйте тарелку, чтобы увидеть примерный состав блюда. Это не точный расчёт калорий.
        </div>
        {photos.length > 0 && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            {photos.map((p, i) => (
              <div key={i} style={{ position: "relative", width: 100, height: 100, borderRadius: 12, overflow: "hidden", border: "1px solid #d8cec1" }}>
                <img src={p.dataUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <button type="button" onClick={() => removePhoto(i)} style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,.5)", color: "#fff", border: 0, borderRadius: "50%", width: 22, height: 22, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {photos.length < 6 && (
            <label style={{ display: "inline-flex", padding: "10px 18px", borderRadius: 12, border: "1px dashed #d8cec1", background: "#faf6ef", cursor: "pointer", fontSize: 14, color: "#5f574f" }}>
              📷 Добавить фото ({photos.length}/6)
              <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handlePhotoUpload} />
            </label>
          )}
          {photos.length > 0 && !plateAnalysisLoading && plateAnalysis.length === 0 && (
            <button type="button" onClick={analyzePlatePhotos} style={{
              padding: "10px 18px", borderRadius: 12, border: "1px solid #d8cec1",
              background: "#ffffff", cursor: "pointer", fontSize: 14, color: "#2f2925",
              fontWeight: 600, fontFamily: "inherit",
            }}>
              🔍 Проанализировать тарелку
            </button>
          )}
          {photos.length > 0 && plateAnalysis.length > 0 && !plateAnalysisLoading && (
            <button type="button" onClick={analyzePlatePhotos} style={{
              padding: "10px 18px", borderRadius: 12, border: "1px solid #d8cec1",
              background: "#ffffff", cursor: "pointer", fontSize: 14, color: "#2f2925",
              fontWeight: 600, fontFamily: "inherit",
            }}>
              🔍 Анализировать заново
            </button>
          )}
        </div>
        {plateAnalysisLoading && (
          <div style={{ fontSize: 14, color: "#7D9A89", marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-block", width: 16, height: 16, border: "2px solid #7D9A89", borderRadius: "50%", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
            Анализируем фотографию…
          </div>
        )}
        {plateAnalysisError && (
          <div style={{ color: "#b5473f", fontSize: 13, marginTop: 10 }}>
            {plateAnalysisError}
          </div>
        )}
        {heicWarning && (
          <div style={{ color: "#b5473f", fontSize: 13, marginTop: 10 }}>
            {heicWarning}
          </div>
        )}
        {plateAnalysis.length > 0 && (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
            {plateAnalysis.map((a, i) => (
              <div key={i} style={{ padding: 14, borderRadius: 12, background: "#ffffff", border: "1px solid #e8e2d8", fontSize: 14, lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, color: "#2f2925", marginBottom: 8 }}>{a.photo_name || `Фото ${i + 1}`}</div>
                {a.error ? (
                  <div style={{ color: "#b5473f" }}>{a.error}</div>
                ) : (
                  <>
                    {a.balance_summary && <div style={{ color: "#2f2925", marginBottom: 6 }}>{a.balance_summary}</div>}
                    {a.what_is_missing && (
                      <div style={{ color: "#5f574f", marginBottom: 6 }}>
                        Чего не хватает: {Array.isArray(a.what_is_missing) ? a.what_is_missing.join(", ") : a.what_is_missing}
                      </div>
                    )}
                    {a.gentle_suggestion && <div style={{ color: "#7D9A89", fontStyle: "italic", marginBottom: 8 }}>{a.gentle_suggestion}</div>}
                    {a.confidence && typeof a.confidence === "number" && (
                      <div style={{ color: "#8d8378", fontSize: 11, marginTop: 6 }}>
                        Точность оценки: {Math.round(a.confidence * 100)}%
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            <div style={{ fontSize: 11, color: "#8d8378", lineHeight: 1.4 }}>
              ⓘ Это примерная оценка по фото, не точный расчёт калорий и не диетическая рекомендация.
            </div>
          </div>
        )}
      </div>

      {submitError && (
        <div style={{ color: "#b5473f", fontSize: 14, marginTop: 12, lineHeight: 1.5 }}>
          {submitError}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        {onCancel && (
          <button type="button" onClick={onCancel} style={{
            flex: 1, height: 50, borderRadius: 20, background: "#ede7dc",
            color: "#2f2925", fontWeight: 700, fontSize: 16, border: "1px solid #d8cec1", cursor: "pointer",
          }}>
            Отмена
          </button>
        )}
        <button type="submit" disabled={submitting} style={submitting ? { ...s.buttonDisabled, flex: onCancel ? 1 : undefined } : { ...s.button, flex: onCancel ? 1 : undefined }}>
          {submitting ? "Сохраняем…" : "Сохранить дневник"}
        </button>
      </div>
    </form>
  );
}
