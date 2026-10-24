import { useEffect, useRef, useState } from 'react';
import './InformationFlow.css';

const CONTENT = {
  support: [
    ['О вашем состоянии', 'Тревожно? Накопилась усталость? Сложно на работе или в отношениях? Здесь можно рассказать, что происходит, и спокойно описать свои переживания.'],
    ['О сервисе', 'Этот сервис использует искусственный интеллект. Он помогает описать состояние, заметить важные признаки и подготовить вопросы специалисту.'],
    ['Участие специалиста', 'Если нужна помощь человека, можно отправить запрос специалисту или пригласить своего врача. Вы сами решаете, когда обратиться за помощью.'],
    ['Понятная информация', 'Вопросы о диагнозах, лекарствах и рекомендациях обсуждают с врачом. Искусственный интеллект не ставит диагноз и не назначает лечение.'],
    ['В вашем темпе', 'Не обязательно знать, с чего начать. Расскажите, что сейчас беспокоит. Когда вы начнёте действовать, информационный поток остановится.'],
  ],
  body: [
    ['О вашем самочувствии', 'Хотите наладить питание, сон или движение? Можно начать с того, что сейчас даётся труднее всего, без строгих обещаний и давления на себя.'],
    ['О сервисе', 'Искусственный интеллект помогает описать привычки, вести дневник и подготовить вопросы специалисту. Начните с короткой анкеты о себе.'],
    ['Маленькие шаги', 'Питание, активность, сон и самочувствие связаны между собой. Дневник помогает замечать изменения и обсуждать их со специалистом.'],
    ['Участие специалиста', 'Можно отправить запрос специалисту или пригласить своего врача. Диагнозы, лекарства и ограничения нагрузок важно обсуждать с врачом.'],
    ['В вашем темпе', 'Вы выбираете, когда начать и что рассказать. Сервис не ставит диагноз и не назначает препараты или БАДы.'],
  ],
};

// Static copy only: this component never calls the backend or an AI API.
export default function InformationFlow({ module = 'support', engaged = false }) {
  const viewport = useRef(null);
  const track = useRef(null);
  const group = useRef(null);
  const pauseButton = useRef(null);
  const offset = useRef(0);
  const [stopped, setStopped] = useState(engaged);
  const [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const items = CONTENT[module] || CONTENT.support;

  useEffect(() => {
    const stop = (event) => {
      if (pauseButton.current?.contains(event.target)) return;
      setStopped(true);
    };
    const visibility = () => setHidden(document.hidden);
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(preference.matches);
    document.addEventListener('pointerdown', stop, true);
    document.addEventListener('focusin', stop, true);
    document.addEventListener('keydown', stop, true);
    document.addEventListener('visibilitychange', visibility);
    preference.addEventListener('change', motion);
    return () => {
      document.removeEventListener('pointerdown', stop, true);
      document.removeEventListener('focusin', stop, true);
      document.removeEventListener('keydown', stop, true);
      document.removeEventListener('visibilitychange', visibility);
      preference.removeEventListener('change', motion);
    };
  }, []);

  useEffect(() => { if (engaged) setStopped(true); }, [engaged]);
  useEffect(() => {
    if (stopped || hovered || hidden || reduced) return;
    let frame;
    let previous;
    let cancelled = false;
    const animate = (now) => {
      // React can detach refs while the component is being unmounted.
      // Never let an animation callback crash the entire landing page.
      if (cancelled) return;
      const activeTrack = track.current;
      const activeGroup = group.current;
      if (!activeTrack || !activeGroup) return;
      const seconds = previous === undefined ? 0 : Math.min((now - previous) / 1000, 0.05);
      previous = now;
      const height = activeGroup.getBoundingClientRect().height;
      if (height > 0) {
        offset.current = (offset.current + seconds * 12) % height;
        activeTrack.style.transform = `translateY(-${offset.current}px)`;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [stopped, hovered, hidden, reduced]);

  // When paused, allow reading the entire copy with normal scrolling.
  const readable = stopped || reduced;
  useEffect(() => {
    const activeTrack = track.current;
    const activeViewport = viewport.current;
    if (!activeTrack || !activeViewport) return;
    if (readable) {
      activeTrack.style.transform = 'none';
      activeViewport.scrollTop = offset.current;
    } else {
      offset.current = activeViewport.scrollTop || offset.current;
      activeViewport.scrollTop = 0;
      activeTrack.style.transform = `translateY(-${offset.current}px)`;
    }
  }, [readable]);

  return (
    <section className="information-flow" aria-label="Информация о сервисе">
      <div ref={viewport} className={`information-flow__viewport${readable ? ' is-readable' : ''}`}
        tabIndex={0} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <div ref={track} className="information-flow__track">
          {[0, 1].map(copy => (
            <div key={copy} ref={copy === 0 ? group : undefined} aria-hidden={copy === 1 ? true : undefined}>
              {items.map(([title, text]) => <div className="information-flow__block" key={title}>
                <strong>{title}</strong><p>{text}</p>
              </div>)}
            </div>
          ))}
        </div>
      </div>
      <div className="information-flow__controls">
        <button ref={pauseButton} type="button" disabled={reduced || engaged}
          aria-pressed={stopped || reduced} onClick={() => setStopped(value => !value)}>
          {reduced ? 'Без движения' : stopped ? 'Продолжить поток' : 'Пауза'}
        </button>
      </div>
    </section>
  );
}
