import React, { useState } from 'react'
import { Mic, Keyboard, AlertTriangle, Brain, ShieldCheck, FileText, Clock } from 'lucide-react'

export default function App() {
  const [mode, setMode] = useState('voice')

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <div className="logo"><Brain size={22} /></div>
          <div>
            <div className="brand-title">Точка опоры</div>
            <div className="brand-subtitle">анонимный скрининг состояния</div>
          </div>
        </div>
        <button className="danger"><AlertTriangle size={18} /> Мне срочно нужна помощь</button>
      </header>

      <main>
        <section className="hero">
          <div className="hero-text">
            <div className="badge">Без имени. Без осуждения. Первый шаг — за 5–10 минут.</div>
            <h1>Расскажите, что с вами происходит — голосом или текстом.</h1>
            <p>
              Сервис поможет мягко разобрать состояние, определить возможный спектр проблемы и предложить понятный план действий: самопомощь, консультация психолога, врача или срочная помощь.
            </p>
            <div className="buttons">
              <button className="primary" onClick={() => setMode('voice')}><Mic size={20} /> Рассказать голосом</button>
              <button className="secondary" onClick={() => setMode('text')}><Keyboard size={20} /> Написать текстом</button>
            </div>
            <div className="note">Сервис не ставит диагноз. Это первичный скрининг и маршрутизация. Решение о диагнозе и лечении принимает врач.</div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <div className="small">Первичный вход</div>
                <h2>Анонимный разговор</h2>
              </div>
              <span className="online">online</span>
            </div>
            <div className="recorder">
              {mode === 'voice' ? (
                <div className="recording">
                  <div className="mic-circle"><Mic size={42} /></div>
                  <h3>Голосовой рассказ</h3>
                  <p>В следующей версии подключим настоящую запись и AI-анализ.</p>
                </div>
              ) : (
                <textarea placeholder="Например: последние месяцы я плохо сплю, тревожусь, не могу собраться, часто думаю о потере..." />
              )}
            </div>
            <button className="wide">Начать анонимный разбор состояния</button>
          </div>
        </section>

        <section className="cards">
          <Card icon={<Mic />} title="1. Рассказ" text="Вы голосом или текстом описываете свое состояние." />
          <Card icon={<Brain />} title="2. Скрининг" text="AI выделяет тревожные темы, симптомы и возможные риски." />
          <Card icon={<FileText />} title="3. План" text="Вы получаете понятное резюме и рекомендации." />
          <Card icon={<Clock />} title="4. Специалист" text="При необходимости подключается психолог или врач." />
        </section>

        <section className="crisis">
          <AlertTriangle size={28} />
          <div>
            <h2>Если вам очень плохо — не проходите опросник.</h2>
            <p>При угрозе жизни или безопасности нужно обращаться в экстренные службы: <b>112</b> или <b>103</b>. В сервисе всегда должна быть отдельная кнопка срочной консультации.</p>
          </div>
        </section>

        <section className="bottom-cards">
          <Card icon={<ShieldCheck />} title="Анонимность" text="На первом этапе не нужно указывать имя. Можно начать с описания состояния." />
          <Card icon={<Clock />} title="Быстрый маршрут" text="После скрининга система предлагает следующий шаг: самопомощь, психолог, врач или срочная помощь." />
          <Card icon={<FileText />} title="Отчет для врача" text="Врач получает структурированное резюме: жалобы, риски, красные флаги и уточняющие вопросы." />
        </section>
      </main>
    </div>
  )
}

function Card({ icon, title, text }) {
  return <div className="card"><div className="card-icon">{icon}</div><h3>{title}</h3><p>{text}</p></div>
}
