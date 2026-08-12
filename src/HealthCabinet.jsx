import React, { useState, useMemo, useEffect, useRef } from "react";
import { getClientToken } from "./lib/clientToken.js";

function getLocalDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const ACTIVITY_LABELS = {
  sedentary: "Малоподвижный",
  light: "Низкая активность",
  moderate: "Средняя активность",
  active: "Высокая активность",
  very_active: "Очень высокая активность",
};

const GENDER_LABELS = { male: "Мужской", female: "Женский", prefer_not_to_say: "Не хочу указывать", other: "Не хочу указывать", prefer_not: "Не хочу указывать" };

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

function ServiceRequestsCard({ sessionId, accessToken, onOpen }) {
  const [counts, setCounts] = useState({ waiting: 0, answered: 0, scheduled: 0 });

  useEffect(() => {
    async function load() {
      try {
        let token;
        try { token = await getClientToken("body", "session"); } catch {}
        const hdrs = { "Content-Type": "application/json" };
        if (token) hdrs["Authorization"] = `Bearer ${token}`;
        const res = await fetch("/api/session", {
          method: "POST", headers: hdrs,
          body: JSON.stringify({ action: "getBodyServiceRequests", session_id: sessionId, access_token: accessToken }),
        });
        const data = await res.json();
        if (data.ok && data.requests) {
          const reqs = data.requests;
          setCounts({
            waiting: reqs.filter(r => ["submitted", "accepted", "needs_clarification"].includes(r.status)).length,
            answered: reqs.filter(r => r.status === "answered").length,
            scheduled: reqs.filter(r => r.status === "scheduled").length,
          });
        }
      } catch {}
    }
    if (sessionId && accessToken) load();
  }, [sessionId, accessToken]);

  const total = counts.waiting + counts.answered + counts.scheduled;

  return (
    <div style={{ marginBottom: 24, padding: 16, borderRadius: 12, border: "1px solid #e8e2d8", background: "#faf6ef" }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#2f2925", marginBottom: 8 }}>Связаться со специалистом</div>
      {total > 0 ? (
        <div style={{ fontSize: 13, color: "#5f574f", marginBottom: 10 }}>
          {counts.waiting > 0 && <span>Ожидает ответа: {counts.waiting}</span>}
          {counts.answered > 0 && <span>{counts.waiting > 0 ? " · " : ""}Есть ответ: {counts.answered}</span>}
          {counts.scheduled > 0 && <span>{(counts.waiting + counts.answered) > 0 ? " · " : ""}Запланировано: {counts.scheduled}</span>}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "#8a7e72", marginBottom: 10 }}>Пока нет запросов</div>
      )}
      <button onClick={onOpen} style={{ width: "100%", padding: "8px 16px", borderRadius: 8, border: "1px solid #7D9A89", background: "#fff", color: "#5f8b7a", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
        Открыть
      </button>
    </div>
  );
}

export default function HealthCabinet({
  sessionId,
  accessToken,
  displayName,
  profile,
  wallet,
  todayLog,
  history,
  onNewDiary,
  onViewDiary,
  onLogout,
  onRotateCode,
  onOpenHealthContext,
  onOpenServiceRequests,
  onUpdateDisplayName,
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
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(displayName || "");
  const [insights, setInsights] = useState([]);

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

  // Fetch insights on mount
  useEffect(() => {
    async function loadInsights() {
      try {
        let token;
        try { token = await getClientToken("body", "session"); } catch {}
        const hdrs = { "Content-Type": "application/json" };
        if (token) hdrs["Authorization"] = `Bearer ${token}`;
        const res = await fetch("/api/session", {
          method: "POST",
          headers: hdrs,
          body: JSON.stringify({ action: "getBodyInsights", session_id: sessionId, access_token: accessToken }),
        });
        const data = await res.json();
        if (data.ok) setInsights(data.insights || []);
      } catch {}
    }
    if (sessionId && accessToken) loadInsights();
  }, [sessionId, accessToken]);

  // Weekly summary
  const [weeklySummary, setWeeklySummary] = useState(null);
  const [weeklyStale, setWeeklyStale] = useState(false);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyError, setWeeklyError] = useState("");

  // Calculate period (last 7 days including today)
  const weekEnd = getLocalDateString();
  const weekStart = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Check for cached summary on mount
  useEffect(() => {
    async function loadWeekly() {
      try {
        let token;
        try { token = await getClientToken("body", "session"); } catch {}
        const hdrs = { "Content-Type": "application/json" };
        if (token) hdrs["Authorization"] = `Bearer ${token}`;
        const res = await fetch("/api/session", {
          method: "POST",
          headers: hdrs,
          body: JSON.stringify({ action: "getBodyWeeklySummary", session_id: sessionId, access_token: accessToken, period_start: weekStart, period_end: weekEnd }),
        });
        const data = await res.json();
        if (data.ok && data.summary) {
          setWeeklySummary(data.summary);
          setWeeklyStale(!!data.stale);
        }
      } catch {}
    }
    if (sessionId && accessToken) loadWeekly();
  }, [sessionId, accessToken, weekStart, weekEnd]);

  async function generateWeekly() {
    setWeeklyLoading(true);
    setWeeklyError("");
    try {
      let token;
      try { token = await getClientToken("body", "session"); } catch {}
      const hdrs = { "Content-Type": "application/json" };
      if (token) hdrs["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/session", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ action: "generateBodyWeeklySummary", session_id: sessionId, access_token: accessToken, period_start: weekStart, period_end: weekEnd }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Не удалось сформировать итог.");
      }
      if (data.summary) {
        setWeeklySummary(data.summary);
        setWeeklyStale(false);
      }
    } catch (e) {
      setWeeklyError(e.message || "Ошибка формирования итога.");
    } finally {
      setWeeklyLoading(false);
    }
  }

  // AI Chat
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatOpen, setChatOpen] = useState(true);
  const [healthContext, setHealthContext] = useState(null);
  const [chatScrolledUp, setChatScrolledUp] = useState(false);
  const [chatHasNewResponse, setChatHasNewResponse] = useState(false);
  const [chatShowHistory, setChatShowHistory] = useState(false);
  const chatContainerRef = useRef(null);
  const chatInputRef = useRef(null);

  // Voice recording
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  // Fetch health context on mount
  useEffect(() => {
    async function loadHealthContext() {
      try {
        let token;
        try { token = await getClientToken("body", "session"); } catch {}
        const hdrs = { "Content-Type": "application/json" };
        if (token) hdrs["Authorization"] = `Bearer ${token}`;
        const res = await fetch("/api/session", {
          method: "POST", headers: hdrs,
          body: JSON.stringify({ action: "getBodyHealthContext", session_id: sessionId, access_token: accessToken }),
        });
        const data = await res.json();
        if (data.ok && data.context) setHealthContext(data.context);
      } catch {}
    }
    if (sessionId && accessToken) loadHealthContext();
  }, [sessionId, accessToken]);
  const [chatDebug, setChatDebug] = useState("");

  const SUGGESTED_PROMPTS = [
    "Что видно по моей неделе?",
    "Какой маленький шаг выбрать завтра?",
    "Что обсудить со специалистом?",
  ];

  // Load chat history on mount
  useEffect(() => {
    if (!sessionId || !accessToken) return;
    async function loadChat() {
      try {
        let token;
        try { token = await getClientToken("body", "session"); } catch {}
        const hdrs = { "Content-Type": "application/json" };
        if (token) hdrs["Authorization"] = `Bearer ${token}`;
        const res = await fetch("/api/session", {
          method: "POST",
          headers: hdrs,
          body: JSON.stringify({ action: "getBodyAiChat", session_id: sessionId, access_token: accessToken, limit: 20 }),
        });
        const data = await res.json();
        if (data.ok) setChatMessages(data.messages || []);
      } catch {}
    }
    loadChat();
  }, [sessionId, accessToken]);

  async function sendChat(text) {
    const msg = (text || chatInput).trim();
    if (!msg || chatLoading) return;
    setChatInput("");
    setChatError("");
    setChatLoading(true);
    setChatDebug("sending...");

    // Add user message optimistically
    const userMsg = { id: "temp-" + Date.now(), role: "user", message_text: msg, created_at: new Date().toISOString() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatHasNewResponse(false);
    // Scroll to bottom after optimistic add
    requestAnimationFrame(() => { setTimeout(() => scrollToChatBottom(false), 0); });

    try {
      let token;
      try { token = await getClientToken("body", "session"); } catch {}
      const hdrs = { "Content-Type": "application/json" };
      if (token) hdrs["Authorization"] = `Bearer ${token}`;
      setChatDebug("api " + "request...");
      const res = await fetch("/api/session", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ action: "sendBodyAiMessage", session_id: sessionId, access_token: accessToken, message_text: msg }),
      });
      const data = await res.json();
      setChatDebug("api " + res.status + " ok=" + data.ok);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Не удалось ответить.");
      }
      // Build assistant message from API response
      const assistantMsg = data.message || {
        role: "assistant",
        answer: data.answer || "Не удалось получить ответ.",
        confidence: "low",
        created_at: new Date().toISOString(),
      };
      // Replace temp user message with real one, add assistant response
      setChatMessages(prev => {
        const withoutTemp = prev.filter(m => m.id !== userMsg.id);
        return [...withoutTemp, { ...userMsg, id: "user-" + Date.now() }, assistantMsg];
      });
      // Auto-scroll to new response
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (!chatScrolledUp) {
            scrollToChatBottom(true);
          } else {
            setChatHasNewResponse(true);
          }
        }, 0);
      });
      setChatDebug("done");
    } catch (e) {
      setChatError(e.message || "Ошибка.");
      setChatDebug("error: " + e.message);
      setChatMessages(prev => prev.filter(m => m.id !== userMsg.id));
    } finally {
      setChatLoading(false);
    }
  }

  // Chat scroll
  function handleChatScroll(e) {
    const el = e.target;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setChatScrolledUp(!atBottom);
  }

  function scrollToChatBottom(smooth = true) {
    const el = chatContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "instant" });
    setChatScrolledUp(false);
    setChatHasNewResponse(false);
  }

  // Voice recording
  const [transcriptionError, setTranscriptionError] = useState("");

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (blob.size < 100) { setTranscribing(false); return; }
        await transcribeAudio(blob);
      };
      mr.start();
      setRecording(true);
      setRecordingTime(0);
      setTranscriptionError("");
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch (e) {
      console.error("Recording failed:", e);
      setTranscriptionError("Не удалось начать запись. Проверьте разрешение микрофона.");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }

  async function transcribeAudio(blob) {
    setTranscribing(true);
    setTranscriptionError("");
    try {
      let token;
      try { token = await getClientToken("body", "transcribe"); } catch {}
      const tHeaders = {
        "Content-Type": "audio/webm",
        "X-Session-Id": sessionId,
        "X-Module": "body",
        "X-Access-Token": accessToken,
      };
      if (token) tHeaders["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: tHeaders,
        body: blob,
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = null; }
      if (!res.ok || !data || !data.text) {
        const msg = (data && data.error) || `Ошибка распознавания (${res.status})`;
        setTranscriptionError(msg);
        setTranscribing(false);
        return;
      }
      // Enable textarea BEFORE setting value to ensure DOM updates
      setTranscribing(false);
      setChatInput(prev => prev ? prev + " " + data.text : data.text);
      chatInputRef.current?.focus();
    } catch (e) {
      console.error("Transcription failed:", e);
      setTranscriptionError("Не удалось распознать речь. Попробуйте ещё раз.");
      setTranscribing(false);
    }
  }

  async function dismissInsight(insightId) {
    try {
      let token;
      try { token = await getClientToken("body", "session"); } catch {}
      const hdrs = { "Content-Type": "application/json" };
      if (token) hdrs["Authorization"] = `Bearer ${token}`;
      await fetch("/api/session", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ action: "dismissBodyInsight", session_id: sessionId, access_token: accessToken, insight_id: insightId }),
      });
      setInsights(prev => prev.filter(i => i.id !== insightId));
    } catch {}
  }

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
            <div style={{ fontSize: 15, fontWeight: 700, color: "#2f2925" }}>Личный кабинет{displayName ? ` ${displayName}` : ""}</div>
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

      {/* AI Companion — always visible */}
      <div style={{ marginBottom: 24, background: "#FAF6EF", border: "1px solid rgba(46,42,37,.1)", borderRadius: 16, padding: 20 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#2f2925", marginBottom: 4 }}>Спросить AI-компаньона</div>
        <div style={{ fontSize: 13, color: "#7A7268", marginBottom: 12 }}>
          Можно задать вопрос о питании, активности, сне, дневнике или самочувствии.
        </div>

        {/* Chat messages */}
        {chatMessages.length > 0 && (
          <div ref={chatContainerRef} onScroll={handleChatScroll} style={{ maxHeight: 240, overflowY: "auto", marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {chatMessages.map((msg) => (
              <div key={msg.id} style={{ alignSelf: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
                {msg.role === "user" ? (
                  <div style={{ padding: "8px 14px", borderRadius: 12, background: "#7D9A89", color: "#fff", fontSize: 14 }}>
                    {msg.message_text}
                  </div>
                ) : (
                  <div>
                    <div style={{ padding: "8px 14px", borderRadius: 12, background: "#f0f5f1", color: "#2f2925", fontSize: 14, lineHeight: 1.5 }}>
                      {msg.answer || msg.ai_response?.answer || msg.message_text}
                    </div>
                    {(msg.small_next_step || msg.ai_response?.small_next_step) && (
                      <div style={{ fontSize: 12, color: "#7D9A89", marginTop: 4, marginLeft: 8 }}>→ {msg.small_next_step || msg.ai_response?.small_next_step}</div>
                    )}
                    {(msg.question_for_specialist || msg.ai_response?.question_for_specialist) && (
                      <div style={{ fontSize: 12, color: "#8a7e72", marginTop: 4, marginLeft: 8, fontStyle: "italic" }}>💬 {msg.question_for_specialist || msg.ai_response?.question_for_specialist}</div>
                    )}
                    {(msg.safety_note || msg.ai_response?.safety_note) && (
                      <div style={{ fontSize: 12, color: "#b5473f", marginTop: 4, marginLeft: 8, padding: "4px 8px", borderRadius: 6, background: "#fdf2f2" }}>⚠ {msg.safety_note || msg.ai_response?.safety_note}</div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {chatLoading && (
              <div style={{ alignSelf: "flex-start", padding: "8px 14px", borderRadius: 12, background: "#f0f5f1", fontSize: 13, color: "#8a7e72", fontStyle: "italic" }}>
                AI-компаньон отвечает…
              </div>
            )}
            {chatHasNewResponse && chatScrolledUp && (
              <button onClick={() => scrollToChatBottom(true)} style={{ alignSelf: "center", padding: "6px 14px", borderRadius: 20, background: "#7D9A89", color: "white", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>
                Новый ответ ↓
              </button>
            )}
          </div>
        )}

        {chatMessages.length === 0 && !chatLoading && (
          <div style={{ fontSize: 13, color: "#8a7e72", marginBottom: 12 }}>
            Задайте вопрос по дневнику, питанию, сну, активности или недельному итогу.
          </div>
        )}

        {/* Suggested prompts */}
        {chatMessages.length === 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {SUGGESTED_PROMPTS.map((p, i) => (
              <button key={i} onClick={() => sendChat(p)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #d8cec1", background: "#fff", cursor: "pointer", fontSize: 12, color: "#5f574f" }}>
                {p}
              </button>
            ))}
          </div>
        )}

        {chatError && <div style={{ color: "#b5473f", fontSize: 13, marginBottom: 8 }}>{chatError}</div>}

        {/* Input */}
        <div style={{ display: "flex", gap: 8 }}>
          <textarea
            ref={chatInputRef}
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); sendChat(); } }}
            placeholder="Что хотите обсудить?"
            rows={2}
            disabled={chatLoading || transcribing}
            style={{ flex: 1, minHeight: 44, maxHeight: 100, padding: "8px 12px", borderRadius: 10, border: "1px solid #d8cec1", background: "#fff", fontSize: 14, outline: "none", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <button onClick={() => sendChat()} disabled={chatLoading || !chatInput.trim()} style={{ height: 36, padding: "0 16px", borderRadius: 10, border: 0, background: chatLoading || !chatInput.trim() ? "#c4d0c6" : "#7D9A89", color: "#fff", fontWeight: 600, fontSize: 13, cursor: chatLoading || !chatInput.trim() ? "not-allowed" : "pointer" }}>
              {chatLoading ? "…" : "Отправить"}
            </button>
            <button onClick={recording ? stopRecording : startRecording} disabled={transcribing} style={{ height: 36, padding: "0 12px", borderRadius: 10, border: recording ? "2px solid #b5473f" : "1px solid #d8cec1", background: recording ? "#fdf2f2" : transcribing ? "#f0f5f1" : "#fff", color: recording ? "#b5473f" : "#5f574f", fontSize: 13, cursor: transcribing ? "not-allowed" : "pointer" }}>
              {transcribing ? "Распознаю речь…" : recording ? `⏹ Остановить · ${recordingTime} с` : "🎙 Говорить"}
            </button>
            {transcriptionError && (
              <div style={{ fontSize: 11, color: "#b5473f", textAlign: "center" }}>{transcriptionError}</div>
            )}
          </div>
        </div>
      </div>

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

        <button onClick={onNewDiary} style={{ width: "100%", padding: "10px 16px", borderRadius: 10, border: "1px solid #7D9A89", background: "#fff", color: "#5f8b7a", fontWeight: 600, fontSize: 14, cursor: "pointer", marginBottom: 12, fontFamily: "inherit" }}>
          Заполнить новый день
        </button>

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

      {/* Insights */}
      {insights.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#2f2925", marginBottom: 12 }}>Наблюдения</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {insights.map((insight) => (
              <div key={insight.id} style={{ padding: "12px 16px", borderRadius: 12, background: "#faf6ef", border: "1px solid #e8e2d8" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#2f2925" }}>{insight.title}</div>
                  <button onClick={() => dismissInsight(insight.id)} style={{ padding: "2px 8px", borderRadius: 6, border: "1px solid #d8cec1", background: "#fff", cursor: "pointer", fontSize: 11, color: "#8a7e72", whiteSpace: "nowrap" }}>
                    Скрыть
                  </button>
                </div>
                <div style={{ fontSize: 13, color: "#5f574f", lineHeight: 1.5 }}>{insight.insight_text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {insights.length === 0 && (
        <div style={{ marginBottom: 24, padding: 16, borderRadius: 12, background: "#faf6ef", border: "1px solid #e8e2d8", textAlign: "center", color: "#8a7e72", fontSize: 14 }}>
          Пока мало данных для устойчивых наблюдений. Заполните дневник несколько дней подряд.
        </div>
      )}

      {/* Weekly Summary */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#2f2925", marginBottom: 12 }}>Итог недели</div>

        {!weeklySummary && !weeklyLoading && (
          <div style={{ padding: 16, borderRadius: 12, background: "#faf6ef", border: "1px solid #e8e2d8" }}>
            <div style={{ fontSize: 14, color: "#5f574f", marginBottom: 12 }}>
              {history && history.length > 0
                ? "Данных пока мало, но можно получить предварительный итог."
                : "Пока нет дневников для недельного итога."}
            </div>
            {history && history.length > 0 && (
              <button onClick={generateWeekly} disabled={weeklyLoading} style={{ width: "100%", padding: "10px 16px", borderRadius: 10, border: 0, background: "#7D9A89", color: "#fff", fontWeight: 600, fontSize: 14, cursor: weeklyLoading ? "not-allowed" : "pointer", opacity: weeklyLoading ? 0.6 : 1 }}>
                {weeklyLoading ? "Формируем..." : "Сформировать итог недели"}
              </button>
            )}
            {weeklyError && <div style={{ color: "#b5473f", fontSize: 13, marginTop: 8 }}>{weeklyError}</div>}
          </div>
        )}

        {weeklyLoading && !weeklySummary && (
          <div style={{ padding: 16, borderRadius: 12, background: "#faf6ef", border: "1px solid #e8e2d8", textAlign: "center", color: "#8a7e72" }}>
            Формируем итог недели...
          </div>
        )}

        {weeklySummary && weeklySummary.summary_json && (
          <div style={{ padding: 16, borderRadius: 12, background: weeklyStale ? "#fdf6ee" : "#f0f5f1", border: `1px solid ${weeklyStale ? "#e8d5b8" : "#c4d0c6"}` }}>
            {weeklyStale ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#e8a857", marginBottom: 4 }}>Итог недели нужно обновить</div>
                <div style={{ fontSize: 13, color: "#5f574f", marginBottom: 8 }}>После прошлого итога появились новые записи дневника. Обновите итог, чтобы он учитывал последние дни.</div>
                {weeklySummary.source_days != null && (
                  <div style={{ fontSize: 12, color: "#8a7e72", marginBottom: 8 }}>Предыдущий итог был создан на основе {weeklySummary.source_days} {weeklySummary.source_days === 1 ? "записи" : "записей"}.</div>
                )}
                <button onClick={generateWeekly} disabled={weeklyLoading} style={{ width: "100%", padding: "8px 16px", borderRadius: 8, border: 0, background: "#7D9A89", color: "#fff", fontWeight: 600, fontSize: 13, cursor: weeklyLoading ? "not-allowed" : "pointer", opacity: weeklyLoading ? 0.6 : 1 }}>
                  {weeklyLoading ? "Обновляем..." : "Обновить итог недели"}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#8a7e72", marginBottom: 8 }}>Сохранённый итог недели</div>
            )}

            {weeklySummary.summary_json.period_summary && (
              <div style={{ fontSize: 14, color: "#5f574f", lineHeight: 1.6, marginBottom: 12 }}>{weeklySummary.summary_json.period_summary}</div>
            )}

            {weeklySummary.summary_json.positive_changes?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#2f2925", marginBottom: 4 }}>Что получилось</div>
                {weeklySummary.summary_json.positive_changes.map((item, i) => (
                  <div key={i} style={{ fontSize: 13, color: "#7D9A89", marginBottom: 2 }}>🟢 {item}</div>
                ))}
              </div>
            )}

            {weeklySummary.summary_json.patterns?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#2f2925", marginBottom: 4 }}>Повторяющиеся моменты</div>
                {weeklySummary.summary_json.patterns.map((item, i) => (
                  <div key={i} style={{ fontSize: 13, color: "#e8a857", marginBottom: 2 }}>📊 {item}</div>
                ))}
              </div>
            )}

            {weeklySummary.summary_json.nutrition_observations?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#2f2925", marginBottom: 4 }}>Питание</div>
                {weeklySummary.summary_json.nutrition_observations.map((item, i) => (
                  <div key={i} style={{ fontSize: 13, color: "#5f574f", marginBottom: 2 }}>🍽 {item}</div>
                ))}
              </div>
            )}

            {weeklySummary.summary_json.activity_observations?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#2f2925", marginBottom: 4 }}>Активность</div>
                {weeklySummary.summary_json.activity_observations.map((item, i) => (
                  <div key={i} style={{ fontSize: 13, color: "#5f574f", marginBottom: 2 }}>🏃 {item}</div>
                ))}
              </div>
            )}

            {weeklySummary.summary_json.sleep_observations?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#2f2925", marginBottom: 4 }}>Сон</div>
                {weeklySummary.summary_json.sleep_observations.map((item, i) => (
                  <div key={i} style={{ fontSize: 13, color: "#5f574f", marginBottom: 2 }}>😴 {item}</div>
                ))}
              </div>
            )}

            {weeklySummary.summary_json.next_week_focus?.length > 0 && (
              <div style={{ padding: 10, borderRadius: 8, background: "#fff", border: "1px solid #c4d0c6", marginTop: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#2f2925", marginBottom: 4 }}>Фокус на следующую неделю</div>
                {weeklySummary.summary_json.next_week_focus.map((item, i) => (
                  <div key={i} style={{ fontSize: 13, color: "#5f574f", marginBottom: 2 }}>→ {item}</div>
                ))}
              </div>
            )}

            {weeklySummary.summary_json.questions_for_specialist?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#8a7e72", marginBottom: 4 }}>Что обсудить со специалистом</div>
                {weeklySummary.summary_json.questions_for_specialist.map((item, i) => (
                  <div key={i} style={{ fontSize: 13, color: "#8a7e72", marginBottom: 2 }}>💬 {item}</div>
                ))}
              </div>
            )}

            {weeklySummary.summary_json.data_quality && !weeklySummary.summary_json.data_quality.is_enough_data && (
              <div style={{ fontSize: 12, color: "#8a7e72", marginTop: 8, fontStyle: "italic" }}>
                ⚠ {weeklySummary.summary_json.data_quality.comment || "Данных пока мало, вывод предварительный."}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Compact AI link from weekly summary */}
      {weeklySummary && (
        <div style={{ marginBottom: 24 }}>
          <button onClick={() => { setChatInput("Обсудить итог недели"); chatInputRef.current?.focus(); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ width: "100%", padding: "10px 16px", borderRadius: 10, border: "1px solid #e8e2d8", background: "#f0f5f1", cursor: "pointer", fontSize: 13, color: "#5f574f", fontFamily: "inherit", textAlign: "left" }}>
            💬 Обсудить итог недели с AI-компаньоном
          </button>
        </div>
      )}

      {/* Profile */}
      {profile && Object.keys(profile).length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#2f2925", marginBottom: 12 }}>Профиль</div>

          {/* Display name edit */}
          <div style={{ padding: "12px 14px", borderRadius: 10, background: "#faf6ef", border: "1px solid #e8e2d8", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "#8a7e72", marginBottom: 4 }}>Как к вам обращаться</div>
            {editingName ? (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { onUpdateDisplayName?.(nameInput); setEditingName(false); } }}
                  placeholder="Имя или псевдоним"
                  autoFocus
                  style={{ flex: 1, height: 36, padding: "0 10px", borderRadius: 8, border: "1px solid #d8cec1", fontSize: 14, outline: "none", fontFamily: "inherit" }}
                />
                <button onClick={() => { onUpdateDisplayName?.(nameInput); setEditingName(false); }} style={{ height: 36, padding: "0 12px", borderRadius: 8, border: 0, background: "#7D9A89", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                  Сохранить
                </button>
                <button onClick={() => { setEditingName(false); setNameInput(displayName || ""); }} style={{ height: 36, padding: "0 12px", borderRadius: 8, border: "1px solid #d8cec1", background: "#fff", color: "#5f574f", fontSize: 13, cursor: "pointer" }}>
                  Отмена
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#2f2925" }}>{displayName || "Не указано"}</span>
                <button onClick={() => { setEditingName(true); setNameInput(displayName || ""); }} style={{ fontSize: 12, color: "#7D9A89", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                  Изменить
                </button>
              </div>
            )}
          </div>

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

      {/* Health Context */}
      <div style={{ marginBottom: 24, padding: 16, borderRadius: 12, border: "1px solid #e8e2d8", background: "#faf6ef" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#2f2925" }}>Здоровье, анализы и препараты</div>
        </div>
        <div style={{ fontSize: 13, color: "#8a7e72", marginBottom: 10 }}>
          {healthContext && (healthContext.health_conditions?.length > 0 || healthContext.medications?.length > 0 || healthContext.supplements?.length > 0 || healthContext.lab_notes?.has_recent_labs) ? (
            <>
              {healthContext.health_conditions?.length > 0 && <span>{healthContext.health_conditions.length} сост. · </span>}
              {healthContext.medications?.length > 0 && <span>{healthContext.medications.length} препарат{healthContext.medications.length === 1 ? "" : "а"} · </span>}
              {healthContext.supplements?.length > 0 && <span>{healthContext.supplements.length} БАД · </span>}
              {healthContext.lab_notes?.has_recent_labs && <span>анализы</span>}
            </>
          ) : "Не заполнено"}
        </div>
        <button onClick={onOpenHealthContext} style={{ width: "100%", padding: "8px 16px", borderRadius: 8, border: "1px solid #7D9A89", background: "#fff", color: "#5f8b7a", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
          Заполнить / обновить
        </button>
      </div>

      {/* Service Requests */}
      <ServiceRequestsCard sessionId={sessionId} accessToken={accessToken} onOpen={onOpenServiceRequests} />

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
