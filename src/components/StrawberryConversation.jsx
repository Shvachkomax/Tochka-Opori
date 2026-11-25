import React from "react";
import "./StrawberryWelcome.css";
import "./StrawberryConversation.css";

/**
 * Экран 02 — начало обращения. Ввод и запись связаны с действующими
 * обработчиками Support; отдельной базы и тестовой медицинской логики нет.
 */
export default function StrawberryConversation({
  text, onChangeText, onSubmit, loading, loadingMessage, error,
  recording, recordingTime, transcribing, voiceError,
  onStartRecording, onStopRecording, onBack, onAbout, onCrisis, onSpecialist,
}) {
  const [startingAudio, setStartingAudio] = React.useState(false);
  const [micError, setMicError] = React.useState("");
  const canSubmit = text.trim().length >= 10 && !loading && !recording && !transcribing;
  async function toggleRecording() {
    setMicError("");
    if (recording) {
      onStopRecording();
      return;
    }
    if (startingAudio || transcribing) return;
    setStartingAudio(true);
    try { await onStartRecording(); }
    catch (e) { setMicError(e?.message || "Не удалось включить микрофон."); }
    finally { setStartingAudio(false); }
  }
  return (
    <div className="strawberry-entry strawberry-conversation">
      <div className="strawberry-entry__atmosphere" aria-hidden="true" />
      <header className="strawberry-entry__header">
        <button className="strawberry-entry__brand strawberry-conversation__home" type="button" onClick={onBack} aria-label="Вернуться на первую страницу">
          <img className="strawberry-entry__brand-sprig" src="/strawberry-support-mark-v2.webp" alt="" width="66" height="70" />
          <span className="strawberry-entry__brand-type">
            <img className="strawberry-entry__wordmark" src="/strawberry-support-wordmark-v3.webp" alt="Земляничные поляны" width="320" height="56" />
            <span className="strawberry-entry__brand-caption">ПОДДЕРЖКА</span>
          </span>
        </button>
        <nav aria-label="Навигация" className="strawberry-entry__nav">
          <button type="button" onClick={onAbout}>О проекте</button>
          <button type="button" onClick={onSpecialist}>Кабинет специалиста</button>
          <button type="button" className="strawberry-entry__urgent" onClick={onCrisis}>Срочная помощь</button>
        </nav>
      </header>

      <main className="strawberry-entry__main strawberry-conversation__main">
        <button type="button" className="strawberry-conversation__back" onClick={onBack}>← Назад</button>
        <h1>С чего начнём?</h1>
        <p className="strawberry-entry__intro strawberry-conversation__lead">
          Можно рассказать своими словами. Здесь не нужно искать правильные формулировки.
        </p>
        <form className="strawberry-conversation__form" onSubmit={(e) => { e.preventDefault(); if(canSubmit) onSubmit(); }}>
          <label className="strawberry-conversation__label" htmlFor="strawberry-support-message">Ваше сообщение</label>
          <textarea id="strawberry-support-message" value={text} onChange={e => onChangeText(e.target.value)}
            placeholder="Например: последнее время мне тревожно, плохо сплю…" rows={5} autoFocus
            disabled={loading || recording || transcribing} />
          <div className="strawberry-conversation__actions">
            <button type="submit" className="strawberry-entry__action strawberry-entry__action--primary" disabled={!canSubmit}>
              {loading ? loadingMessage || "Разбираемся…" : "Продолжить"} <span aria-hidden="true">→</span>
            </button>
            <button type="button" className="strawberry-entry__action strawberry-entry__action--quiet" onClick={toggleRecording} disabled={loading || startingAudio || transcribing}>
              <span aria-hidden="true">{recording ? "■" : "◦"}</span>
              {transcribing ? "Расшифровываем…" : startingAudio ? "Включаем микрофон…" : recording ? "Остановить запись" : "Рассказать голосом"}
            </button>
          </div>
          {recording && <p className="strawberry-conversation__status" role="status">Идёт запись: {recordingTime} сек / 60 сек</p>}
          {(error || voiceError || micError) && <p className="strawberry-entry__error" role="alert">{error || voiceError || micError}</p>}
          {text.trim().length > 0 && text.trim().length < 10 && <p className="strawberry-conversation__hint">Напишите ещё немного, чтобы продолжить разговор.</p>}
          <p className="strawberry-conversation__assurance">Анонимно. Без оценок. В любой момент можно остановиться.</p>
        </form>
      </main>
      <footer className="strawberry-entry__footer">
        <span>Этот сервис не заменяет экстренную помощь или медицинскую консультацию.</span>
        <span>Тестовая версия · не вводите реальные данные пациентов.</span>
      </footer>
    </div>
  );
}
