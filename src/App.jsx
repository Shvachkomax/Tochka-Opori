import React, { useRef, useState } from "react";

export default function App() {
  const [mode, setMode] = useState("text");
  const [text, setText] = useState("");
  const [questions, setQuestions] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [phase, setPhase] = useState("input");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("user");
  const [crisisOpen, setCrisisOpen] = useState(false);
  const [crisisText, setCrisisText] = useState("");
  const [crisisContact, setCrisisContact] = useState("");
  const [crisisSubmitted, setCrisisSubmitted] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);

  const [expertMode, setExpertMode] = useState(false);
  const [expertNotes, setExpertNotes] = useState({
    aiIssue: "",
    missingQuestions: "",
    wrongQuestions: "",
    correctedLogic: "",
    protocolUpdate: "",
  });

  const [recordingQuestionIndex, setRecordingQuestionIndex] = useState(null);
  const [questionRecordingTime, setQuestionRecordingTime] = useState(0);
  const [questionTranscribingIndex, setQuestionTranscribingIndex] = useState(null);

  const questionMediaRecorderRef = useRef(null);
  const questionAudioChunksRef = useRef([]);
  const questionTimerRef = useRef(null);

  function handleCrisisSubmit() {
    setCrisisSubmitted(true);
  }

  function handleCrisisContinue() {
    if (crisisText.trim()) {
      setText(crisisText);
      setMode("text");
    }
    setCrisisOpen(false);
    setCrisisSubmitted(false);
    setCrisisText("");
    setCrisisContact("");
  }

  function handleCrisisClose() {
    setCrisisOpen(false);
    setCrisisSubmitted(false);
    setCrisisText("");
    setCrisisContact("");
  }

  async function startRecording() {
    setVoiceError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });

        setTranscribing(true);

        try {
          const response = await fetch("/api/transcribe", {
            method: "POST",
            headers: {
              "Content-Type": "audio/webm",
            },
            body: audioBlob,
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || "Не удалось расшифровать голос");
          }

          setText(data.text || "");
          setMode("text");
        } catch (error) {
          setVoiceError(error.message || "Ошибка расшифровки");
        } finally {
          setTranscribing(false);
        }
      };

      recorder.start();
      setRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          const next = prev + 1;

          if (next >= 60) {
            stopRecording();
            setVoiceError("Запись автоматически остановлена через 60 секунд.");
            return 60;
          }

          return next;
        });
      }, 1000);
    } catch (error) {
      setVoiceError("Не удалось получить доступ к микрофону");
    }
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  }

  async function startQuestionRecording(index) {
    setVoiceError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const recorder = new MediaRecorder(stream);
      questionMediaRecorderRef.current = recorder;
      questionAudioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          questionAudioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        if (questionTimerRef.current) {
          clearInterval(questionTimerRef.current);
        }

        const audioBlob = new Blob(questionAudioChunksRef.current, {
          type: "audio/webm",
        });

        setQuestionTranscribingIndex(index);

        try {
          const response = await fetch("/api/transcribe", {
            method: "POST",
            headers: {
              "Content-Type": "audio/webm",
            },
            body: audioBlob,
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || "Не удалось расшифровать голос");
          }

          setAnswers((prev) => ({
            ...prev,
            [index]: data.text || "",
          }));
        } catch (error) {
          setVoiceError(error.message || "Ошибка расшифровки");
        } finally {
          setQuestionTranscribingIndex(null);
          setRecordingQuestionIndex(null);
          setQuestionRecordingTime(0);
        }
      };

      recorder.start();
      setRecordingQuestionIndex(index);
      setQuestionRecordingTime(0);

      questionTimerRef.current = setInterval(() => {
        setQuestionRecordingTime((prev) => {
          const next = prev + 1;

          if (next >= 60) {
            stopQuestionRecording();
            return 60;
          }

          return next;
        });
      }, 1000);
    } catch (error) {
      setVoiceError("Не удалось получить доступ к микрофону");
    }
  }

  function stopQuestionRecording() {
    if (questionTimerRef.current) {
      clearInterval(questionTimerRef.current);
    }

    if (questionMediaRecorderRef.current && recordingQuestionIndex !== null) {
      questionMediaRecorderRef.current.stop();
    }
  }

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
      setActiveTab("user");
      setPhase("report");
    } catch (e) {
      setError(e.message || "Не удалось получить отчёт.");
    } finally {
      setLoading(false);
    }
  }

  const userPart = result
    ? result.split("===DOCTOR_REPORT===")[0]
        .replace("===USER_REPORT===", "")
        .trim()
    : "";

  const doctorPart = result
    ? result.split("===DOCTOR_REPORT===")[1]?.trim() || ""
    : "";

  function handleReset() {
    setPhase("input");
    setQuestions(null);
    setAnswers({});
    setResult(null);
    setText("");
    setError("");
    setActiveTab("user");
    setExpertMode(false);
    setExpertNotes({
      aiIssue: "",
      missingQuestions: "",
      wrongQuestions: "",
      correctedLogic: "",
      protocolUpdate: "",
    });
    setRecording(false);
    setTranscribing(false);
    setVoiceError("");
    setRecordingTime(0);
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    setRecordingQuestionIndex(null);
    setQuestionRecordingTime(0);
    setQuestionTranscribingIndex(null);
    if (questionTimerRef.current) {
      clearInterval(questionTimerRef.current);
    }
    setCrisisOpen(false);
    setCrisisSubmitted(false);
    setCrisisText("");
    setCrisisContact("");
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
    tabs: {
      display: "flex",
      gap: 10,
      marginBottom: 18,
    },
    tab: {
      border: "1px solid rgba(255,255,255,.12)",
      background: "rgba(255,255,255,.04)",
      color: "white",
      borderRadius: 14,
      padding: "10px 16px",
      cursor: "pointer",
    },
    activeTab: {
      border: "1px solid rgba(255,255,255,.18)",
      background: "white",
      color: "#020617",
      borderRadius: 14,
      padding: "10px 16px",
      fontWeight: 700,
      cursor: "pointer",
    },
    reportBlock: {
      background: "rgba(255,255,255,.05)",
      borderRadius: 20,
      padding: 20,
    },
    expertBox: {
      marginTop: 24,
      border: "1px solid rgba(255,255,255,.12)",
      background: "rgba(255,255,255,.05)",
      borderRadius: 24,
      padding: 20,
    },
    overlay: {
      position: "fixed",
      top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,.65)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
      padding: 20,
    },
    modal: {
      background: "#0f172a",
      borderRadius: 28,
      padding: 28,
      maxWidth: 560,
      width: "100%",
      border: "1px solid rgba(255,255,255,.1)",
      boxShadow: "0 30px 80px rgba(0,0,0,.5)",
    },
    modalTitle: {
      fontSize: 26,
      fontWeight: 900,
      marginBottom: 12,
    },
    modalWarning: {
      background: "rgba(220,38,38,.15)",
      color: "#fecaca",
      padding: 14,
      borderRadius: 16,
      fontSize: 15,
      lineHeight: 1.5,
      marginBottom: 20,
    },
    crisisTextarea: {
      width: "100%",
      minHeight: 100,
      resize: "vertical",
      border: "1px solid rgba(255,255,255,.12)",
      borderRadius: 16,
      background: "rgba(2,6,23,.55)",
      color: "white",
      padding: 14,
      fontSize: 15,
      outline: "none",
      boxSizing: "border-box",
      marginBottom: 14,
    },
    crisisInput: {
      width: "100%",
      border: "1px solid rgba(255,255,255,.12)",
      borderRadius: 16,
      background: "rgba(2,6,23,.55)",
      color: "white",
      padding: "14px 14px",
      fontSize: 15,
      outline: "none",
      boxSizing: "border-box",
      marginBottom: 20,
    },
    crisisActions: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
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
            <div style={s.sub}>Анонимно. Безопасно. Можно просто начать говорить.</div>
          </div>
          <button
            style={s.crisis}
            onClick={() => setCrisisOpen(true)}
          >
            ⚠ Мне срочно нужна помощь
          </button>
        </header>

        <main style={s.grid}>
          <section>
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
                <div style={{ textAlign: "center", padding: "40px 20px" }}>
                  <div style={{ fontSize: 58 }}>🎙</div>
                  <h2>Голосовой режим</h2>

                  <p style={{ color: "#94a3b8", lineHeight: 1.6 }}>
                    Нажмите "Начать запись", расскажите о своем состоянии, затем остановите запись.
                    Мы расшифруем голос и перенесем текст в обычное поле.
                  </p>

                  {!recording ? (
                    <button style={s.wide} onClick={startRecording} disabled={transcribing}>
                      {transcribing ? "Расшифровываем..." : "Начать запись"}
                    </button>
                  ) : (
                    <button style={{ ...s.wide, background: "#dc2626", color: "white" }} onClick={stopRecording}>
                      Остановить и расшифровать
                    </button>
                  )}

                  {voiceError && (
                    <div style={s.error}>
                      {voiceError}
                    </div>
                  )}

                  <div style={{
                    marginTop: 12,
                    color: recordingTime > 45 ? "#fca5a5" : "#94a3b8",
                    fontSize: 14
                  }}>
                    {recording
                      ? `Запись: ${recordingTime} сек / 60 сек`
                      : "Максимальная длительность записи — 1 минута"}
                  </div>
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

                      <button
                        style={{
                          ...s.secondary,
                          marginTop: 10,
                          width: "100%",
                        }}
                        onClick={() =>
                          recordingQuestionIndex === index
                            ? stopQuestionRecording()
                            : startQuestionRecording(index)
                        }
                        disabled={
                          questionTranscribingIndex !== null &&
                          questionTranscribingIndex !== index
                        }
                      >
                        {questionTranscribingIndex === index
                          ? "Расшифровываем..."
                          : recordingQuestionIndex === index
                            ? "Остановить и расшифровать"
                            : "Ответить голосом"}
                      </button>

                      {recordingQuestionIndex === index && (
                        <div
                          style={{
                            marginTop: 8,
                            color:
                              questionRecordingTime > 45
                                ? "#fca5a5"
                                : "#94a3b8",
                            fontSize: 14,
                          }}
                        >
                          Запись: {questionRecordingTime} сек / 60 сек
                        </div>
                      )}
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

                <div style={s.tabs}>
                  <button
                    style={activeTab === "user" ? s.activeTab : s.tab}
                    onClick={() => setActiveTab("user")}
                  >
                    Для вас
                  </button>
                  <button
                    style={activeTab === "doctor" ? s.activeTab : s.tab}
                    onClick={() => setActiveTab("doctor")}
                  >
                    Для специалиста
                  </button>
                </div>

                <div style={s.reportBlock}>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
                    {activeTab === "user" ? userPart : doctorPart}
                  </div>
                </div>

                <button
                  style={{ ...s.secondary, marginTop: 16 }}
                  onClick={() => setExpertMode(!expertMode)}
                >
                  Экспертная правка врача
                </button>

                {expertMode && (
                  <div style={s.expertBox}>
                    <h3 style={{ margin: "0 0 16px", fontSize: 18 }}>Экспертная правка врача</h3>

                    <label style={s.label}>Что AI сделал неправильно?</label>
                    <textarea
                      style={s.answerInput}
                      value={expertNotes.aiIssue}
                      onChange={(e) => setExpertNotes({ ...expertNotes, aiIssue: e.target.value })}
                      placeholder="Например: задал лишний вопрос, не уточнил триггер, неверно оценил риск..."
                    />

                    <label style={s.label}>Каких вопросов не хватило?</label>
                    <textarea
                      style={s.answerInput}
                      value={expertNotes.missingQuestions}
                      onChange={(e) => setExpertNotes({ ...expertNotes, missingQuestions: e.target.value })}
                      placeholder="Список недостающих вопросов..."
                    />

                    <label style={s.label}>Какие вопросы были лишними или неверными?</label>
                    <textarea
                      style={s.answerInput}
                      value={expertNotes.wrongQuestions}
                      onChange={(e) => setExpertNotes({ ...expertNotes, wrongQuestions: e.target.value })}
                      placeholder="Список лишних/неудачных вопросов..."
                    />

                    <label style={s.label}>Как должна выглядеть правильная логика?</label>
                    <textarea
                      style={s.answerInput}
                      value={expertNotes.correctedLogic}
                      onChange={(e) => setExpertNotes({ ...expertNotes, correctedLogic: e.target.value })}
                      placeholder="Опишите правильный clinical reasoning..."
                    />

                    <label style={s.label}>Что нужно добавить в протокол?</label>
                    <textarea
                      style={s.answerInput}
                      value={expertNotes.protocolUpdate}
                      onChange={(e) => setExpertNotes({ ...expertNotes, protocolUpdate: e.target.value })}
                      placeholder="Правило, которое нужно сохранить в clinical protocol..."
                    />

                    <button
                      style={s.wide}
                      onClick={() => {
                        const review = {
                          date: new Date().toISOString(),
                          patient_input: text,
                          questions,
                          answers,
                          ai_result: result,
                          ai_issue: expertNotes.aiIssue,
                          missing_questions: expertNotes.missingQuestions,
                          wrong_questions: expertNotes.wrongQuestions,
                          corrected_logic: expertNotes.correctedLogic,
                          protocol_update: expertNotes.protocolUpdate,
                        };

                        const blob = new Blob([JSON.stringify(review, null, 2)], {
                          type: "application/json",
                        });

                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `case-review-${Date.now()}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      Скачать экспертную правку JSON
                    </button>
                  </div>
                )}

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

        {crisisOpen && (
          <div style={s.overlay} onClick={handleCrisisClose}>
            <div style={s.modal} onClick={(e) => e.stopPropagation()}>
              {crisisSubmitted ? (
                <>
                  <div style={s.modalTitle}>Заявка принята</div>
                  <p style={{ ...s.p, marginTop: 12, marginBottom: 20 }}>
                    Если ситуация опасна прямо сейчас — не ждите ответа сервиса,
                    звоните <b>112</b> или <b>103</b>.
                  </p>
                  <button style={s.wide} onClick={handleCrisisClose}>
                    Закрыть
                  </button>
                </>
              ) : (
                <>
                  <div style={s.modalTitle}>Срочная помощь</div>
                  <div style={s.modalWarning}>
                    Если есть непосредственная угроза жизни или безопасности —
                    звоните <b>112</b> или <b>103</b>.
                  </div>
                  <textarea
                    style={s.crisisTextarea}
                    value={crisisText}
                    onChange={(e) => setCrisisText(e.target.value)}
                    placeholder="Что именно случилось?"
                  />
                  <input
                    style={s.crisisInput}
                    value={crisisContact}
                    onChange={(e) => setCrisisContact(e.target.value)}
                    placeholder="Телефон или Telegram для связи"
                  />
                  <div style={s.crisisActions}>
                    <button style={s.wide} onClick={handleCrisisSubmit}>
                      Жду звонка специалиста
                    </button>
                    <button
                      style={s.wide}
                      onClick={handleCrisisContinue}
                    >
                      Продолжить анонимный разбор
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
