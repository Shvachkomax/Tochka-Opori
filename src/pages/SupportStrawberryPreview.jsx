import React, { useState } from 'react';
import './SupportStrawberryPreview.css';

// This is a visual review route. Do not connect it to patient APIs or store user data.
// The existing Support implementation continues to run at the root path.
const sections = [
  'Стартовая страница',
  'Уточняющие вопросы',
  'Результат разбора',
  'Личный кабинет',
  'Дневник состояния',
  'Практики',
  'История разговоров',
  'Связь со специалистом',
  'Подбор специалиста',
  'Код и голос',
  'Ожидание и срочная помощь',
];

function StrawberrySprig({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 96 108" fill="none" aria-hidden="true">
      <path d="M43 103c8-28 10-52 5-87M47 61c-9-14-20-20-35-19M49 47C59 34 68 27 83 24M47 73c14-6 22-6 36-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M48 22C34 16 28 8 34 3c12 0 18 9 14 19ZM30 43C17 30 6 31 5 37c2 9 15 12 25 6ZM63 36c4-13 13-19 23-16-1 13-9 20-23 16ZM66 70c10-10 21-10 26-4-4 10-16 12-26 4Z" stroke="currentColor" strokeWidth="1.4" fill="currentColor" fillOpacity=".09"/>
      <path d="M49 67c-6-10-14-10-18-2m18 2c4-10 12-12 18-6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      <path d="M46 78c-8 0-12-6-12-10 0-5 5-8 11-8 9 0 13 4 13 10 0 6-5 8-12 8Z" fill="var(--sf-berry)" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M40 64l6-6 5 6" stroke="currentColor" strokeWidth="1.1"/>
    </svg>
  );
}

function LightProjection() {
  return (
    <div className="sf-illustration" aria-hidden="true">
      <svg viewBox="0 0 610 650" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="sf-soft-focus"><feGaussianBlur stdDeviation="4.4" /></filter>
          <linearGradient id="sf-vase-glass" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e8e6df" stopOpacity=".19"/><stop offset="1" stopColor="#acae9c" stopOpacity=".06"/></linearGradient>
        </defs>
        <g filter="url(#sf-soft-focus)" stroke="#c3c6b8" strokeWidth="4" opacity=".45" fill="none">
          <path d="M196-10V448M410-10V449M5 235H595M2 440H604"/>
          <path d="M17-9C120 68 91 195 18 279M596-10C514 105 531 235 597 341" strokeWidth="16" opacity=".16"/>
          <path d="M5 447C177 452 384 441 607 447" strokeWidth="13" opacity=".32"/>
        </g>
        <g transform="translate(225 230)" stroke="#929b85" strokeWidth="1.7" fill="none" strokeLinecap="round" opacity=".59">
          <path d="M92 282C103 201 103 128 81 22M97 208C141 167 156 114 168 67M96 169C61 126 43 107 17 96M96 230C65 216 49 190 37 171"/>
          <path d="M80 36C58 25 52 10 57 2c18 1 26 18 23 34ZM81 54C93 25 116 12 134 22c-5 25-27 31-53 32ZM162 86c-8-25 3-43 18-44 12 20 3 37-18 44ZM33 102C10 89 1 73 11 62c20 0 27 17 22 40ZM39 172c-23-11-33-29-24-43 21 1 28 20 24 43ZM124 172c11-24 29-31 44-25-5 22-21 31-44 25"/>
          <path d="M48 240l15 82h82l19-82Z" stroke="#a9afa4" strokeWidth="2.6" fill="url(#sf-vase-glass)" />
          <path d="M49 240c34 7 83 7 115 0M63 291c24 5 61 6 82 1" stroke="#a9afa4" strokeWidth="1.6"/>
          <path d="M85 27c-8-9-7-18-1-23 9 2 11 15 1 23"/>
          <circle cx="167" cy="65" r="7" fill="var(--sf-berry)" fillOpacity=".35" stroke="none"/>
          <circle cx="34" cy="102" r="5" fill="var(--sf-berry)" fillOpacity=".35" stroke="none"/>
        </g>
      </svg>
    </div>
  );
}

