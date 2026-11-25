import React, { useEffect, useState } from "react";
import "./StrawberryWelcome.css";
import "./StrawberryInformation.css";

// Тексты основаны на существующем разделе «О проекте» Support.
// Информационные приглашения не требуют сессии и не обращаются к API пациента.
const ITEMS = [
  { label: "Первый шаг", title: "Начните с того, что беспокоит.",
    body: "Несколько слов голосом или текстом — достаточно, чтобы начать разговор." },
  { label: "Без спешки", title: "Не нужно искать правильные формулировки.",
    body: "Можно рассказывать своими словами. Вопросы помогут прояснить, что происходит." },
  { label: "Понимание", title: "Несколько уточняющих вопросов.",
    body: "Сервис поможет заметить главное и выбрать возможный следующий шаг." },
  { label: "Продолжение", title: "К разговору можно вернуться.",
    body: "Сохраните код продолжения, чтобы позже открыть свою историю и продолжить диалог." },
  { label: "Человек рядом", title: "При необходимости — специалист.",
    body: "Вы сами решаете, когда обратиться за профессиональной поддержкой." },
  { label: "Ваш выбор", title: "Первый разговор может быть анонимным.",
    body: "Вы сами решаете, продолжать ли общение и обращаться ли к специалисту." },
];

export function StrawberryInfoCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [manualPause, setManualPause] = useState(false);
  useEffect(() => {
    if (paused || manualPause) return undefined;
    const media = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (media?.matches) return undefined;
    const id = window.setInterval(() => setIndex(v => (v + 1) % ITEMS.length), 6800);
    return () => window.clearInterval(id);
  }, [paused, manualPause]);

  // Five readable lines, with the current message in the centre.
  // No visual borders: this should look like text gently moving on white paper.
  const nearby = [-2, -1, 0, 1, 2].map(offset => ({
    itemIndex: (index + offset + ITEMS.length) % ITEMS.length,
    offset
  }));
  const current = ITEMS[index];

  return (
    <section className="strawberry-information__carousel" aria-label="Информационная лента о поддержке"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); }}>
      <div className="strawberry-information__carousel-top">
        <span>ВАЖНО ЗНАТЬ О ПОДДЕРЖКЕ</span>
        <span className="strawberry-information__carousel-count" aria-label={"Сообщение " + (index + 1) + " из " + ITEMS.length}>
          {String(index + 1).padStart(2, "0")} / {String(ITEMS.length).padStart(2, "0")}
        </span>
      </div>
      <div className="strawberry-information__carousel-list" aria-label="Сообщения">
        {nearby.map(({ itemIndex, offset }) => (
          <button type="button" key={offset}
            className={"strawberry-information__carousel-line" + (offset === 0 ? " is-current" : "")}
            aria-current={offset === 0 ? "true" : undefined}
            aria-label={ITEMS[itemIndex].title}
            onClick={() => setIndex(itemIndex)}>
            <span className="strawberry-information__carousel-dot" aria-hidden="true">{offset === 0 ? "•" : "·"}</span>
            {ITEMS[itemIndex].title}
          </button>
        ))}
      </div>
      <p className="strawberry-information__carousel-description" aria-live="off" key={"description-" + index}>
        {current.body}
      </p>
      <div className="strawberry-information__carousel-controls">
        <button type="button" onClick={() => setIndex(v => (v + ITEMS.length - 1) % ITEMS.length)}
          aria-label="Предыдущее сообщение">←</button>
        <button type="button" onClick={() => setIndex(v => (v + 1) % ITEMS.length)}
          aria-label="Следующее сообщение">→</button>
        <button type="button" className="strawberry-information__pause"
          onClick={() => setManualPause(v => !v)} aria-pressed={manualPause}>
          {manualPause ? "Продолжить" : "Пауза"}
        </button>
      </div>
    </section>
  );
}

