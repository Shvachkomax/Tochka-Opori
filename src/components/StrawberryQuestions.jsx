import React, { useState } from "react";
import "./StrawberryWelcome.css";
import "./StrawberryConversation.css";
import "./StrawberryQuestions.css";

/** Third screen reuses the existing Support questions, analysis and speech APIs. */
export default function StrawberryQuestions({
  questions, answers, onAnswer, dialogDepth, crisisMode,
  onContinue, loading, loadingMessage, error, voiceError,
  recordingQuestionIndex, questionRecordingTime, questionTranscribingIndex,
  onStartRecording, onStopRecording,
  onBack, onAbout, onCrisis, onSpecialist,
}) {
  const [startingMic, setStartingMic] = useState(null);
  const [micError, setMicError] = useState("");
  const [stoppingMic, setStoppingMic] = useState(null);
  React.useEffect(() => {
    if (recordingQuestionIndex === null && questionTranscribingIndex === null) setStoppingMic(null);
  }, [recordingQuestionIndex, questionTranscribingIndex]);
  const items = Array.isArray(questions) ? questions.filter(q => typeof q === "string" && q.trim()) : [];
  const busyVoice = startingMic !== null || recordingQuestionIndex !== null || questionTranscribingIndex !== null;
  const busy = loading || busyVoice;

  async function toggleMicrophone(index) {
    setMicError("");
    if (recordingQuestionIndex === index) {
      if (stoppingMic !== index) {
        setStoppingMic(index);
        onStopRecording();
      }
      return;
    }
    if (busy) return;
    setStartingMic(index);
    try {
      await onStartRecording(index);
    } catch (e) {
      setMicError(e?.message || "Не удалось включить микрофон. Можно ответить текстом.");
    } finally {
      setStartingMic(null);
    }
  }

  return (
    <div className="strawberry-entry strawberry-conversation strawberry-questions">
      <div className="strawberry-entry__atmosphere" aria-hidden="true" />
      <header className="strawberry-entry__header">
        <button className="strawberry-entry__brand strawberry-conversation__home" type="button" onClick={onBack} disabled={busy || crisisMode} aria-label="Начать разговор заново">
          <img className="strawberry-entry__brand-sprig" src="/strawberry-support-mark-v2.webp" alt="" width="66" height="70" />
          <span className="strawberry-entry__brand-type">
            <img className="strawberry-entry__wordmark" src="/strawberry-support-wordmark-v3.webp" alt="Земляничные поляны" width="320" height="56" />
            <span className="strawberry-entry__brand-caption">ПОДДЕРЖКА</span>
          </span>
        </button>
        <nav aria-label="Навигация" className="strawberry-entry__nav">
          <button type="button" onClick={onAbout} disabled={busy}>О проекте</button>
          <button type="button" onClick={onSpecialist} disabled={busy}>Кабинет специалиста</button>
          <button type="button" className="strawberry-entry__urgent" onClick={onCrisis}>Срочная помощь</button>
        </nav>
      </header>

      <main className="strawberry-entry__main strawberry-questions__main">
        {!crisisMode && (
          <button type="button" className="strawberry-conversation__back" onClick={onBack} disabled={busy}>← Начать заново</button>
        )}
        <p className="strawberry-questions__eyebrow">
          {crisisMode ? "ВАЖНО" : "ВАШ РАЗГОВОР"} <span aria-hidden="true">·</span> {crisisMode ? "СНАЧАЛА — БЕЗОПАСНОСТЬ" : "УТОЧНЯЮЩИЕ ВОПРОСЫ"}
        </p>
        <h1>{crisisMode ? "Сначала — ваша безопасность." : "Хочется понять вас точнее."}</h1>
        <p className="strawberry-entry__intro strawberry-questions__lead">
          {crisisMode
            ? "Ответьте, пожалуйста, на несколько коротких вопросов. Если сейчас небезопасно, не ждите ответа сервиса."
            : "Несколько вопросов помогут разобраться в происходящем. Отвечайте своими словами, в удобном темпе."}
        </p>

        {crisisMode && (
          <section className="strawberry-questions__safety" role="alert" aria-label="Срочная помощь">
            <strong>Если существует непосредственная опасность</strong>
            <p>Если вы можете причинить вред себе или другому человеку либо не уверены, что останетесь в безопасности, обратитесь за экстренной помощью сейчас. В России — 112 или 103; в других странах — местный экстренный номер. По возможности попросите близкого человека побыть рядом.</p>
            <div className="strawberry-questions__emergency-links">
              <a href="tel:112">Позвонить 112</a>
              <a href="tel:103">Позвонить 103</a>
            </div>
            <p className="strawberry-questions__safety-footnote">Сервис не является экстренной службой и не может гарантировать немедленную помощь.</p>
          </section>
        )}

        <section className="strawberry-questions__items" aria-label="Вопросы для уточнения">
          {items.map((question, index) => {
            const isRecording = recordingQuestionIndex === index;
            const isTranscribing = questionTranscribingIndex === index;
            const isStarting = startingMic === index;
            return (
              <div className="strawberry-questions__item" key={index}>
                <div className="strawberry-questions__number">Вопрос {index + 1} из {items.length}</div>
                <label className="strawberry-questions__prompt" htmlFor={"strawberry-question-" + index}>{question}</label>
                <textarea
                  id={"strawberry-question-" + index}
                  value={answers?.[index] || ""}
                  onChange={event => onAnswer(index, event.target.value)}
                  placeholder="Ваш ответ…"
                  rows={3}
                  disabled={loading || isRecording || isTranscribing}
                />
                <div className="strawberry-questions__item-tools">
                  <button type="button" className="strawberry-questions__voice" onClick={() => toggleMicrophone(index)}
                    disabled={loading || isTranscribing || isStarting || stoppingMic === index || (busyVoice && !isRecording)}>
                    <span aria-hidden="true">{isRecording ? "■" : "◦"}</span>
                    {isTranscribing ? "Расшифровываем…" : isStarting ? "Включаем микрофон…" : isRecording ? (stoppingMic === index ? "Завершаем запись…" : "Остановить запись") : "Ответить голосом"}
                  </button>
                  {isRecording && <span className="strawberry-questions__recording" role="status">Запись: {questionRecordingTime} / 60 сек</span>}
                </div>
              </div>
            );
          })}
        </section>

        {(error || voiceError || micError) && <p className="strawberry-entry__error" role="alert">{error || voiceError || micError}</p>}
        <div className="strawberry-questions__footer-actions">
          <button type="button" className="strawberry-entry__action strawberry-entry__action--primary" onClick={onContinue} disabled={busy || items.length === 0}>
            {loading ? loadingMessage || "Разбираемся…" : dialogDepth >= 3 ? "Продолжить к результату" : "Продолжить разговор"}
            <span aria-hidden="true">→</span>
          </button>
          <p>Можно отвечать кратко и пропускать то, о чём пока трудно говорить.</p>
        </div>
      </main>
      <footer className="strawberry-entry__footer">
        <span>Бережный разбор, не медицинский диагноз.</span>
        <span>Тестовая версия · не вводите реальные данные пациентов.</span>
      </footer>
    </div>
  );
}
