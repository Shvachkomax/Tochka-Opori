import React, { useState } from "react";
import "./StrawberryWelcome.css";

/**
 * Экран 01 новой ветки «Земляничные поляны — Поддержка».
 * Колбэки приходят из App.jsx — ни один пациентский API здесь не дублируется.
 */
export default function StrawberryWelcome({
  onStartVoice,
  onWrite,
  onResume,
  onAbout,
  onCrisis,
  onSpecialist,
}) {
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState("");

  async function startVoice() {
    if (busy) return;
    setBusy(true);
    setStartError("");
    try {
      await onStartVoice();
    } catch (error) {
      setStartError(error?.message || "Не удалось начать запись. Попробуйте текстовый ввод.");
      setBusy(false);
    }
  }

  return (
    <div className="strawberry-entry">
      <div className="strawberry-entry__atmosphere" aria-hidden="true" />
      <header className="strawberry-entry__header">
        <a className="strawberry-entry__brand" href="/strawberry-support" aria-label="Земляничные поляны — Поддержка. На главную">
          <img src="/strawberry-support-mark-v2.webp" alt="" width="68" height="72" />
          <span>
            <span className="strawberry-entry__brand-name">Земляничные поляны</span>
            <span className="strawberry-entry__brand-caption">ПОДДЕРЖКА</span>
          </span>
        </a>
        <nav aria-label="Навигация" className="strawberry-entry__nav">
          <button type="button" onClick={onAbout}>О проекте</button>
          <button type="button" onClick={onSpecialist}>Кабинет специалиста</button>
          <button type="button" className="strawberry-entry__urgent" onClick={onCrisis}>Срочная помощь</button>
        </nav>
      </header>

      <main className="strawberry-entry__main">
        <p className="strawberry-entry__eyebrow">ЗЕМЛЯНИЧНЫЕ ПОЛЯНЫ / ПОДДЕРЖКА</p>
        <h1>Когда непросто,<br />можно поговорить.</h1>
        <p className="strawberry-entry__intro">
          Расскажите, что с вами происходит — голосом или текстом.
          Поможем разобраться в ситуации и найти следующий шаг.
        </p>
        <div className="strawberry-entry__actions">
          <button type="button" className="strawberry-entry__action strawberry-entry__action--primary" disabled={busy} onClick={startVoice}>
            {busy ? "Открываем запись…" : "Рассказать голосом"}
            <span aria-hidden="true">↗</span>
          </button>
          <button type="button" className="strawberry-entry__action strawberry-entry__action--quiet" onClick={onWrite}>
            Написать сообщение <span aria-hidden="true">→</span>
          </button>
        </div>
        {startError && <p className="strawberry-entry__error" role="alert">{startError}</p>}
        <button type="button" className="strawberry-entry__resume" onClick={onResume}>У меня уже есть код продолжения</button>
        <div className="strawberry-entry__features" aria-label="Возможности сервиса">
          <span>Анонимный разговор</span>
          <span>Поддержка ИИ</span>
          <span>При необходимости — специалист</span>
        </div>
      </main>
      <footer className="strawberry-entry__footer">
        <span>Предварительная поддержка, не медицинский диагноз.</span>
        <span>Тестовый дизайн · не вводите реальные данные пациентов.</span>
      </footer>
    </div>
  );
}
