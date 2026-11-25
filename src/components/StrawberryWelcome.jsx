import React, { useState } from "react";
import "./StrawberryWelcome.css";
import { StrawberryInfoCarousel } from "./StrawberryInformation.jsx";

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
          <img className="strawberry-entry__brand-sprig" src="/strawberry-support-mark-v2.webp" alt="" width="66" height="70" />
          <span className="strawberry-entry__brand-type">
            <img className="strawberry-entry__wordmark" src="/strawberry-support-wordmark-v3.webp" alt="Земляничные поляны" width="320" height="56" />
            <span className="strawberry-entry__brand-caption">ПОДДЕРЖКА</span>
          </span>
        </a>
        <nav aria-label="Навигация" className="strawberry-entry__nav">
          <button type="button" onClick={onAbout}>О проекте</button>
          <button type="button" onClick={onSpecialist}>Кабинет специалиста</button>
          <button type="button" className="strawberry-entry__urgent" onClick={onCrisis}>Срочная помощь</button>
        </nav>
      </header>

      <main className="strawberry-entry__main strawberry-entry__main--welcome">
        <section className="strawberry-entry__welcome-intro" aria-labelledby="strawberry-welcome-title">
          <h1 id="strawberry-welcome-title">Когда непросто,<br />можно поговорить.</h1>
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
        </section>
        <aside className="strawberry-entry__welcome-air" aria-label="Информация о поддержке">
          <StrawberryInfoCarousel />
          <div className="strawberry-entry__features" aria-label="Возможности сервиса">
            <span>Анонимный разговор</span>
            <span>Поддержка ИИ</span>
            <span>При необходимости — специалист</span>
          </div>
        </aside>
      </main>
      <footer className="strawberry-entry__footer">
        <span>Предварительная поддержка, не медицинский диагноз.</span>
        <span>Пожалуйста, не вводите здесь сведения реальных пациентов.</span>
      </footer>
    </div>
  );
}
