import React, { useState, useEffect } from "react";
import { getClientToken } from "./lib/clientToken.js";
import { getBodySession } from "./lib/sessionAccess.js";

export default function BodyDayView({ logDate, onEdit, onBack }) {
  const [day, setDay] = useState(null);
  const [plateHistory, setPlateHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
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
        const res = await fetch("/api/session", {
          method: "POST",
          headers: hdrs,
          body: JSON.stringify({ action: "getBodyDiaryDay", session_id: saved.sessionId, access_token: saved.accessToken, log_date: logDate }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Не удалось загрузить дневник.");
        }
        setDay(data.day);
        setPlateHistory(data.plate_history || []);
      } catch (e) {
        setError(e.message || "Ошибка загрузки.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [logDate]);

  if (loading) {
    return <div style={{ padding: 20, textAlign: "center", color: "#8a7e72" }}>Загрузка...</div>;
  }

  if (error) {
    return (
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "20px 16px" }}>
        <div style={{ color: "#b5473f", fontSize: 14, marginBottom: 12 }}>{error}</div>
        <button onClick={onBack} style={{ padding: "10px 20px", borderRadius: 12, border: "1px solid #d8cec1", background: "#fff", cursor: "pointer", fontSize: 14, color: "#5f574f" }}>
          ← Назад в кабинет
        </button>
      </div>
    );
  }

  if (!day) return null;

  const field = (label, value, unit) => {
    if (value == null || value === "") return null;
    return <div style={{ fontSize: 14, color: "#5f574f" }}><span style={{ color: "#8a7e72" }}>{label}: </span><span style={{ fontWeight: 600 }}>{value}{unit ? ` ${unit}` : ""}</span></div>;
  };

  return (
    <div style={{ maxWidth: 780, margin: "32px auto 64px", padding: "0 16px", width: "100%", boxSizing: "border-box" }}>
      <button onClick={onBack} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #d8cec1", background: "#fff", cursor: "pointer", fontSize: 13, color: "#5f574f", marginBottom: 16 }}>
        ← Назад в кабинет
      </button>

      <div style={{ fontSize: 22, fontWeight: 700, color: "#2f2925", marginBottom: 4, fontFamily: "Georgia, serif" }}>
        {new Date(day.log_date + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
      </div>

      {/* Parameters */}
      <div style={{ padding: 16, borderRadius: 12, border: "1px solid #e8e2d8", marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#2f2925", marginBottom: 10 }}>Параметры</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {field("Вес", day.weight_kg, "кг")}
          {field("Талия", day.waist_cm, "см")}
          {field("Шаги", day.steps?.toLocaleString())}
          {field("Калории", day.calories, "ккал")}
          {field("Вода", day.water_l, "л")}
          {field("Приёмы пищи", day.meals_count)}
          {field("Сон", day.sleep_hours, "ч")}
          {field("Качество сна", day.sleep_quality)}
          {field("Энергия", day.energy_level, "/10")}
          {field("Настроение", day.mood_level, "/10")}
        </div>
      </div>

      {/* Workout */}
      {day.workout_done && (
        <div style={{ padding: 16, borderRadius: 12, border: "1px solid #e8e2d8", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#2f2925", marginBottom: 8 }}>Тренировка</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {field("Тип", day.workout_type)}
            {field("Длительность", day.workout_minutes, "мин")}
            {field("Интенсивность", day.workout_intensity)}
          </div>
          {day.workout_comment && <div style={{ fontSize: 14, color: "#5f574f", marginTop: 8 }}>{day.workout_comment}</div>}
        </div>
      )}

      {/* Nutrition */}
      <div style={{ padding: 16, borderRadius: 12, border: "1px solid #e8e2d8", marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#2f2925", marginBottom: 8 }}>Питание</div>
        {field("Завтрак", day.breakfast)}
        {field("Обед", day.lunch)}
        {field("Ужин", day.dinner)}
        {field("Перекусы", day.snacks)}
        {field("Комментарий", day.nutrition_comment)}
        {field("Переедание", day.overeating_level)}
        {field("Тяга к сладкому", day.sweet_cravings)}
      </div>

      {/* Day comment */}
      {day.day_text && (
        <div style={{ padding: 16, borderRadius: 12, border: "1px solid #e8e2d8", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#2f2925", marginBottom: 8 }}>Комментарий дня</div>
          <div style={{ fontSize: 14, color: "#5f574f", lineHeight: 1.6 }}>{day.day_text}</div>
        </div>
      )}

      {/* Voice transcript */}
      {day.voice_transcript && (
        <div style={{ padding: 16, borderRadius: 12, border: "1px solid #e8e2d8", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#2f2925", marginBottom: 8 }}>Голосовая запись</div>
          <div style={{ fontSize: 14, color: "#5f574f", lineHeight: 1.6, fontStyle: "italic" }}>{day.voice_transcript}</div>
        </div>
      )}

      {/* Plate photos + analysis */}
      {day.plate_photos && day.plate_photos.length > 0 && (
        <div style={{ padding: 16, borderRadius: 12, border: "1px solid #e8e2d8", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#2f2925", marginBottom: 10 }}>Фото тарелок ({day.plate_photos.length})</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {day.plate_photos.map((photo, i) => (
              <img key={i} src={photo} alt={`Тарелка ${i + 1}`} style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8, border: "1px solid #e8e2d8" }} />
            ))}
          </div>
          {/* Use plate_history if available, fallback to plate_analysis */}
          {plateHistory && plateHistory.length > 0 ? (
            plateHistory.map((a, i) => (
              <div key={i} style={{ padding: 12, borderRadius: 10, background: "#faf6ef", marginBottom: 8, fontSize: 13 }}>
                <div style={{ fontWeight: 600, color: "#2f2925", marginBottom: 4 }}>Фото {a.photo_index + 1}</div>
                {a.balance_summary && <div style={{ color: "#5f574f" }}>{a.balance_summary}</div>}
                {a.what_is_missing && a.what_is_missing.length > 0 && (
                  <div style={{ color: "#8a7e72", marginTop: 4 }}>Чего не хватает: {a.what_is_missing.join(", ")}</div>
                )}
                {a.gentle_suggestion && <div style={{ color: "#7D9A89", marginTop: 4, fontStyle: "italic" }}>{a.gentle_suggestion}</div>}
              </div>
            ))
          ) : day.plate_analysis && day.plate_analysis.length > 0 ? (
            day.plate_analysis.map((a, i) => (
              <div key={i} style={{ padding: 12, borderRadius: 10, background: "#faf6ef", marginBottom: 8, fontSize: 13 }}>
                <div style={{ fontWeight: 600, color: "#2f2925", marginBottom: 4 }}>{a.photo_name || `Фото ${i + 1}`}</div>
                {a.error ? (
                  <div style={{ color: "#b5473f" }}>{a.error}</div>
                ) : (
                  <>
                    {a.balance_summary && <div style={{ color: "#5f574f" }}>{a.balance_summary}</div>}
                    {a.what_is_missing && a.what_is_missing.length > 0 && (
                      <div style={{ color: "#8a7e72", marginTop: 4 }}>Чего не хватает: {a.what_is_missing.join(", ")}</div>
                    )}
                    {a.gentle_suggestion && <div style={{ color: "#7D9A89", marginTop: 4, fontStyle: "italic" }}>{a.gentle_suggestion}</div>}
                  </>
                )}
              </div>
            ))
          ) : null}
        </div>
      )}

      {/* AI summary */}
      {day.ai_day_summary && (
        <div style={{ padding: 16, borderRadius: 12, background: "#f0f5f1", border: "1px solid #c4d0c6", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#2f2925", marginBottom: 8 }}>Итог дня</div>
          <div style={{ fontSize: 14, color: "#5f574f", lineHeight: 1.6, marginBottom: 8 }}>{day.ai_day_summary}</div>
          {day.ai_positive_observation && (
            <div style={{ fontSize: 13, color: "#7D9A89", marginBottom: 4 }}>🟢 {day.ai_positive_observation}</div>
          )}
          {day.ai_pattern_observation && (
            <div style={{ fontSize: 13, color: "#e8a857", marginBottom: 4 }}>📊 {day.ai_pattern_observation}</div>
          )}
          {day.ai_focus_tomorrow && (
            <div style={{ padding: 10, borderRadius: 8, background: "#fff", border: "1px solid #c4d0c6", marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#2f2925", marginBottom: 2 }}>Фокус на завтра</div>
              <div style={{ fontSize: 13, color: "#5f574f" }}>{day.ai_focus_tomorrow}</div>
            </div>
          )}
          {day.ai_question_for_user && (
            <div style={{ fontSize: 13, color: "#8a7e72", marginTop: 8, fontStyle: "italic" }}>💬 {day.ai_question_for_user}</div>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button onClick={() => onEdit(day)} style={{ flex: 1, padding: "12px 20px", borderRadius: 20, background: "#5f8b7a", color: "#fff", fontWeight: 700, border: 0, cursor: "pointer", fontSize: 14 }}>
          Редактировать
        </button>
        <button onClick={onBack} style={{ padding: "12px 20px", borderRadius: 20, background: "#ede7dc", color: "#2f2925", fontWeight: 600, border: "1px solid #d8cec1", cursor: "pointer", fontSize: 14 }}>
          В кабинет
        </button>
      </div>
    </div>
  );
}