function ReviewNote() {
  return <p className="sf-review-note">Демонстрационные экраны: сведения не сохраняются, обращения не отправляются. Для проверки функций используйте существующий тестовый сервис.</p>;
}

function QuietPanel({ title, children, className = '' }) {
  return <section className={'sf-panel ' + className}>{title && <h2>{title}</h2>}{children}</section>;
}

export default function SupportStrawberryPreview() {
  const [screen, setScreen] = useState(0);
  const [question, setQuestion] = useState('');
  const [checkin, setCheckin] = useState({ wellbeing: 5, anxiety: 5, note: '' });
  const [diarySaved, setDiarySaved] = useState(false);
  const [practice, setPractice] = useState(0);
  const [request, setRequest] = useState('');
  const [requestSent, setRequestSent] = useState(false);
  const [code, setCode] = useState('');
  const [voiceInfo, setVoiceInfo] = useState(false);
  const [safetyView, setSafetyView] = useState('waiting');
  const [currentHistory, setCurrentHistory] = useState(0);

  const maturity = screen / (sections.length - 1);
  const style = {
    '--sf-leaf': 'hsl(95 ' + (9 + 5 * maturity).toFixed(1) + '% 45%)',
    '--sf-berry': 'hsl(352 ' + (10 + 5 * maturity).toFixed(1) + '% 71%)',
  };
  const go = (value) => {
    setScreen(Math.max(0, Math.min(sections.length - 1, value)));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' });
  };
  const next = (label = 'Следующий экран') =>
    <button className="sf-button sf-button-primary" type="button" onClick={() => go(screen + 1)}>{label} <span aria-hidden="true">→</span></button>;

  const practices = [
    ['Спокойное дыхание', 'Сядьте удобно. Дышите в естественном ритме, не задерживая дыхание. Замечайте опору под ногами.'],
    ['Возвращение в настоящий момент', 'Найдите взглядом пять предметов вокруг, отметьте их форму и цвет.'],
    ['Вечерняя пауза', 'Выделите несколько спокойных минут перед сном и отложите отвлекающие дела.'],
    ['Дневник наблюдений', 'Запишите, что повлияло на ваше состояние и что оказалось полезным.'],
  ];

  const view = (() => {
    switch (screen) {
      case 0:
        return <section className="sf-hero">
          <div className="sf-overline">Земляничные поляны / Поддержка</div>
          <h1>Когда непросто,<br />можно поговорить.</h1>
          <p className="sf-lead">Расскажите, что с вами происходит — голосом или текстом. Поможем разобраться в ситуации и найти следующий шаг.</p>
          <div className="sf-actions">
            <button className="sf-button sf-button-primary" type="button" onClick={() => go(9)}>Рассказать голосом <span aria-hidden="true">↗</span></button>
            <button className="sf-button sf-button-secondary" type="button" onClick={() => go(1)}>Написать сообщение <span aria-hidden="true">→</span></button>
          </div>
          <button className="sf-link" type="button" onClick={() => go(9)}>У меня уже есть код продолжения</button>
          <div className="sf-features"><span>Анонимный разговор</span><span>Поддержка ИИ</span><span>При необходимости — специалист</span></div>
        </section>;
      case 1:
        return <section className="sf-content">
          <p className="sf-overline">Разговор / 01</p><h1>С чего начнём?</h1>
          <p className="sf-lead">Можно рассказать своими словами. Здесь не нужно искать правильные формулировки.</p>
          <QuietPanel title="Что сейчас вас беспокоит?">
            <label htmlFor="sf-question" className="sf-field-label">Ваши слова</label>
            <textarea id="sf-question" placeholder="Например: последнее время мне тревожно, плохо сплю…" value={question} onChange={e => setQuestion(e.target.value)} />
            <p className="sf-muted">Этот текст остаётся только в окне демонстрации.</p>
            {next('Посмотреть ход разговора')}
          </QuietPanel>
        </section>;
      case 2:
        return <section className="sf-content">
          <p className="sf-overline">Разбор / 02</p><h1>Понять, что происходит.</h1>
          <p className="sf-lead">После настоящего разговора здесь появятся его краткое содержание и возможные следующие шаги.</p>
          <QuietPanel title="Результат разбора">
            <p className="sf-pill">Пример оформления · не медицинское заключение</p>
            <h3>Главное из разговора</h3><p>Краткое резюме составляется по ответам пользователя, а не по этому демонстрационному примеру.</p>
            <h3>На что обратить внимание</h3><p>Что меняется со временем, какие обстоятельства влияют на состояние и когда необходима помощь специалиста.</p>
            <h3>Следующий шаг</h3><p>Можно продолжить разговор, вести дневник или обратиться к специалисту.</p>
            {next('Перейти в личный кабинет')}
          </QuietPanel>
        </section>;
      case 3:
        return <section className="sf-content">
          <p className="sf-overline">Личное пространство / 03</p><h1>Ваше место для поддержки.</h1>
          <p className="sf-lead">Небольшие шаги и возможность вернуться к разговору.</p>
          <div className="sf-grid">
            {[
              ['Продолжить разговор', 'Вернуться к тому, что сейчас важно.', 6],
              ['Как вы сегодня?', 'Оставить короткую запись о состоянии.', 4],
              ['Практики', 'Найти спокойное упражнение на несколько минут.', 5],
              ['Связь со специалистом', 'Отправить запрос на консультацию.', 7],
            ].map(([title, description, destination]) => <button className="sf-tile sf-tile-button" key={title} type="button" onClick={() => go(destination)}><h2>{title}</h2><p>{description}</p><span>Открыть →</span></button>)}
          </div>
          {next('Дневник состояния')}
        </section>;
      case 4:
        return <section className="sf-content">
          <p className="sf-overline">Дневник / 04</p><h1>Как вы сегодня?</h1>
          <p className="sf-lead">Два коротких вопроса помогают наблюдать изменения день за днём.</p>
          <QuietPanel title="Запись за сегодня">
            <label className="sf-field-label" htmlFor="sf-wellbeing">Самочувствие — {checkin.wellbeing} из 10</label>
            <input id="sf-wellbeing" type="range" min="0" max="10" value={checkin.wellbeing} onChange={e => { setCheckin({ ...checkin, wellbeing: Number(e.target.value) }); setDiarySaved(false); }} />
            <label className="sf-field-label" htmlFor="sf-anxiety">Напряжение — {checkin.anxiety} из 10</label>
            <input id="sf-anxiety" type="range" min="0" max="10" value={checkin.anxiety} onChange={e => { setCheckin({ ...checkin, anxiety: Number(e.target.value) }); setDiarySaved(false); }} />
            <label className="sf-field-label" htmlFor="sf-diary-note">Что повлияло на ваше состояние?</label>
            <textarea id="sf-diary-note" value={checkin.note} placeholder="Несколько слов о сегодняшнем дне…" onChange={e => { setCheckin({ ...checkin, note: e.target.value }); setDiarySaved(false); }} />
            <button className="sf-button sf-button-secondary" type="button" onClick={() => setDiarySaved(true)}>Сохранить отметку (демо)</button>
            {diarySaved && <p className="sf-confirm">Отметка показана как сохранённая. На сервер данные не отправлялись.</p>}
          </QuietPanel>
          {next('Посмотреть практики')}
        </section>;
      case 5:
        return <section className="sf-content">
          <p className="sf-overline">Практики / 05</p><h1>Маленькие моменты тишины.</h1>
          <p className="sf-lead">Несложные способы уделить себе несколько минут. Не заменяют профессиональную помощь.</p>
          <div className="sf-practice-layout">
            <div className="sf-practice-menu">{practices.map((p, i) => <button className={i === practice ? 'sf-practice-choice is-selected' : 'sf-practice-choice'} onClick={() => setPractice(i)} key={p[0]} type="button">{p[0]} <span aria-hidden="true">→</span></button>)}</div>
            <QuietPanel title={practices[practice][0]}><p>{practices[practice][1]}</p><p className="sf-muted">Вы можете остановиться в любой момент, если почувствуете дискомфорт.</p></QuietPanel>
          </div>
          {next('История разговоров')}
        </section>;
      case 6:
        return <section className="sf-content">
          <p className="sf-overline">История / 06</p><h1>К чему можно вернуться.</h1>
          <p className="sf-lead">Разговоры и резюме помогают сохранять нить размышлений.</p>
          <div className="sf-grid">
            {['Первый разговор', 'Повторное обращение'].map((name, i) => <button className="sf-tile sf-tile-button" key={name} type="button" onClick={() => setCurrentHistory(i)} aria-pressed={currentHistory === i}><span className="sf-muted">Демонстрационная запись {i + 1}</span><h2>{name}</h2><p>{i === currentHistory ? 'Выбрано для просмотра' : 'Посмотреть краткое резюме'}</p></button>)}
          </div>
          <QuietPanel title={currentHistory ? 'Повторное обращение' : 'Первый разговор'}><p>Здесь отображается резюме выбранного разговора. Реальных записей и медицинских сведений в демонстрации нет.</p></QuietPanel>
          {next('Связь со специалистом')}
        </section>;
      case 7:
        return <section className="sf-content">
          <p className="sf-overline">Специалист / 07</p><h1>Помощь человека — рядом.</h1>
          <p className="sf-lead">При необходимости можно обратиться к специалисту. Вы сами решаете, чем поделиться.</p>
          <div className="sf-grid">
            <button className="sf-tile sf-tile-button" type="button" onClick={() => go(8)}><h2>Подобрать специалиста</h2><p>Описать, с каким вопросом нужна помощь.</p><span>Продолжить →</span></button>
            <button className="sf-tile sf-tile-button" type="button" onClick={() => go(8)}><h2>Пригласить своего</h2><p>Показать, как выглядит приглашение специалиста.</p><span>Продолжить →</span></button>
          </div>
          <p className="sf-muted">История разговора не должна передаваться специалисту без предусмотренного разрешения.</p>
        </section>;
      case 8:
        return <section className="sf-content">
          <p className="sf-overline">Обращение / 08</p><h1>Какой помощи вы ждёте?</h1>
          <p className="sf-lead">Можно сформулировать запрос коротко. Конкретные персональные данные здесь не нужны.</p>
          <QuietPanel title="Обращение к специалисту">
            <label className="sf-field-label" htmlFor="sf-request">Ваш запрос</label>
            <textarea id="sf-request" placeholder="Опишите, что хотелось бы обсудить…" value={request} onChange={e => { setRequest(e.target.value); setRequestSent(false); }} />
            <button className="sf-button sf-button-secondary" type="button" onClick={() => setRequestSent(true)}>Показать отправку (демо)</button>
            {requestSent && <p className="sf-confirm">Это только пример подтверждения. Запрос не был отправлен.</p>}
          </QuietPanel>
          {next('Код продолжения и голос')}
        </section>;
      case 9:
        return <section className="sf-content">
          <p className="sf-overline">Продолжение / 09</p><h1>Вернуться к разговору.</h1>
          <p className="sf-lead">В настоящем сервисе для возвращения используется код продолжения.</p>
          <QuietPanel title="Код продолжения">
            <label className="sf-field-label" htmlFor="sf-code">Ваш код</label>
            <input id="sf-code" type="text" placeholder="ТОЧКА-XXXX-XXXX-XXXX-XXXX-XXXX" autoComplete="off" value={code} onChange={e => setCode(e.target.value.toUpperCase())} />
            <p className="sf-muted">Код не проверяется и никуда не отправляется в этой версии.</p>
          </QuietPanel>
          <QuietPanel title="Голосовое сообщение">
            <p>Кнопка показывает место записи голоса. Микрофон в демонстрации не включается.</p>
            <button className="sf-button sf-button-secondary" type="button" onClick={() => setVoiceInfo(!voiceInfo)}>Посмотреть голосовой ввод</button>
            {voiceInfo && <p className="sf-confirm">В рабочем Support здесь используется действующий механизм записи и расшифровки.</p>}
          </QuietPanel>
          {next('Ожидание и срочная помощь')}
        </section>;
      default:
        return <section className="sf-content">
          <p className="sf-overline">Важные состояния / 10</p><h1>Понятно в любой ситуации.</h1>
          <p className="sf-lead">Экраны ожидания, ошибки и срочной помощи должны быть особенно ясными.</p>
          <div className="sf-state-tabs" role="group" aria-label="Выбор состояния">
            <button className={safetyView === 'waiting' ? 'is-selected' : ''} onClick={() => setSafetyView('waiting')} type="button">Ожидание</button>
            <button className={safetyView === 'error' ? 'is-selected' : ''} onClick={() => setSafetyView('error')} type="button">Ошибка</button>
            <button className={safetyView === 'urgent' ? 'is-selected sf-urgent' : 'sf-urgent'} onClick={() => setSafetyView('urgent')} type="button">Срочная помощь</button>
          </div>
          <QuietPanel title={safetyView === 'urgent' ? 'Если нужна срочная помощь' : safetyView === 'error' ? 'Не удалось выполнить запрос' : 'Разбираем сообщение'}>
            {safetyView === 'urgent'
              ? <><p>Если есть непосредственная опасность для жизни или риск причинить вред себе или другим, позвоните <strong>112 или 103</strong> (в России) и постарайтесь не оставаться в одиночестве.</p><p>Этот сервис не является экстренной службой и не может обеспечить немедленное реагирование.</p></>
              : safetyView === 'error'
                ? <><p>Связь могла прерваться. Попробуйте повторить действие. При непосредственной опасности не ждите ответа сервиса — обратитесь за экстренной помощью.</p><button className="sf-button sf-button-secondary" type="button" onClick={() => setSafetyView('waiting')}>Повторить (демо)</button></>
                : <><div className="sf-waiting-mark" aria-hidden="true"/><p>Подготавливаем ответ. Пожалуйста, не закрывайте страницу.</p><p className="sf-muted">Здесь показано только состояние интерфейса.</p></>}
          </QuietPanel>
          <button className="sf-button sf-button-secondary" type="button" onClick={() => go(0)}>Вернуться к началу</button>
        </section>;
    }
  })();

  return (
    <div className="sf-root" style={style}>
      <LightProjection />
      <header className="sf-header">
        <button className="sf-brand" type="button" onClick={() => go(0)} aria-label="Земляничные поляны — Поддержка, на главную">
          <StrawberrySprig className="sf-brand-sprig" />
          <span><span className="sf-brand-name">Земляничные поляны</span><span className="sf-brand-subtitle">ПОДДЕРЖКА</span></span>
        </button>
        <nav className="sf-top-nav" aria-label="Основная навигация">
          <a href="/" title="Вернуться к существующему Support">Действующий Support</a>
          <button className="sf-quiet-link sf-emergency" type="button" onClick={() => { setSafetyView('urgent'); go(10); }}>Срочная помощь</button>
        </nav>
      </header>
      <main className="sf-main">{view}</main>
      <footer className="sf-footer">
        <div className="sf-footer-header">
          <span>Дизайн-проверка · {String(screen + 1).padStart(2, '0')} / {sections.length}</span>
          <span>Созревание: +{(maturity * 5).toFixed(1)} п.п. насыщенности</span>
        </div>
        <div className="sf-progress" role="progressbar" aria-label="Прогресс просмотра дизайна" aria-valuemin="1" aria-valuemax={sections.length} aria-valuenow={screen + 1}><span style={{ width: (screen + 1) / sections.length * 100 + '%' }} /></div>
        <div className="sf-sections" aria-label="Разделы макета">
          {sections.map((name, i) => <button type="button" key={name} className={screen === i ? 'is-current' : ''} onClick={() => go(i)} aria-current={screen === i ? 'step' : undefined}>{String(i + 1).padStart(2, '0')} {name}</button>)}
        </div>
        <ReviewNote />
      </footer>
    </div>
  );
}
