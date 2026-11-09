import React, { useMemo, useState } from "react";
import "./StrawberryWelcome.css";
import "./StrawberryHistory.css";

const DEMO_SESSIONS = [
  {sessionId:"demo-history-3",order:3,createdAt:"2026-11-09T11:20:00",status:"followup",
   summary:"Снова поговорили о тревоге и о том, что помогло в последние дни."},
  {sessionId:"demo-history-2",order:2,createdAt:"2026-11-06T17:40:00",status:"followup",
   summary:"Обсуждали напряжение перед сном и небольшие изменения в распорядке."},
  {sessionId:"demo-history-1",order:1,createdAt:"2026-11-02T15:10:00",status:"first",
   summary:"Первый разговор о переживаниях и ощущении усталости."}
];

function formatDate(value) {
  if (!value) return "Дата не указана";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Дата не указана" :
    d.toLocaleDateString("ru-RU", {day:"numeric", month:"long", year:"numeric"});
}

export default function StrawberryHistory({
  preview = false, sessions = [],
  onBack, onOpenSession, onOpenReport, onAbout, onEmergency,
  loading = false, emergency = false,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [previewEmergency, setPreviewEmergency] = useState(false);
  const [notice, setNotice] = useState("");
  const source = preview ? DEMO_SESSIONS : (Array.isArray(sessions) ? sessions : []);
  const sorted = useMemo(() => [...source].sort((a,b) => {
    const x = new Date(a.createdAt).getTime(), y = new Date(b.createdAt).getTime();
    return (Number.isFinite(y) ? y : 0) - (Number.isFinite(x) ? x : 0);
  }), [source]);
  const visible = sorted.filter(s => filter === "all" || (filter === "first" ? s.status !== "followup" : s.status === "followup"));
  function open(id, type) {
    if (preview) {
      setExpandedId(p => p === id ? null : id);
      setNotice("Это вымышленные записи для просмотра дизайна. Данные пациента не загружаются.");
      return;
    }
    if (type === "report") onOpenReport?.(id);
    else onOpenSession?.(id);
  }
  return (
    <div className="strawberry-entry strawberry-history">
      <div className="strawberry-entry__atmosphere" aria-hidden="true" />
      <header className="strawberry-entry__header">
        <button type="button" className="strawberry-entry__brand strawberry-history__brand"
          aria-label="Вернуться в личный кабинет" onClick={onBack}>
          <img className="strawberry-entry__brand-sprig" src="/strawberry-support-mark-v2.webp" alt="" width="66" height="70" />
          <span className="strawberry-entry__brand-type">
            <img className="strawberry-entry__wordmark" src="/strawberry-support-wordmark-v3.webp"
              alt="Земляничные поляны" width="320" height="56" />
            <span className="strawberry-entry__brand-caption">ПОДДЕРЖКА</span>
          </span>
        </button>
        <nav className="strawberry-entry__nav" aria-label="Навигация">
          <button type="button" onClick={onAbout || (() => setNotice("Это демонстрация дизайна. Сведения о проекте доступны на основном экране."))}>О проекте</button>
          <button type="button" className="strawberry-entry__urgent"
            onClick={onEmergency || (() => setPreviewEmergency(x => !x))}>Срочная помощь</button>
        </nav>
      </header>

      <main className="strawberry-entry__main strawberry-history__main">
        <button type="button" className="strawberry-history__back" onClick={onBack}>← В личный кабинет</button>
        <p className="strawberry-history__eyebrow">ВАША ИСТОРИЯ · РАЗГОВОРЫ И РЕЗУЛЬТАТЫ</p>
        <h1>К разговору можно вернуться.</h1>
        <p className="strawberry-entry__intro strawberry-history__lead">
          Здесь сохраняется история ваших бесед. Можно открыть прежний разговор и посмотреть его результат.
        </p>
        {preview && <p className="strawberry-history__preview">Визуальный пример — все имена и события вымышленные, запросы к базе не выполняются.</p>}
        {(emergency || previewEmergency) && (
          <section className="strawberry-history__emergency" role="alert">
            <strong>Если помощь нужна прямо сейчас</strong>
            <p>При непосредственной опасности не ждите ответа сервиса. В России позвоните 112 или 103; в других странах — местный экстренный номер.</p>
            <a href="tel:112">Позвонить 112</a>
          </section>
        )}
        <section className="strawberry-history__section" aria-labelledby="strawberry-history-list">
          <div className="strawberry-history__section-heading">
            <h2 id="strawberry-history-list">Ваши разговоры</h2>
            <span>{sorted.length ? sorted.length + " в истории" : "Пока пусто"}</span>
          </div>
          <div className="strawberry-history__filters" role="group" aria-label="Показать разговоры">
            {[["all","Все"],["first","Первый"],["followup","Продолжения"]].map(([value,label]) =>
              <button type="button" key={value} aria-pressed={filter === value}
                className={filter === value ? "is-active" : ""}
                onClick={() => setFilter(value)}>{label}</button>)}
          </div>
          {loading && <p role="status" className="strawberry-history__empty">Загружаем разговор…</p>}
          {!loading && visible.length === 0 &&
            <p className="strawberry-history__empty">{sorted.length ? "Для этого фильтра записей нет." :
              "После первого разговора здесь появятся его дата и результат."}</p>}
          {visible.length > 0 && (
            <ol className="strawberry-history__items">
              {visible.map((sess, i) => {
                const openId = sess.sessionId || sess.session_id;
                const isExpanded = expandedId === openId;
                return (
                  <li key={openId || i} className="strawberry-history__item">
                    <div className="strawberry-history__item-head">
                      <div className="strawberry-history__item-info">
                        <span className="strawberry-history__date">{formatDate(sess.createdAt)}</span>
                        <span className={"strawberry-history__kind" + (sess.status === "followup" ? " strawberry-history__kind--followup" : "")}>
                          {sess.status === "followup" ? "Продолжение" : "Первый разговор"}
                        </span>
                      </div>
                      <span className="strawberry-history__number">{Number.isFinite(Number(sess.order)) ? "№ " + sess.order : ""}</span>
                    </div>
                    <p className="strawberry-history__summary">{sess.summary || "Разговор сохранён в истории."}</p>
                    <div className="strawberry-history__actions">
                      <button type="button" onClick={() => open(openId,"session")} disabled={loading || !openId}>
                        Открыть разговор <span aria-hidden="true">→</span>
                      </button>
                      <button type="button" onClick={() => open(openId,"report")} disabled={loading || !openId}>
                        Посмотреть разбор <span aria-hidden="true">↗</span>
                      </button>
                    </div>
                    {preview && isExpanded &&
                      <p className="strawberry-history__demo-detail">Пример: в настоящем кабинете здесь откроется сохранённый разговор или его персональный отчёт. Текст пациента в демоверсии не показывается.</p>}
                  </li>
                );
              })}
            </ol>
          )}
          {notice && <p className="strawberry-history__notice" role="status">{notice}</p>}
        </section>
        <p className="strawberry-history__footnote">
          Эта история доступна по коду продолжения. Если нужно обсудить новые переживания, вернитесь в кабинет и начните разговор.
        </p>
      </main>
      <footer className="strawberry-entry__footer">
        <span>Поддержка не заменяет экстренную помощь или консультацию врача.</span>
        <span>{preview ? "Демонстрация оформления" : "Тестовый сервис — не вводите реальные данные пациентов"}</span>
      </footer>
    </div>
  );
}
