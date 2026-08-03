import React, { useState, useMemo, useEffect } from "react";
import { getClientToken } from "./lib/clientToken.js";

const ACTIVITY_LABELS = {
  sedentary: "Малоподвижный",
  light: "Низкая активность",
  moderate: "Средняя активность",
  active: "Высокая активность",
  very_active: "Очень высокая активность",
};

const GENDER_LABELS = { male: "Мужской", female: "Женский" };

const SLEEP_QUALITY_LABELS = {
  good: "Хорошее",
  fair: "Среднее",
  poor: "Плохое",
};

function avg(arr, key) {
  const vals = arr.filter(l => l[key] != null && l[key] !== 0).map(l => Number(l[key]));
  return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

function deltaStr(current, initial) {
  if (current == null || initial == null) return "";
  const d = current - initial;
  if (d === 0) return "±0";
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}`;
}

function MiniLineChart({ data, dataKey, width = 280, height = 100, color = "#7D9A89", label }) {
  const values = data
    .filter(l => l[dataKey] != null)
    .map(l => ({ date: l.date, value: Number(l[dataKey]) }));

  if (values.length < 2) {
    return (
      <div style={{ padding: "16px 0", color: "#8a7e72", fontSize: 13 }}>
        Добавьте ещё одну запись, чтобы увидеть динамику{label ? ` (${label})` : ""}.
      </div>
    );
  }

  const min = Math.min(...values.map(v => v.value));
  const max = Math.max(...values.map(v => v.value));
  const range = max - min || 1;
  const padY = 10;
  const padX = 4;
  const w = width - padX * 2;
  const h = height - padY * 2;

  const points = values.map((v, i) => {
    const x = padX + (i / (values.length - 1)) * w;
    const y = padY + (1 - (v.value - min) / range) * h;
    return { x, y, ...v };
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} />
      ))}
    </svg>
  );
}

function MiniBarChart({ data, dataKey, width = 280, height = 80, color = "#7D9A89", marks, markLabel }) {
  const values = data
    .filter(l => l[dataKey] != null)
    .map(l => ({ date: l.date, value: Number(l[dataKey]), mark: marks ? marks[l.date] : false }));

  if (values.length < 1) {
    return (
      <div style={{ padding: "16px 0", color: "#8a7e72", fontSize: 13 }}>
        Нет данных{markLabel ? ` по ${markLabel}` : ""}.
      </div>
    );
  }

  const max = Math.max(...values.map(v => v.value), 1);
  const padY = 8;
  const padX = 4;
  const w = width - padX * 2;
  const h = height - padY * 2 - 12;
  const barW = Math.max(2, Math.min(12, (w / values.length) * 0.7));
  const gap = (w - barW * values.length) / (values.length + 1);

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
      {values.map((v, i) => {
        const x = padX + gap + i * (barW + gap);
        const barH = (v.value / max) * h;
        const y = padY + h - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} fill={color} rx="2" />
            {v.mark && (
              <circle cx={x + barW / 2} cy={padY + h + 10} r="3" fill="#e8a857" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

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
  const [historyDays, setHistoryDays] = useState(30);
  const [chartDays, setChartDays] = useState(30);
  const [accessOpen, setAccessOpen] = useState(false);
  const [plateHistory, setPlateHistory] = useState(null);
  const [plateHistoryDays, setPlateHistoryDays] = useState(7);

  // Fetch plate history on mount and when period changes
  useEffect(() => {
    async function loadPlateHistory() {
      try {
        let token;
        try { token = await getClientToken("body", "session"); } catch {}
        const hdrs = { "Content-Type": "application/json" };
        if (token) hdrs["Authorization"] = `Bearer ${token}`;
        const res = await fetch("/api/session", {
          method: "POST",
          headers: hdrs,
          body: JSON.stringify({ action: "getBodyPlateHistory", session_id: sessionId, access_token: accessToken, period_days: plateHistoryDays }),
        });
        const data = await res.json();
        if (data.ok) setPlateHistory(data);
      } catch {}
    }
    if (sessionId && accessToken) loadPlateHistory();
  }, [sessionId, accessToken, plateHistoryDays]);

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

  const stats = useMemo(() => {
    if (!history || history.length === 0) return null;
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0];
    const latest = sorted[sorted.length - 1];
    const last7 = sorted.slice(-7);
    const last30 = sorted.slice(-30);

    return {
      firstWeight: first?.weight_kg,
      latestWeight: latest?.weight_kg,
      firstWaist: first?.waist_cm,
      latestWaist: latest?.waist_cm,
      avgSteps7: avg(last7, "steps"),
      avgSleep7: avg(last7, "sleep_hours"),
      avgEnergy7: avg(last7, "energy_level"),
      avgMood7: avg(last7, "mood_level"),
      workoutDays7: last7.filter(l => l.workout_done).length,
    };
  }, [history]);

  const chartData = useMemo(() => {
    if (!history || history.length === 0) return [];
    const cutoff = new Date(Date.now() - chartDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return [...history]
      .filter(l => l.date >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [history, chartDays]);

  const displayHistory = useMemo(() => {
    if (!history || history.length === 0) return [];
    return history.slice(0, historyDays);
  }, [history, historyDays]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ width: "100%" }}>
      {/* Compact Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", marginBottom: 16, borderBottom: "1px solid #e8e2d8" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "#7D9A89", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 700 }}>О</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#2f2925" }}>Личный кабинет</div>
            <div style={{ fontSize: 12, color: "#8a7e72" }}>Опора. Здоровье & Стройность</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {wallet && (
            <div style={{ fontSize: 13, color: "#5f574f" }}>
              <span style={{ color: "#8a7e72" }}>Баланс </span>
              <span style={{ fontWeight: 700 }}>{wallet.balance?.toLocaleString()}</span>
            </div>
          )}
          <div style={{ fontSize: 13, color: "#8a7e72" }}>
            {new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
          </div>
          <button onClick={onLogout} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #d8cec1", background: "#fff", cursor: "pointer", fontSize: 13, color: "#5f574f" }}>
            Выйти
          </button>
        </div>
      </div>

      {/* Today CTA */}
      <div style={{ marginBottom: 20 }}>
        <button onClick={onNewDiary} style={{ width: "100%", padding: "14px 22px", borderRadius: 14, border: 0, background: "#7D9A89", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>
          {todayLog ? "Изменить запись сегодня" : "Заполнить дневник"}
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
          {stats.latestWeight != null && (
            <div style={{ padding: "14px 16px", borderRadius: 12, background: "#faf6ef", border: "1px solid #e8e2d8" }}>
              <div style={{ fontSize: 12, color: "#8a7e72", marginBottom: 4 }}>Вес</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#2f2925" }}>{stats.latestWeight} <span style={{ fontSize: 13, fontWeight: 400 }}>кг</span></div>
              {stats.firstWeight != null && stats.latestWeight !== stats.firstWeight && (
                <div style={{ fontSize: 12, color: "#7D9A89", marginTop: 2 }}>{deltaStr(stats.latestWeight, stats.firstWeight)} от начала</div>
              )}
            </div>
          )}
          {stats.latestWaist != null && (
            <div style={{ padding: "14px 16px", borderRadius: 12, background: "#faf6ef", border: "1px solid #e8e2d8" }}>
              <div style={{ fontSize: 12, color: "#8a7e72", marginBottom: 4 }}>Талия</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#2f2925" }}>{stats.latestWaist} <span style={{ fontSize: 13, fontWeight: 400 }}>см</span></div>
              {stats.firstWaist != null && stats.latestWaist !== stats.firstWaist && (
                <div style={{ fontSize: 12, color: "#7D9A89", marginTop: 2 }}>{deltaStr(stats.latestWaist, stats.firstWaist)} от начала</div>
              )}
            </div>
          )}
          {stats.avgSteps7 != null && (
            <div style={{ padding: "14px 16px", borderRadius: 12, background: "#faf6ef", border: "1px solid #e8e2d8" }}>
              <div style={{ fontSize: 12, color: "#8a7e72", marginBottom: 4 }}>Шаги (7 дн)</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#2f2925" }}>{Math.round(stats.avgSteps7).toLocaleString()}</div>
            </div>
          )}
          {stats.workoutDays7 > 0 && (
            <div style={{ padding: "14px 16px", borderRadius: 12, background: "#faf6ef", border: "1px solid #e8e2d8" }}>
              <div style={{ fontSize: 12, color: "#8a7e72", marginBottom: 4 }}>Тренировки (7 дн)</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#2f2925" }}>{stats.workoutDays7} <span style={{ fontSize: 13, fontWeight: 400 }}>дн.</span></div>
            </div>
          )}
          {stats.avgSleep7 != null && (
            <div style={{ padding: "14px 16px", borderRadius: 12, background: "#faf6ef", border: "1px solid #e8e2d8" }}>
              <div style={{ fontSize: 12, color: "#8a7e72", marginBottom: 4 }}>Сон (7 дн)</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#2f2925" }}>{stats.avgSleep7.toFixed(1)} <span style={{ fontSize: 13, fontWeight: 400 }}>ч</span></div>
            </div>
          )}
          {stats.avgEnergy7 != null && (
            <div style={{ padding: "14px 16px", borderRadius: 12, background: "#faf6ef", border: "1px solid #e8e2d8" }}>
              <div style={{ fontSize: 12, color: "#8a7e72", marginBottom: 4 }}>Энергия (7 дн)</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#2f2925" }}>{stats.avgEnergy7.toFixed(1)} <span style={{ fontSize: 13, fontWeight: 400 }}>/10</span></div>
            </div>
          )}
          {stats.avgMood7 != null && (
            <div style={{ padding: "14px 16px", borderRadius: 12, background: "#faf6ef", border: "1px solid #e8e2d8" }}>
              <div style={{ fontSize: 12, color: "#8a7e72", marginBottom: 4 }}>Настроение (7 дн)</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#2f2925" }}>{stats.avgMood7.toFixed(1)} <span style={{ fontSize: 13, fontWeight: 400 }}>/10</span></div>
            </div>
          )}
        </div>
      )}

      {/* Charts */}
      {chartData.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#2f2925" }}>Динамика</div>
            <div style={{ display: "flex", gap: 4 }}>
              {[7, 30, 90].map(d => (
                <button key={d} onClick={() => setChartDays(d)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d8cec1", background: chartDays === d ? "#7D9A89" : "#fff", color: chartDays === d ? "#fff" : "#5f574f", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  {d} дн
                </button>
              ))}
            </div>
          </div>

          {/* Weight chart */}
          {chartData.some(l => l.weight_kg != null) && (
            <div style={{ padding: "12px 16px", borderRadius: 12, border: "1px solid #e8e2d8", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#5f574f", marginBottom: 8 }}>Вес (кг)</div>
              <MiniLineChart data={chartData} dataKey="weight_kg" color="#7D9A89" />
            </div>
          )}

          {/* Steps chart */}
          {chartData.some(l => l.steps != null) && (
            <div style={{ padding: "12px 16px", borderRadius: 12, border: "1px solid #e8e2d8", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#5f574f", marginBottom: 8 }}>Шаги</div>
              <MiniBarChart data={chartData} dataKey="steps" color="#7D9A89" marks={Object.fromEntries(chartData.filter(l => l.workout_done).map(l => [l.date, true]))} markLabel="тренировки" />
            </div>
          )}

          {/* Sleep + Energy + Mood */}
          {(chartData.some(l => l.sleep_hours != null) || chartData.some(l => l.energy_level != null) || chartData.some(l => l.mood_level != null)) && (
            <div style={{ padding: "12px 16px", borderRadius: 12, border: "1px solid #e8e2d8", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#5f574f", marginBottom: 8 }}>Самочувствие</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {chartData.some(l => l.sleep_hours != null) && (
                  <div>
                    <div style={{ fontSize: 11, color: "#8a7e72", marginBottom: 4 }}>Сон (ч)</div>
                    <MiniLineChart data={chartData} dataKey="sleep_hours" color="#6b8fc7" height={60} />
                  </div>
                )}
                {chartData.some(l => l.energy_level != null) && (
                  <div>
                    <div style={{ fontSize: 11, color: "#8a7e72", marginBottom: 4 }}>Энергия</div>
                    <MiniLineChart data={chartData} dataKey="energy_level" color="#e8a857" height={60} />
                  </div>
                )}
                {chartData.some(l => l.mood_level != null) && (
                  <div>
                    <div style={{ fontSize: 11, color: "#8a7e72", marginBottom: 4 }}>Настроение</div>
                    <MiniLineChart data={chartData} dataKey="mood_level" color="#c77dba" height={60} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state for charts */}
      {(!history || history.length < 2) && (
        <div style={{ padding: "20px 16px", borderRadius: 12, background: "#faf6ef", border: "1px solid #e8e2d8", marginBottom: 24, textAlign: "center", color: "#8a7e72", fontSize: 14 }}>
          Заполните дневник ещё раз, чтобы увидеть графики динамики.
        </div>
      )}

      {/* History */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#2f2925" }}>Дневник по дням</div>
          <div style={{ display: "flex", gap: 4 }}>
            {[7, 30, 90].map(d => (
              <button key={d} onClick={() => setHistoryDays(d)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d8cec1", background: historyDays === d ? "#7D9A89" : "#fff", color: historyDays === d ? "#fff" : "#5f574f", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                {d} дн
              </button>
            ))}
          </div>
        </div>

        {displayHistory.length === 0 ? (
          <div style={{ padding: "20px 16px", borderRadius: 12, background: "#faf6ef", border: "1px solid #e8e2d8", textAlign: "center", color: "#8a7e72", fontSize: 14 }}>
            Записей пока нет. Начните с первого дня.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {displayHistory.map((day) => (
              <div key={day.date} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderRadius: 10, background: day.date === today ? "#e8f0ea" : "#faf6ef", border: day.date === today ? "1px solid #c4d0c6" : "1px solid #e8e2d8", fontSize: 13 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, color: "#2f2925", minWidth: 72 }}>
                    {new Date(day.date + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                  </span>
                  {day.weight_kg != null && <span style={{ color: "#5f574f" }}>{day.weight_kg} кг</span>}
                  {day.steps != null && <span style={{ color: "#5f574f" }}>{day.steps.toLocaleString()} шагов</span>}
                  {day.sleep_hours != null && <span style={{ color: "#5f574f" }}>сон {day.sleep_hours}ч</span>}
                  {day.workout_done && <span style={{ color: "#7D9A89", fontWeight: 600 }}>тренировка</span>}
                  {day.mood_level != null && <span style={{ color: "#5f574f" }}>😊 {day.mood_level}/10</span>}
                  {day.has_photos && <span>📷</span>}
                </div>
                <button onClick={() => onViewDiary(day)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d8cec1", background: "#fff", cursor: "pointer", fontSize: 12, color: "#5f574f", whiteSpace: "nowrap" }}>
                  Открыть
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Plate Nutrition by Photos */}
      {plateHistory && plateHistory.aggregates && plateHistory.aggregates.total_photos > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#2f2925" }}>Питание по фото</div>
            <div style={{ display: "flex", gap: 4 }}>
              {[7, 30].map(d => (
                <button key={d} onClick={() => setPlateHistoryDays(d)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d8cec1", background: plateHistoryDays === d ? "#7D9A89" : "#fff", color: plateHistoryDays === d ? "#fff" : "#5f574f", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  {d} дн
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div style={{ padding: "10px 14px", borderRadius: 10, background: "#faf6ef", border: "1px solid #e8e2d8", fontSize: 13 }}>
              <span style={{ color: "#8a7e72" }}>Фото: </span>
              <span style={{ fontWeight: 600 }}>{plateHistory.aggregates.total_photos}</span>
            </div>
            <div style={{ padding: "10px 14px", borderRadius: 10, background: "#faf6ef", border: "1px solid #e8e2d8", fontSize: 13 }}>
              <span style={{ color: "#8a7e72" }}>Дней с фото: </span>
              <span style={{ fontWeight: 600 }}>{plateHistory.aggregates.days_with_photos}</span>
            </div>
          </div>

          {/* Frequent observations */}
          <div style={{ padding: 12, borderRadius: 10, background: "#faf6ef", border: "1px solid #e8e2d8", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#2f2925", marginBottom: 8 }}>Частые наблюдения</div>
            {plateHistory.aggregates.protein_low + plateHistory.aggregates.protein_missing > 0 && (
              <div style={{ fontSize: 13, color: "#5f574f", marginBottom: 4 }}>🔸 Мало белка: {plateHistory.aggregates.protein_low + plateHistory.aggregates.protein_missing} раз</div>
            )}
            {plateHistory.aggregates.vegetables_low + plateHistory.aggregates.vegetables_missing > 0 && (
              <div style={{ fontSize: 13, color: "#5f574f", marginBottom: 4 }}>🔸 Мало овощей: {plateHistory.aggregates.vegetables_low + plateHistory.aggregates.vegetables_missing} раз</div>
            )}
            {plateHistory.aggregates.carbohydrates_excess > 0 && (
              <div style={{ fontSize: 13, color: "#5f574f", marginBottom: 4 }}>🔸 Много углеводов: {plateHistory.aggregates.carbohydrates_excess} раз</div>
            )}
            {plateHistory.aggregates.frequent_missing.length > 0 && plateHistory.aggregates.frequent_missing.slice(0, 3).map((m, i) => (
              <div key={i} style={{ fontSize: 13, color: "#8a7e72", marginBottom: 2 }}>• Часто не хватает: {m.item} ({m.count})</div>
            ))}
            {plateHistory.aggregates.protein_low + plateHistory.aggregates.protein_missing === 0 &&
             plateHistory.aggregates.vegetables_low + plateHistory.aggregates.vegetables_missing === 0 &&
             plateHistory.aggregates.carbohydrates_excess === 0 && (
              <div style={{ fontSize: 13, color: "#7D9A89" }}>✅ Баланс в норме</div>
            )}
          </div>

          {/* Recent photos */}
          {plateHistory.entries && plateHistory.entries.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#2f2925", marginBottom: 8 }}>Последние фото</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {plateHistory.entries.slice(0, 6).map((entry, i) => (
                  <div key={i} style={{ padding: "8px 12px", borderRadius: 8, background: "#faf6ef", border: "1px solid #e8e2d8", fontSize: 12 }}>
                    <span style={{ fontWeight: 600, color: "#2f2925" }}>
                      {new Date(entry.log_date + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                    </span>
                    {entry.balance_summary && <span style={{ color: "#5f574f", marginLeft: 8 }}>— {entry.balance_summary}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Profile */}
      {profile && Object.keys(profile).length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#2f2925", marginBottom: 12 }}>Профиль</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {profile.age && <div style={{ padding: "10px 14px", borderRadius: 10, background: "#faf6ef", border: "1px solid #e8e2d8", fontSize: 13 }}><span style={{ color: "#8a7e72" }}>Возраст: </span><span style={{ fontWeight: 600 }}>{profile.age}</span></div>}
            {profile.gender && <div style={{ padding: "10px 14px", borderRadius: 10, background: "#faf6ef", border: "1px solid #e8e2d8", fontSize: 13 }}><span style={{ color: "#8a7e72" }}>Пол: </span><span style={{ fontWeight: 600 }}>{GENDER_LABELS[profile.gender] || profile.gender}</span></div>}
            {profile.height_cm && <div style={{ padding: "10px 14px", borderRadius: 10, background: "#faf6ef", border: "1px solid #e8e2d8", fontSize: 13 }}><span style={{ color: "#8a7e72" }}>Рост: </span><span style={{ fontWeight: 600 }}>{profile.height_cm} см</span></div>}
            {profile.weight_kg && <div style={{ padding: "10px 14px", borderRadius: 10, background: "#faf6ef", border: "1px solid #e8e2d8", fontSize: 13 }}><span style={{ color: "#8a7e72" }}>Вес: </span><span style={{ fontWeight: 600 }}>{profile.weight_kg} кг</span></div>}
            {profile.target_weight_kg && <div style={{ padding: "10px 14px", borderRadius: 10, background: "#faf6ef", border: "1px solid #e8e2d8", fontSize: 13 }}><span style={{ color: "#8a7e72" }}>Цель: </span><span style={{ fontWeight: 600 }}>{profile.target_weight_kg} кг</span></div>}
            {profile.activity_level && <div style={{ padding: "10px 14px", borderRadius: 10, background: "#faf6ef", border: "1px solid #e8e2d8", fontSize: 13 }}><span style={{ color: "#8a7e72" }}>Активность: </span><span style={{ fontWeight: 600 }}>{ACTIVITY_LABELS[profile.activity_level] || profile.activity_level}</span></div>}
          </div>
        </div>
      )}

      {/* Access (collapsible) */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => setAccessOpen(!accessOpen)} style={{ width: "100%", padding: "10px 16px", borderRadius: 10, border: "1px solid #e8e2d8", background: "#faf6ef", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, fontWeight: 600, color: "#2f2925", fontFamily: "inherit" }}>
          <span>Доступ</span>
          <span style={{ fontSize: 12, color: "#8a7e72" }}>{accessOpen ? "▲" : "▼"}</span>
        </button>
        {accessOpen && (
          <div style={{ padding: "14px 16px", borderRadius: "0 0 10px 10px", border: "1px solid #e8e2d8", borderTop: 0, background: "#fff" }}>
            {newCode ? (
              <div>
                <div style={{ fontSize: 13, color: "#5f574f", marginBottom: 8 }}>Новый код (показан один раз):</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <code style={{ flex: 1, padding: "8px 12px", borderRadius: 8, background: "#f5f0e8", fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>{newCode}</code>
                  <button onClick={copyCode} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #7D9A89", background: copied ? "#7D9A89" : "#fff", color: copied ? "#fff" : "#7D9A89", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                    {copied ? "✓ Скопировано" : "Копировать"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button onClick={() => setShowRotateConfirm(true)} disabled={rotating} style={{ width: "100%", padding: "10px 16px", borderRadius: 10, border: "1px solid #d8cec1", background: "#fff", cursor: rotating ? "not-allowed" : "pointer", fontSize: 14, color: "#2f2925", opacity: rotating ? 0.6 : 1 }}>
                  {rotating ? "Создаём..." : "Создать новый код продолжения"}
                </button>
                {showRotateConfirm && (
                  <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "#fdf6ee", border: "1px solid #e8d5b8" }}>
                    <div style={{ fontSize: 13, color: "#5f574f", marginBottom: 8 }}>Старый код перестанет работать. Новый код будет показан один раз.</div>
                    {rotateError && <div style={{ fontSize: 13, color: "#b5473f", marginBottom: 8 }}>{rotateError}</div>}
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
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
