import React, { useState } from "react";
import "./StrawberryWelcome.css";
import "./StrawberryPractices.css";

// Screen 07. Preview is fully local; real entries come from Support owner's practices.
const DEMO_PRACTICES = [
  {
    practice_key: "demo-grounding", title: "Заземление 5–4–3–2–1",
    description: "Внимание к тому, что можно увидеть, услышать и почувствовать вокруг.",
    duration_minutes: 5, status: "active", user_status: "not_tried",
    when_to_use: "Когда тревожные мысли отвлекают от настоящего момента.",
    instructions: [
      "Назовите пять предметов, которые видите.",
      "Отметьте четыре предмета, к которым можно прикоснуться.",
      "Прислушайтесь к трём звукам вокруг.",
      "Найдите два запаха и один вкус, если это комфортно."
    ],
    safety_note: "Если симптомы усиливаются, остановитесь."
  },
  {
    practice_key: "demo-relaxation", title: "Мягкое расслабление лица и челюсти",
    description: "Небольшая пауза, чтобы заметить и ослабить мышечное напряжение.",
    duration_minutes: 5, status: "active", user_status: "not_tried",
    when_to_use: "Если замечаете, что непроизвольно сжимаете челюсть.",
    instructions: [
      "Устройтесь удобно, заметив, насколько напряжено лицо.",
      "Осторожно разомкните зубы, без усилий.",
      "Позвольте лицу расслабиться и вернитесь к естественному дыханию."
    ],
    safety_note: "Не продолжайте при боли или дискомфорте в челюсти."
  },
  {
    practice_key: "demo-sleep", title: "Практика перед сном",
    description: "Спокойная подготовка ко сну без спешки и требования уснуть немедленно.",
    duration_minutes: 15, status: "active", user_status: "not_tried",
    when_to_use: "Когда сложно переключиться от дневных забот к отдыху.",
    instructions: [
      "Приглушите свет и по возможности отложите экран.",
      "Заметьте, где в теле ощущается напряжение.",
      "Представьте, что беспокоящие мысли можно отложить до завтра."
    ],
    safety_note: "Практика не заменяет помощь при сохраняющейся бессоннице."
  }
];
const STATUS_CHOICES = [
  { key: "tried", label: "Пробовал(а)" },
  { key: "helped", label: "Помогло" },
  { key: "not_helpful", label: "Не подошло" },
];
const STATUS_LABELS = {
  not_tried: "Ещё не пробовали", tried: "Пробовал(а)", helped: "Помогло", not_helpful: "Не подошло"
};
function cleanSteps(source) {
  return Array.isArray(source)
    ? source.map((entry) => typeof entry === "string" ? entry : entry?.text).filter(x => typeof x === "string" && x.trim())
    : [];
}

