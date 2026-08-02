import React, { useState, useEffect } from "react";

export default function HealthCabinet({
  sessionId,
  accessToken,
  profile,
  wallet,
  todayLog,
  history,
  onNewDiary,
  onViewDiary,
  onLogout,
  onRotateCode,
}) {
  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [newCode, setNewCode] = useState(null);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleRotate() {
    setRotating(true);
    setRotateError("");
    try {
      const code = await onRotateCode();
      if (!code) throw new Error("Не удалось создать новый код");
      setNewCode(code);
      setShowRotateConfirm(false);
    } catch (e) {
      setRotateError(e.message || "Не удалось создать новый код продолжения");
    } finally {
      setRotating(false);
    }
  }

  function copyCode() {
    if (newCode) {
      navigator.clipboard.writeText(newCode).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  const bmi = profile?.height_cm && profile?.weight_kg
    ? (profile.weight_kg / ((profile.height_cm / 100) ** 2)).toFixed(1)
    : null;

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "20px 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#2f2925" }}>Личный кабинет</div>
          <div style={{ fontSize: 13, color: "#8a7e72" }}>Опора. Здоровье & Стройность</div>
        </div>
        <button onClick={onLogout} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #d8cec1", background: "#fff", cursor: "pointer", fontSize: 13, color: "#5f574f" }}>
          Выйти
        </button>
      </div>

      {/* Wallet */}
      {wallet && (
        <div style={{ padding: "12px 16px", borderRadius: 12, background: "#f5f0e8", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#5f574f" }}>Баланс кредитов</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#2f2925" }}>{wallet.balance?.toLocaleString()}</span>
        </div>
      )}

      {/* Today Card */}
      <div style={{ padding: "16px", borderRadius: 12, border: "1px solid #e8e0d4", marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#2f2925", marginBottom: 12 }}>
          Сегодня: {new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
        </div>

        {todayLog ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13, color: "#5f574f", marginBottom: 12 }}>
            {todayLog.weight_kg && <div>Вес: {todayLog.weight_kg} кг</div>}
            {todayLog.steps && <div>Шаги: {todayLog.steps}</div>}
            {todayLog.workout_done !== undefined && <div>Тренировка: {todayLog.workout_done ? "да" : "нет"}</div>}
            {todayLog.energy_level && <div>Энергия: {todayLog.energy_level}/10</div>}
            {todayLog.mood_level && <div>Настроение: {todayLog.mood_level}/10</div>}
            {todayLog.meals_count && <div>Приёмы пищи: {todayLog.meals_count}</div>}
            {todayLog.plate_photos?.length > 0 && <div>Фото: {todayLog.plate_photos.length}</div>}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#8a7e72", marginBottom: 12 }}>Дневник ещё не заполнен</div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onNewDiary} style={{ flex: 1, padding: "10px 16px", borderRadius: 10, border: "1px solid #7D9A89", background: "#7D9A89", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
            {todayLog ? "Изменить запись" : "Заполнить дневник"}
          </button>
          {todayLog && (
            <button onClick={() => onViewDiary(todayLog)} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #d8cec1", background: "#fff", cursor: "pointer", fontSize: 14, color: "#2f2925" }}>
              Итог дня
            </button>
          )}
        </div>
      </div>

      {/* Profile Summary */}
      <div style={{ padding: "16px", borderRadius: 12, border: "1px solid #e8e0d4", marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#2f2925", marginBottom: 8 }}>Профиль</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13, color: "#5f574f" }}>
          {profile?.age && <div>Возраст: {profile.age}</div>}
          {profile?.gender && <div>Пол: {profile.gender === "male" ? "М" : "Ж"}</div>}
          {profile?.height_cm && <div>Рост: {profile.height_cm} см</div>}
          {profile?.weight_kg && <div>Вес: {profile.weight_kg} кг</div>}
          {profile?.target_weight_kg && <div>Цель: {profile.target_weight_kg} кг</div>}
          {bmi && <div>ИМТ: {bmi}</div>}
          {profile?.activity_level && <div>Активность: {profile.activity_level}</div>}
        </div>
      </div>

      {/* History */}
      {history && history.length > 0 && (
        <div style={{ padding: "16px", borderRadius: 12, border: "1px solid #e8e0d4", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#2f2925", marginBottom: 12 }}>История</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.slice(0, 7).map((day) => (
              <div key={day.date} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 8, background: "#faf6ef", fontSize: 13 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{new Date(day.date + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</span>
                  {day.weight_kg && <span style={{ color: "#5f574f", marginLeft: 8 }}>{day.weight_kg} кг</span>}
                  {day.has_photos && <span style={{ marginLeft: 4 }}>📷</span>}
                </div>
                <button onClick={() => onViewDiary(day)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d8cec1", background: "#fff", cursor: "pointer", fontSize: 12, color: "#5f574f" }}>
                  Открыть
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Access */}
      <div style={{ padding: "16px", borderRadius: 12, border: "1px solid #e8e0d4", marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#2f2925", marginBottom: 8 }}>Доступ</div>

        {newCode ? (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#5f574f", marginBottom: 8 }}>Новый код (показан один раз):</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code style={{ flex: 1, padding: "8px 12px", borderRadius: 8, background: "#f5f0e8", fontSize: 14, fontWeight: 600, wordBreak: "break-all" }}>{newCode}</code>
              <button onClick={copyCode} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #7D9A89", background: copied ? "#7D9A89" : "#fff", color: copied ? "#fff" : "#7D9A89", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                {copied ? "✓ Скопировано" : "Копировать"}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowRotateConfirm(true)} disabled={rotating} style={{ width: "100%", padding: "10px 16px", borderRadius: 10, border: "1px solid #d8cec1", background: "#fff", cursor: "pointer", fontSize: 14, color: "#2f2925" }}>
            {rotating ? "Создаём..." : "Создать новый код продолжения"}
          </button>
        )}

        {showRotateConfirm && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "#fdf6ee", border: "1px solid #e8d5b8" }}>
            <div style={{ fontSize: 13, color: "#5f574f", marginBottom: 8 }}>Старый код перестанет работать. Новый код будет показан один раз.</div>
            {rotateError && (
              <div style={{ fontSize: 13, color: "#b5473f", marginBottom: 8 }}>{rotateError}</div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleRotate} disabled={rotating} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #7D9A89", background: "#7D9A89", color: "#fff", cursor: rotating ? "not-allowed" : "pointer", fontSize: 13, opacity: rotating ? 0.6 : 1 }}>
                {rotating ? "Создаём..." : "Да, создать"}
              </button>
              <button onClick={() => { setShowRotateConfirm(false); setRotateError(""); }} disabled={rotating} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #d8cec1", background: "#fff", cursor: rotating ? "not-allowed" : "pointer", fontSize: 13, color: "#5f574f" }}>
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
