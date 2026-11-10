import React, { useState } from "react";
import "./StrawberryWelcome.css";
import "./StrawberryConversation.css";
import "./StrawberryReport.css";

/** Экран 04 — отображает клиентский отчёт и рекомендации из действующего Support. */
export default function StrawberryReport({
  patientReport, continuationCode, careRecommendation, crisisMode, crisisBlock,
  isLoading, onCopyCode, onOpenFullReport, onOpenCabinet,
  onAbout, onCrisis, onSpecialist,
}) {
  const [copied, setCopied] = useState(false);
  const emergency = Boolean(
    careRecommendation?.level === "urgent_help" ||
    crisisMode || crisisBlock?.emergencyRecommended ||
    crisisBlock?.status === "safety_check_in_progress"
  );
  const professional = ["professional_contact", "medical_consultation"].includes(careRecommendation?.level);
  const timeframe = careRecommendation?.timeframe === "today" ? "сегодня" :
    careRecommendation?.timeframe === "within_days" ? "в ближайшие дни" : "в ближайшее время";
  const copyCode = async () => {
    if (continuationCode && await onCopyCode(continuationCode)) setCopied(true);
  };
  return (
    <div className="strawberry-entry strawberry-report">
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
          <button type="button" onClick={onAbout}>О проекте</button>
          <button type="button" onClick={onSpecialist}>Кабинет специалиста</button>
          <button type="button" className="strawberry-entry__urgent" onClick={onCrisis}>Срочная помощь</button>
        </nav>
      </header>
      <main className="strawberry-entry__main strawberry-report__main">
        <p className="strawberry-report__eyebrow">ВАШ РАЗГОВОР · РЕЗУЛЬТАТ</p>
        <h1>Что удалось заметить</h1>
        <p className="strawberry-entry__intro strawberry-report__lead">
          Мы собрали главное из разговора. Это предварительный бережный разбор, а не медицинское заключение.
        </p>

        {emergency && (
          <section className="strawberry-report__urgent" role="alert" aria-label="Срочная помощь">
            <h2>Сначала — безопасность</h2>
            <p>Если вы сейчас можете причинить вред себе или другому человеку либо не уверены, что останетесь в безопасности, немедленно обратитесь за экстренной помощью. В России — 112 или 103, в других странах — местный экстренный номер. По возможности попросите близкого человека быть рядом.</p>
            <div className="strawberry-report__hotlines"><a href="tel:112">Позвонить 112</a><a href="tel:103">Позвонить 103</a></div>
            <p className="strawberry-report__fine">Не ждите ответа сервиса: он не является экстренной службой.</p>
          </section>
        )}

        <section className="strawberry-report__section" aria-labelledby="strawberry-report-main">
          <h2 id="strawberry-report-main">Главное сейчас</h2>
          <div className="strawberry-report__actual-text">{patientReport || "Отчёт ещё недоступен."}</div>
        </section>

        <section className="strawberry-report__section" aria-labelledby="strawberry-report-attention">
          <h2 id="strawberry-report-attention">На что обратить внимание</h2>
          <p>{professional && !emergency
            ? "По результату разбора рекомендуется обратиться к специалисту " + timeframe + "."
            : "Обращайте внимание на изменения самочувствия. Если состояние ухудшается или становится небезопасно, не откладывайте обращение за помощью."}</p>
          {!emergency && Array.isArray(careRecommendation?.interim_support) && careRecommendation.interim_support.length > 0 && (
            <div className="strawberry-report__interim">
              <p>До консультации:</p>
              <ul>{careRecommendation.interim_support.map((item, i) => <li key={i}>{item}</li>)}</ul>
            </div>
          )}
        </section>

        <section className="strawberry-report__section" aria-labelledby="strawberry-report-next">
          <h2 id="strawberry-report-next">Что можно сделать дальше</h2>
          <p>{emergency
            ? "Если существует непосредственная опасность, сначала получите экстренную помощь. Вернуться к разговору можно будет позже."
            : "Вы можете сохранить разбор, продолжить разговор или обратиться к специалисту."}</p>
          {continuationCode && (
            <div className="strawberry-report__code">
              <span className="strawberry-report__code-label">Код продолжения — сохраните его</span>
              <div className="strawberry-report__code-line"><code>{continuationCode}</code><button type="button" onClick={copyCode}>{copied ? "Скопировано" : "Скопировать"}</button></div>
            </div>
          )}
          <div className="strawberry-report__actions">
            <button type="button" className="strawberry-entry__action strawberry-entry__action--primary" onClick={onOpenCabinet} disabled={isLoading || emergency}>
              {isLoading ? "Открываем кабинет…" : "Продолжить в кабинете"} <span aria-hidden="true">→</span>
            </button>
            <button type="button" className="strawberry-entry__action strawberry-entry__action--quiet" onClick={onOpenFullReport}>
              Полный отчёт <span aria-hidden="true">↗</span>
            </button>
          </div>
          <p className="strawberry-report__footnote">В полном отчёте доступны скачивание документа, дополнительные рекомендации и обратная связь.</p>
        </section>
      </main>
      <footer className="strawberry-entry__footer">
        <span>Предварительная поддержка, не диагноз и не замена медицинской помощи.</span>
        <span>Тестовая версия · не вводите реальные данные пациентов.</span>
      </footer>
    </div>
  );
}
