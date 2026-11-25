import React, { useState } from "react";
import "./StrawberryWelcome.css";
import "./StrawberryDiary.css";

/**
 * Экран 06. Унаследованная модель Support: wellbeing -5..+5,
 * anxiety 0..10, comment <=1000, сохранение через saveSupportCheckin.
 * В режиме preview не вызывает API и работает только с вымышленными данными.
 */
export default function StrawberryDiary({
  preview = false,
  wellbeing = null, anxiety = null, comment = "", today = null, history = [],
  saving = false,
  onChangeWellbeing, onChangeAnxiety, onChangeComment, onSave,
  onBack, onAbout, onEmergency, onSpecialist,
}) {
  const [demo, setDemo] = useState({ wellbeing: 1, anxiety: 3, comment: "" });
  const [demoSaved, setDemoSaved] = useState(false);
  const [localSaving, setLocalSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [demoEmergency, setDemoEmergency] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const sample = [
    { checkin_date: "2026-11-04", wellbeing_score: -2, anxiety_score: 7 },
    { checkin_date: "2026-11-05", wellbeing_score: -1, anxiety_score: 6 },
    { checkin_date: "2026-11-06", wellbeing_score: 0, anxiety_score: 5 },
    { checkin_date: "2026-11-07", wellbeing_score: 0, anxiety_score: 4 },
    { checkin_date: "2026-11-08", wellbeing_score: 1, anxiety_score: 3 },
    { checkin_date: "2026-11-09", wellbeing_score: 1, anxiety_score: 3 },
  ];
  const marks = preview ? sample : (Array.isArray(history) ? history : []);
  const wb = preview ? demo.wellbeing : wellbeing;
  const ax = preview ? demo.anxiety : anxiety;
  const note = preview ? demo.comment : comment;
  const isBusy = saving || localSaving;
  const isSaved = preview ? demoSaved : Boolean(today);

  const formatNumber = value => value > 0 ? "+" + value : String(value);
  const setWb = value => {
    if (preview) { setDemo(previous => ({ ...previous, wellbeing: value })); setDemoSaved(false); }
    else onChangeWellbeing?.(value);
    setMessage("");
  };
  const setAx = value => {
    if (preview) { setDemo(previous => ({ ...previous, anxiety: value })); setDemoSaved(false); }
    else onChangeAnxiety?.(value);
    setMessage("");
  };
  const setNote = value => {
    if (preview) { setDemo(previous => ({ ...previous, comment: value })); setDemoSaved(false); }
    else onChangeComment?.(value);
    setMessage("");
  };
  async function save(event) {
    event.preventDefault();
    if (wb === null || wb === undefined || isBusy) return;
    if (preview) {
      setDemoSaved(true);
      setMessage("Пример отметки готов. В демоверсии данные никуда не отправляются.");
      return;
    }
    setLocalSaving(true);
    setMessage("");
    try {
      const ok = await onSave?.();
      setMessage(ok ? "Отметка сохранена в дневнике." : "Не удалось сохранить отметку. Проверьте связь и попробуйте ещё раз.");
    } catch {
      setMessage("Не удалось сохранить отметку. Попробуйте ещё раз.");
    } finally {
      setLocalSaving(false);
    }
  }

  const ordered = marks
    .filter(row => row && Number.isFinite(Number(row.wellbeing_score)) && row.wellbeing_score !== null)
    .slice()
    .sort((a, b) => String(a.checkin_date).localeCompare(String(b.checkin_date)))
    .slice(-14);
  const createLine = (key, top) => ordered.map((row, i) => {
    const val = Number(row[key]);
    if (!Number.isFinite(val) || row[key] === null || row[key] === undefined) return null;
    const x = 18 + i * (326 / Math.max(1, ordered.length - 1));
    const y = top === "wellbeing" ? 18 + ((5 - val) / 10) * 78 : 18 + ((10 - val) / 10) * 78;
    return [x, y];
  }).filter(Boolean);
  const points = createLine("wellbeing_score", "wellbeing");
  const anxietyPoints = createLine("anxiety_score", "anxiety");
  const path = pairs => pairs.map(([x, y]) => x.toFixed(1) + "," + y.toFixed(1)).join(" ");

  return (
    <div className="strawberry-entry strawberry-diary">
      <div className="strawberry-entry__atmosphere" aria-hidden="true" />
      <header className="strawberry-entry__header">
        <button type="button" onClick={onBack} className="strawberry-entry__brand strawberry-diary__brand" aria-label="Вернуться в кабинет">
          <img className="strawberry-entry__brand-sprig" src="/strawberry-support-mark-v2.webp" alt="" width="66" height="70" />
          <span className="strawberry-entry__brand-type">
            <img className="strawberry-entry__wordmark" src="/strawberry-support-wordmark-v3.webp" alt="Земляничные поляны" width="320" height="56" />
            <span className="strawberry-entry__brand-caption">ПОДДЕРЖКА</span>
          </span>
        </button>
        <nav className="strawberry-entry__nav" aria-label="Навигация">
          <button type="button" onClick={onAbout || (() => setMessage("Раздел «О проекте» доступен в действующем сервисе."))}>О проекте</button>
          <button type="button" className="strawberry-entry__urgent" onClick={onEmergency || (() => setDemoEmergency(value => !value))}>Срочная помощь</button>
        </nav>
      </header>

      <main className="strawberry-entry__main strawberry-diary__main">
        <button type="button" className="strawberry-diary__back" onClick={onBack}>← В личный кабинет</button>
        <p className="strawberry-diary__eyebrow">ДНЕВНИК СОСТОЯНИЯ · ВАШ ДЕНЬ</p>
        <h1>Как вы сегодня?</h1>
        <p className="strawberry-entry__intro strawberry-diary__lead">Можно просто отметить, как вы себя чувствуете. Несколько спокойных минут, чтобы заметить перемены.</p>
        {preview && <p className="strawberry-diary__preview">Визуальный пример — все данные вымышленные.</p>}

        {demoEmergency && preview && (
          <section className="strawberry-diary__emergency" role="alert">
            <strong>Если помощь нужна прямо сейчас</strong>
            <p>При непосредственной опасности не ждите ответа сервиса. В России позвоните 112 или 103; в других странах используйте местный экстренный номер. Попросите человека, которому доверяете, побыть рядом.</p>
            <a href="tel:112">Позвонить 112</a>
          </section>
        )}

        <form className="strawberry-diary__form" onSubmit={save}>
          <section className="strawberry-diary__field" aria-labelledby="strawberry-wellbeing">
            <h2 id="strawberry-wellbeing">Общее состояние</h2>
            <p>Как вы ощущаете себя в целом?</p>
            <div className="strawberry-diary__scale" role="group" aria-label="Общее состояние от минус пяти до плюс пяти">
              {Array.from({ length: 11 }, (_, i) => i - 5).map(value => (
                <button type="button" key={value}
                  className={"strawberry-diary__mark" + (wb === value ? " strawberry-diary__mark--selected" : "")}
                  aria-pressed={wb === value}
                  onClick={() => setWb(value)}
                  disabled={isBusy}>{formatNumber(value)}</button>
              ))}
            </div>
            <div className="strawberry-diary__ends"><span>Очень тяжело</span><span>Обычно</span><span>Очень хорошо</span></div>
          </section>

          <section className="strawberry-diary__field" aria-labelledby="strawberry-anxiety">
            <h2 id="strawberry-anxiety">Напряжение и тревога</h2>
            <p>Насколько сильное напряжение вы чувствуете?</p>
            <div className="strawberry-diary__scale" role="group" aria-label="Напряжение от нуля до десяти">
              {Array.from({ length: 11 }, (_, i) => i).map(value => (
                <button type="button" key={value}
                  className={"strawberry-diary__mark" + (ax === value ? " strawberry-diary__mark--selected strawberry-diary__mark--anxiety" : "")}
                  aria-pressed={ax === value}
                  onClick={() => setAx(value)}
                  disabled={isBusy}>{value}</button>
              ))}
            </div>
            <div className="strawberry-diary__ends"><span>Совсем нет</span><span>Очень сильно</span></div>
          </section>

          <section className="strawberry-diary__field strawberry-diary__field--note">
            <label htmlFor="strawberry-diary-note">Хотите добавить пару слов?</label>
            <p>Что сегодня больше всего влияет на ваше состояние?</p>
            <textarea id="strawberry-diary-note" rows={4} maxLength={1000} value={note}
              placeholder="Можно написать здесь. Это необязательно."
              onChange={event => setNote(event.target.value)} disabled={isBusy} />
          </section>
          <div className="strawberry-diary__save">
            <button className="strawberry-entry__action strawberry-entry__action--primary"
              type="submit" disabled={isBusy || wb === null || wb === undefined}>
              {isBusy ? "Сохраняем…" : isSaved ? "Обновить отметку" : "Сохранить отметку"} <span aria-hidden="true">→</span>
            </button>
            <span>Запись привязана к вашей сессии Support.</span>
          </div>
          {message && <p className="strawberry-diary__feedback" role="status">{message}</p>}
        </form>

        <section className="strawberry-diary__history" aria-labelledby="strawberry-diary-history">
          <h2 id="strawberry-diary-history">Как менялось состояние</h2>
          <p>Небольшие отметки помогают увидеть динамику. Это не диагностический тест.</p>
          {ordered.length >= 2 ? (
            <div className="strawberry-diary__charts">
              <div className="strawberry-diary__chart">
                <div className="strawberry-diary__chart-title">Самочувствие</div>
                <svg viewBox="0 0 362 114" preserveAspectRatio="xMidYMid meet" role="img" aria-label="График изменения самочувствия">
                  <line x1="18" y1="57" x2="344" y2="57" stroke="#e6e9e3" strokeWidth="1" strokeDasharray="2 5" />
                  <polyline fill="none" stroke="#8c9f88" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={path(points)} />
                  {points.map(([x,y],i) => <circle key={i} cx={x} cy={y} r="3" fill="#8c9f88" />)}
                </svg>
                <div className="strawberry-diary__chart-caption">−5 — тяжело, +5 — хорошо</div>
              </div>
              <div className="strawberry-diary__chart">
                <div className="strawberry-diary__chart-title">Напряжение</div>
                <svg viewBox="0 0 362 114" preserveAspectRatio="xMidYMid meet" role="img" aria-label="График изменения напряжения">
                  <polyline fill="none" stroke="#c7a6a2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={path(anxietyPoints)} />
                  {anxietyPoints.map(([x,y],i) => <circle key={i} cx={x} cy={y} r="3" fill="#c7a6a2" />)}
                </svg>
                <div className="strawberry-diary__chart-caption">0 — нет, 10 — очень сильно</div>
              </div>
            </div>
          ) : <p>После нескольких ежедневных отметок здесь появится динамика.</p>}
          {ordered.length > 0 && (
            <div className="strawberry-diary__details">
              <button type="button" className="strawberry-diary__details-toggle"
                aria-expanded={showHistory} onClick={() => setShowHistory(value => !value)}>
                {showHistory ? "Скрыть" : "Посмотреть"} отметки по дням <span aria-hidden="true">{showHistory ? "↑" : "↓"}</span>
              </button>
              {showHistory && (
                <ul>{ordered.slice().reverse().map((entry, i) => (
                  <li key={entry.checkin_date || i}>
                    <time>{entry.checkin_date || "Дата не указана"}</time>
                    <span>{formatNumber(Number(entry.wellbeing_score))}/5</span>
                    {entry.anxiety_score != null && <span>Напряжение {entry.anxiety_score}/10</span>}
                  </li>
                ))}</ul>
              )}
            </div>
          )}
        </section>
      </main>
      <footer className="strawberry-entry__footer">
        <span>Поддержка не заменяет консультацию врача или экстренную помощь.</span>
        <span>{preview ? "Демонстрация оформления" : "Тестовый сервис — без реальных пациентских данных"}</span>
      </footer>
    </div>
  );
}
