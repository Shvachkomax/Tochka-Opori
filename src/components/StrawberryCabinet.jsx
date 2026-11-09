import React, { useState } from "react";
import "./StrawberryWelcome.css";
import "./StrawberryCabinet.css";

/**
 * Support screen 05: minimal client cabinet.
 * preview=true uses fictional content and never calls patient APIs.
 * For real patient flows, all actions are delegated to existing App handlers.
 */
export default function StrawberryCabinet({
  preview = false, displayName = "", sessions = [], wallet = null,
  quickChatInput = "", onChatChange, onChatSend, chatBusy = false,
  onFollowUp, onOpenReport, onOpenHistory, onDiary, onSpecialistRequest,
  onFullCabinet, onExit, onAbout, onEmergency,
  crisisBlock = null, careRecommendation = null,
}) {
  const [previewMessage, setPreviewMessage] = useState("");
  const [previewNotice, setPreviewNotice] = useState(false);
  const sampleSessions = [
    { sessionId: "demo-01", createdAt: "2026-11-09T11:00:00", summary: "Первый разговор — пример записи", status: "first" },
    { sessionId: "demo-02", createdAt: "2026-11-08T11:00:00", summary: "Продолжение разговора — пример записи", status: "followup" },
  ];
  const history = preview ? sampleSessions : (Array.isArray(sessions) ? sessions : []);
  const latest = history[0] || null;
  const urgent = !preview && (crisisBlock?.emergencyRecommended || crisisBlock?.status === "safety_check_in_progress" || careRecommendation?.level === "urgent_help");
  const talkValue = preview ? previewMessage : quickChatInput;
  const dateLabel = date => {
    if (!date) return "—";
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  };
  function previewAction() { setPreviewNotice(true); }
  function sendMessage(event) {
    event.preventDefault();
    if (!talkValue.trim()) return;
    if (preview) { setPreviewNotice(true); return; }
    onChatSend?.();
  }

  return (
    <div className="strawberry-entry strawberry-cabinet">
      <div className="strawberry-entry__atmosphere" aria-hidden="true" />
      <header className="strawberry-entry__header">
        <div className="strawberry-entry__brand" aria-label="Земляничные поляны — Поддержка">
          <img className="strawberry-entry__brand-sprig" src="/strawberry-support-mark-v2.webp" alt="" width="66" height="70" />
          <span className="strawberry-entry__brand-type">
            <img className="strawberry-entry__wordmark" src="/strawberry-support-wordmark-v3.webp" alt="Земляничные поляны" width="320" height="56" />
            <span className="strawberry-entry__brand-caption">ПОДДЕРЖКА</span>
          </span>
        </div>
        <nav className="strawberry-entry__nav" aria-label="Навигация">
          <button type="button" onClick={onAbout || previewAction}>О проекте</button>
          <button type="button" className="strawberry-entry__urgent" onClick={onEmergency || previewAction}>Срочная помощь</button>
        </nav>
      </header>
      <main className="strawberry-entry__main strawberry-cabinet__main">
        <p className="strawberry-cabinet__eyebrow">ВАШЕ ЛИЧНОЕ ПРОСТРАНСТВО</p>
        <h1>{displayName && !preview ? "Здравствуйте, " + displayName : "Здесь можно продолжить."}</h1>
        <p className="strawberry-entry__intro strawberry-cabinet__lead">
          Возвращайтесь к разговору, отмечайте своё состояние и выбирайте следующий шаг в удобном темпе.
        </p>

        {preview && <p className="strawberry-cabinet__preview">Визуальный пример — данные вымышлены, ничего не сохраняется.</p>}
        {urgent && <section className="strawberry-cabinet__urgent" role="alert">
          <strong>Сейчас важна безопасность.</strong>
          <p>Если вы можете быть в опасности, не ждите ответа сервиса. В России позвоните 112 или 103 и попросите близкого человека побыть рядом.</p>
          <div><a href="tel:112">Позвонить 112</a><a href="tel:103">Позвонить 103</a></div>
        </section>}

        <section className="strawberry-cabinet__block" aria-labelledby="strawberry-cabinet-talk">
          <h2 id="strawberry-cabinet-talk">Поговорим?</h2>
          <p>Можно написать несколько слов о том, что произошло сегодня.</p>
          <form onSubmit={sendMessage} className="strawberry-cabinet__chat-form">
            <label htmlFor="strawberry-cabinet-chat" className="strawberry-cabinet__visually-hidden">Ваше сообщение</label>
            <textarea id="strawberry-cabinet-chat" placeholder="Что сейчас у вас на душе?" rows={3}
              value={talkValue} onChange={event => preview ? setPreviewMessage(event.target.value) : onChatChange?.(event.target.value)}
              disabled={chatBusy || urgent} />
            <div className="strawberry-cabinet__actions">
              <button type="submit" className="strawberry-entry__action strawberry-entry__action--primary"
                disabled={!talkValue.trim() || chatBusy || urgent}>{chatBusy ? "Отвечаем…" : "Отправить"} <span aria-hidden="true">→</span></button>
              <button type="button" className="strawberry-cabinet__quiet-button" onClick={onFollowUp || previewAction} disabled={urgent}>Продолжить подробный разбор</button>
            </div>
          </form>
        </section>

        <section className="strawberry-cabinet__block" aria-labelledby="strawberry-cabinet-latest">
          <h2 id="strawberry-cabinet-latest">Последний разговор</h2>
          {latest ? <>
            <p className="strawberry-cabinet__date">{dateLabel(latest.createdAt)}</p>
            <p>{latest.summary || "Разговор сохранён в вашей истории."}</p>
            <button className="strawberry-cabinet__quiet-button" type="button"
              onClick={() => (onOpenReport || previewAction)(latest.sessionId)}>Посмотреть разбор <span aria-hidden="true">→</span></button>
          </> : <p>Здесь появится ваша первая беседа.</p>}
        </section>

        <section className="strawberry-cabinet__block" aria-labelledby="strawberry-cabinet-steps">
          <h2 id="strawberry-cabinet-steps">Что можно сделать дальше</h2>
          <div className="strawberry-cabinet__links">
            <button type="button" onClick={onDiary || previewAction}>Как вы сегодня? <small>Дневник состояния</small><span aria-hidden="true">→</span></button>
            <button type="button" onClick={onOpenHistory || previewAction}>Вернуться к прежним разговорам <small>История и результаты</small><span aria-hidden="true">→</span></button>
            <button type="button" onClick={onSpecialistRequest || previewAction}>Связаться со специалистом <small>Помощь человека</small><span aria-hidden="true">→</span></button>
          </div>
        </section>

        {wallet?.visible && !preview && <p className="strawberry-cabinet__credits">Доступно {Number(wallet.available_credits ?? 0).toLocaleString("ru-RU")} условных кредитов</p>}
        {previewNotice && <p role="status" className="strawberry-cabinet__preview">Это визуальный пример. Кнопка в деморежиме не выполняет действие.</p>}
        <div className="strawberry-cabinet__bottom">
          {!preview && <button type="button" className="strawberry-cabinet__quiet-button" onClick={onFullCabinet}>Открыть все функции кабинета</button>}
          <button type="button" className="strawberry-cabinet__quiet-button" onClick={onExit || (() => { window.location.href = "/strawberry-support"; })}>
            {preview ? "На первую страницу" : "Выйти"}
          </button>
        </div>
      </main>
      <footer className="strawberry-entry__footer">
        <span>Поддержка не заменяет экстренную помощь или консультацию врача.</span>
        <span>{preview ? "Демонстрация оформления" : "Тестовый сервис — без реальных пациентских данных"}</span>
      </footer>
    </div>
  );
}