export default function StrawberryAbout({ onBack, onWrite, onCrisis, onSpecialist }) {
  const [previewCrisis, setPreviewCrisis] = useState(false);
  return (
    <div className="strawberry-entry strawberry-information__about">
      <div className="strawberry-entry__atmosphere" aria-hidden="true" />
      <header className="strawberry-entry__header">
        <button type="button" onClick={onBack}
          className="strawberry-entry__brand strawberry-information__brand" aria-label="Вернуться назад">
          <img className="strawberry-entry__brand-sprig" src="/strawberry-support-mark-v2.webp" alt="" width="66" height="70" />
          <span className="strawberry-entry__brand-type">
            <img className="strawberry-entry__wordmark" src="/strawberry-support-wordmark-v3.webp" alt="Земляничные поляны" width="320" height="56" />
            <span className="strawberry-entry__brand-caption">ПОДДЕРЖКА</span>
          </span>
        </button>
        <nav className="strawberry-entry__nav" aria-label="Навигация">
          <button type="button" onClick={onBack}>Вернуться</button>
          <button type="button" onClick={onSpecialist}>Кабинет специалиста</button>
          <button type="button" className="strawberry-entry__urgent" onClick={onCrisis || (() => setPreviewCrisis(value => !value))}>Срочная помощь</button>
        </nav>
      </header>
      <main className="strawberry-entry__main strawberry-information__about-main">
        <p className="strawberry-information__eyebrow">ЗЕМЛЯНИЧНЫЕ ПОЛЯНЫ · ПОДДЕРЖКА</p>
        <h1>Когда непросто, начните с понимания.</h1>
        <p className="strawberry-entry__intro strawberry-information__lead">
          Здесь можно рассказать о тревоге, тоске, растерянности, потере или другом сложном периоде — своими словами и в удобном темпе.
        </p>
        {previewCrisis && (
          <section className="strawberry-information__emergency" role="alert">
            <strong>Если помощь нужна прямо сейчас</strong>
            <p>При непосредственной угрозе жизни или безопасности не ждите ответа сервиса. В России — 112 или 103, в других странах — местный экстренный номер.</p>
            <a href="tel:112">Позвонить 112</a> <a href="tel:103">Позвонить 103</a>
          </section>
        )}
        <div className="strawberry-information__chapters">
          <section>
            <span>01 · Начало</span>
            <h2>Можно просто начать говорить.</h2>
            <p>Опишите голосом или текстом, что происходит и что вас беспокоит. Заранее знать, как сформулировать проблему, не требуется.</p>
          </section>
          <section>
            <span>02 · Разговор</span>
            <h2>Несколько вопросов помогут разобраться.</h2>
            <p>Сервис задаст уточняющие вопросы и подготовит предварительный бережный разбор — на что обратить внимание и куда можно двигаться дальше.</p>
          </section>
          <section>
            <span>03 · Возвращение</span>
            <h2>Историю можно продолжить.</h2>
            <p>Первый разговор может остаться анонимным. Если захотите вернуться, сохраните код продолжения — он позволяет снова открыть доступ к вашей истории.</p>
          </section>
          <section>
            <span>04 · Поддержка человека</span>
            <h2>При необходимости подключается специалист.</h2>
            <p>Вы можете обратиться к специалисту через кабинет. Если хотите общаться со своим врачом, можно создать приглашение для него.</p>
          </section>
        </div>
        <p className="strawberry-information__notice">
          Это сервис предварительной поддержки, не медицинский диагноз и не замена врачу. Не меняйте назначения и дозировки самостоятельно. При непосредственной угрозе жизни или безопасности обращайтесь за экстренной помощью: в России 112 или 103, в других странах — местный номер.
        </p>
        <div className="strawberry-information__actions">
          <button type="button" className="strawberry-entry__action strawberry-entry__action--primary" onClick={onWrite}>Начать разговор <span aria-hidden="true">→</span></button>
          <button type="button" className="strawberry-information__quiet" onClick={onBack}>Вернуться назад</button>
        </div>
      </main>
      <footer className="strawberry-entry__footer">
        <span>Предварительная поддержка, не медицинское заключение.</span>
        <span>Земляничные поляны · Поддержка</span>
      </footer>
    </div>
  );
}
