import React, { useState } from "react";

export default function App() {
  const [mode, setMode] = useState("text");
  const [text, setText] = useState("");
  const [questions, setQuestions] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [phase, setPhase] = useState("input");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function startScreening() {
    if (text.trim().length < 10) {
      setError("Напишите хотя бы 2–3 предложения.");
      return;
    }

    setLoading(true);
    setError("");
    setQuestions(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mode: "questions" }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");

      const qs = Array.isArray(data.result)
        ? data.result.filter(Boolean)
        : data.result
            .split("\n")
            .filter((l) => l.trim() && /\d/.test(l));

      setQuestions(qs.length > 0 ? qs : [data.result]);
      setPhase("questions");
    } catch (e) {
      setError(e.message || "Не удалось загрузить вопросы.");
    } finally {
      setLoading(false);
    }
  }

  async function getFinalReport() {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          answers: questions.map((q, index) => ({
            question: q,
            answer: answers[index] || "",
          })),
          mode: "final",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");

      setResult(data.result);
      setPhase("report");
    } catch (e) {
      setError(e.message || "Не удалось получить отчёт.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setPhase("input");
    setQuestions(null);
    setAnswers({});
    setResult(null);
    setText("");
    setError("");
  }

  const s = {
    page: {
      minHeight: "100vh",
      background: "#050817",
      color: "white",
      fontFamily: "Inter, system-ui, Arial",
      padding: "32px",
    },
    wrap: { maxWidth: 1200, margin: "0 auto" },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 80,
    },
    logo: { fontSize: 28, fontWeight: 800 },
    sub: { color: "#94a3b8", marginTop: 4 },
    crisis: {
      background: "#dc2626",
      color: "white",
      border: 0,
      borderRadius: 22,
      padding: "16px 24px",
      fontWeight: 800,
      fontSize: 16,
      cursor: "pointer",
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "1.1fr 0.9fr",
      gap: 56,
      alignItems: "start",
    },
    badge: {
      display: "inline-block",
      border: "1px solid rgba(255,255,255,.14)",
      background: "rgba(255,255,255,.06)",
      borderRadius: 999,
      padding: "12px 18px",
      color: "#cbd5e1",
      marginBottom: 28,
    },
    h1: {
      fontSize: 68,
      lineHeight: 1.03,
      fontWeight: 900,
      margin: 0,
      letterSpacing: "-0.05em",
    },
    p: {
      color: "#cbd5e1",
      fontSize: 20,
      lineHeight: 1.7,
      maxWidth: 680,
    },
    row: {
      display: "flex",
      gap: 14,
      marginTop: 28,
      flexWrap: "wrap",
    },
    primary: {
      border: 0,
      borderRadius: 22,
      background: "white",
      color: "#020617",
      padding: "16px 24px",
      fontWeight: 800,
      fontSize: 16,
      cursor: "pointer",
    },
    secondary: {
      border: "1px solid rgba(255,255,255,.18)",
      borderRadius: 22,
      background: "rgba(255,255,255,.06)",
      color: "white",
      padding: "16px 24px",
      fontWeight: 800,
      fontSize: 16,
      cursor: "pointer",
    },
    card: {
      border: "1px solid rgba(255,255,255,.12)",
      background: "rgba(255,255,255,.08)",
      borderRadius: 36,
      padding: 28,
      boxShadow: "0 30px 80px rgba(0,0,0,.35)",
    },
    inner: {
      background: "rgba(2,6,23,.75)",
      borderRadius: 30,
      padding: 26,
      marginTop: 22,
    },
    textarea: {
      width: "100%",
      minHeight: 180,
      resize: "vertical",
      border: "1px solid rgba(255,255,255,.12)",
      borderRadius: 24,
      background: "transparent",
      color: "white",
      padding: 20,
      fontSize: 16,
      outline: "none",
      boxSizing: "border-box",
    },
    wide: {
      width: "100%",
      marginTop: 18,
      border: 0,
      borderRadius: 24,
      background: "white",
      color: "#020617",
      padding: "18px 22px",
      fontWeight: 900,
      fontSize: 16,
      cursor: "pointer",
    },
    error: {
      marginTop: 16,
      background: "rgba(220,38,38,.18)",
      color: "#fecaca",
      padding: 16,
      borderRadius: 18,
    },
    result: {
      marginTop: 24,
      border: "1px solid rgba(255,255,255,.12)",
      background: "rgba(255,255,255,.06)",
      borderRadius: 28,
      padding: 24,
    },
    label: { color: "#94a3b8", fontSize: 14, marginTop: 18, marginBottom: 6 },
    questionCard: {
      background: "rgba(255,255,255,.06)",
      borderRadius: 18,
      padding: 16,
      marginBottom: 14,
    },
    questionText: {
      fontWeight: 700,
      marginBottom: 10,
      lineHeight: 1.5,
    },
    answerInput: {
      width: "100%",
      minHeight: 80,
      resize: "vertical",
      border: "1px solid rgba(255,255,255,.12)",
      borderRadius: 16,
      background: "rgba(2,6,23,.55)",
      color: "white",
      padding: 14,
      fontSize: 15,
      outline: "none",
      boxSizing: "border-box",
    },
  };

  return (
    <div style={s.page}>
      <div style={s.wrap}>
        <header style={s.header}>
          <div>
            <div style={s.logo}>🧠 Точка опоры</div>
            <div style={s.sub}>анонимный скрининг состояния</div>
          </div>
          <button
            style={s.crisis}
            onClick={() => document.getElementById("crisis")?.scrollIntoView()}
          >
            ⚠ Мне срочно нужна помощь
          </button>
        </header>

        <main style={s.grid}>
          <section>
            <div style={s.badge}>
              Без имени. Без осуждения. Первый шаг — за 5–10 минут.
            </div>
            <h1 style={s.h1}>
              Расскажите, что с вами происходит — голосом или текстом.
            </h1>
            <p style={s.p}>
              Сервис поможет мягко разобрать состояние, определить возможный
              спектр проблемы и предложить понятный план действий.
            </p>

            <div style={s.row}>
              <button style={s.primary} onClick={() => setMode("voice")}>
                🎙 Рассказать голосом
              </button>
              <button style={s.secondary} onClick={() => setMode("text")}>
                ⌨ Написать текстом
              </button>
            </div>

            <p style={{ ...s.sub, marginTop: 24 }}>
              Сервис не ставит диагноз. Решение о диагнозе и лечении принимает
              врач.
            </p>
          </section>

          <section style={s.card}>
            <div style={s.sub}>Первичный вход</div>
            <div style={{ fontSize: 28, fontWeight: 900 }}>
              Анонимный разговор
            </div>

            <div style={s.inner}>
              {mode === "voice" ? (
                <div style={{ textAlign: "center", padding: "60px 20px" }}>
                  <div style={{ fontSize: 58 }}>🎙</div>
                  <h2>Голосовой режим</h2>
                  <p style={{ color: "#94a3b8" }}>
                    Запись голоса подключим следующим этапом. Сейчас работает
                    текстовый AI-скрининг.
                  </p>
                </div>
              ) : phase === "input" ? (
                <>
                  <textarea
                    style={s.textarea}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Например: последние месяцы я плохо сплю, тревожусь, не могу собраться, часто думаю о потере..."
                  />
                  <button
                    style={s.wide}
                    onClick={startScreening}
                    disabled={loading}
                  >
                    {loading
                      ? "Формируем вопросы..."
                      : "Начать анонимный разбор состояния"}
                  </button>
                </>
              ) : phase === "questions" ? (
                <>
                  <div style={{ marginBottom: 16, color: "#94a3b8" }}>
                    Ответьте на уточняющие вопросы:
                  </div>
                  {questions?.map((q, index) => (
                    <div key={index} style={s.questionCard}>
                      <div style={s.questionText}>
                        {index + 1}. {q}
                      </div>
                      <textarea
                        style={s.answerInput}
                        value={answers[index] || ""}
                        onChange={(e) =>
                          setAnswers({
                            ...answers,
                            [index]: e.target.value,
                          })
                        }
                        placeholder="Ваш ответ..."
                      />
                    </div>
                  ))}
                  <button
                    style={s.wide}
                    onClick={getFinalReport}
                    disabled={loading}
                  >
                    {loading
                      ? "Анализируем..."
                      : "Получить предварительный отчёт"}
                  </button>
                </>
              ) : null}

              {error && <div style={s.error}>{error}</div>}
            </div>

            {phase === "report" && result && (
              <div style={s.result}>
                <h2 style={{ marginTop: 0 }}>Предварительный отчёт</h2>
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
                  {result}
                </div>
                <button
                  style={{ ...s.wide, marginTop: 20 }}
                  onClick={handleReset}
                >
                  Начать заново
                </button>
              </div>
            )}
          </section>
        </main>

        <section
          id="crisis"
          style={{
            ...s.result,
            marginTop: 70,
            borderColor: "rgba(220,38,38,.35)",
          }}
        >
          <h2>Если вам очень плохо — не проходите опросник.</h2>
          <p style={s.p}>
            При угрозе жизни или безопасности нужно обращаться в экстренные
            службы: <b> 112</b> или <b>103</b>.
          </p>
        </section>
      </div>
    </div>
  );
}