export default function StrawberryPractices({
  preview = false,
  practices = [],
  onBack, onAbout, onEmergency, onChangeStatus,
  loading = false, onRefresh, urgent = false,
}) {
  const [chosen, setChosen] = useState(null);
  const [demoStatuses, setDemoStatuses] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [showEmergency, setShowEmergency] = useState(false);
  const catalog = preview ? DEMO_PRACTICES : (Array.isArray(practices) ? practices.filter(p => p.status === "active") : []);
  const selected = catalog.find(item => item.practice_key === chosen) || null;
  const statusOf = entry => preview ? (demoStatuses[entry.practice_key] || entry.user_status) : entry.user_status;

  async function chooseStatus(entry, status) {
    setFeedback("");
    if (preview) {
      setDemoStatuses(p => ({ ...p, [entry.practice_key]: status }));
      setFeedback("В демонстрации статус изменён только на этом экране.");
      return;
    }
    if (!onChangeStatus || savingKey) return;
    setSavingKey(entry.practice_key);
    try {
      const ok = await onChangeStatus(entry.practice_key, status);
      setFeedback(ok ? "Статус сохранён." : "Не удалось сохранить статус. Попробуйте ещё раз.");
    } catch {
      setFeedback("Не удалось сохранить статус. Попробуйте ещё раз.");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="strawberry-entry strawberry-practices">
      <div className="strawberry-entry__atmosphere" aria-hidden="true" />
      <header className="strawberry-entry__header">
        <button type="button" className="strawberry-entry__brand strawberry-practices__brand"
          onClick={onBack} aria-label="Вернуться в кабинет">
          <img className="strawberry-entry__brand-sprig" src="/strawberry-support-mark-v2.webp"
            alt="" width="66" height="70" />
          <span className="strawberry-entry__brand-type">
            <img className="strawberry-entry__wordmark" src="/strawberry-support-wordmark-v3.webp"
              alt="Земляничные поляны" width="320" height="56" />
            <span className="strawberry-entry__brand-caption">ПОДДЕРЖКА</span>
          </span>
        </button>
        <nav className="strawberry-entry__nav" aria-label="Навигация">
          <button type="button" onClick={onAbout || (() => setFeedback("Это визуальная демонстрация. Сведения о проекте доступны в рабочем Support."))}>О проекте</button>
          <button type="button" className="strawberry-entry__urgent"
            onClick={onEmergency || (() => setShowEmergency(p => !p))}>Срочная помощь</button>
        </nav>
      </header>
      <main className="strawberry-entry__main strawberry-practices__main">
        <button type="button" className="strawberry-practices__back" onClick={onBack}>← В личный кабинет</button>
        <p className="strawberry-practices__eyebrow">НЕБОЛЬШИЕ ШАГИ · ДЛЯ СЕБЯ</p>
        <h1>Немного времени для себя.</h1>
        <p className="strawberry-entry__intro strawberry-practices__lead">
          Необязательно делать всё сразу. Выберите то, что подходит вам сегодня, и двигайтесь в своём ритме.
        </p>
        {preview && <p className="strawberry-practices__preview">Визуальный пример · действия здесь ничего не записывают в кабинет.</p>}

        {(showEmergency || urgent) && <section className="strawberry-practices__emergency" role="alert">
          <strong>Если нужна срочная помощь</strong>
          <p>При непосредственной опасности для жизни не ждите ответа сервиса. В России звоните 112 или 103, в других странах — местный номер экстренной помощи. По возможности попросите доверенного человека быть рядом.</p>
          <a href="tel:112">Позвонить 112</a>
        </section>}

        <section className="strawberry-practices__section" aria-labelledby="strawberry-practices-list">
          <h2 id="strawberry-practices-list">Ваши практики</h2>
          <p>{preview ? "Примеры коротких упражнений для знакомства с оформлением." :
            "Здесь собраны практики, предложенные вам в ходе разговоров."}</p>

          {loading && <p role="status" className="strawberry-practices__muted">Загружаем практики…</p>}
          {!loading && catalog.length === 0 &&
            <div className="strawberry-practices__empty">
              <p>Пока практик нет. Во время следующего разговора Support может предложить подходящие упражнения.</p>
              {onRefresh && <button type="button" className="strawberry-practices__link" onClick={onRefresh}>Проверить ещё раз</button>}
            </div>}
          {catalog.length > 0 && <div className="strawberry-practices__items">
            {catalog.map((p, index) => {
              const active = chosen === p.practice_key;
              return <div className={"strawberry-practices__item" + (active ? " is-active" : "")} key={p.practice_key || index}>
                <button type="button" className="strawberry-practices__item-button"
                  aria-expanded={active} onClick={() => { setChosen(active ? null : p.practice_key); setFeedback(""); }}>
                  <span className="strawberry-practices__item-content">
                    <span className="strawberry-practices__item-caption">
                      {p.duration_minutes ? p.duration_minutes + " мин" : "В своём темпе"}
                      <span aria-hidden="true">·</span> {STATUS_LABELS[statusOf(p)] || "Не пробовали"}
                    </span>
                    <span className="strawberry-practices__item-title">{p.title}</span>
                    <span className="strawberry-practices__item-desc">{p.description}</span>
                  </span>
                  <span className="strawberry-practices__chevron" aria-hidden="true">{active ? "−" : "+"}</span>
                </button>
                {active && <div className="strawberry-practices__detail">
                  {p.when_to_use && <p><strong>Когда может подойти:</strong> {p.when_to_use}</p>}
                  {cleanSteps(p.instructions).length > 0 && <>
                    <h3>Как попробовать</h3>
                    <ol>{cleanSteps(p.instructions).map((step, i) => <li key={i}>{step}</li>)}</ol>
                  </>}
                  {p.safety_note && <p className="strawberry-practices__safety"><strong>Важно:</strong> {p.safety_note}</p>}
                  <p className="strawberry-practices__status-label">Как вам эта практика?</p>
                  <div className="strawberry-practices__status" role="group" aria-label={"Отметка практики " + p.title}>
                    {STATUS_CHOICES.map(option => <button key={option.key} type="button"
                      aria-pressed={statusOf(p) === option.key}
                      disabled={savingKey === p.practice_key}
                      className={statusOf(p) === option.key ? "is-selected" : ""}
                      onClick={() => chooseStatus(p, option.key)}>{option.label}</button>)}
                  </div>
                  {feedback && <p role="status" className="strawberry-practices__feedback">{feedback}</p>}
                </div>}
              </div>;
            })}
          </div>}
        </section>
        <p className="strawberry-practices__disclaimer">
          Это поддерживающие упражнения, не лечение и не замена специалисту.
          При боли, головокружении или усилении симптомов прекратите практику.
        </p>
      </main>
      <footer className="strawberry-entry__footer">
        <span>При непосредственной опасности обращайтесь в экстренные службы.</span>
        <span>{preview ? "Демонстрация оформления" : "Тестовый сервис · без реальных пациентских данных"}</span>
      </footer>
    </div>
  );
}
