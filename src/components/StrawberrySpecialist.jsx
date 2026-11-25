import React, { useState } from "react";
import "./StrawberryWelcome.css";
import "./StrawberrySpecialist.css";

const SERVICES = [
  {code:"short_followup", title:"Короткое уточнение", credits:10000},
  {code:"therapy_review", title:"Разбор терапии / повторная консультация по лечению", credits:20000},
  {code:"written_consultation", title:"Письменная консультация", credits:25000},
  {code:"phone_consultation", title:"Телефонный разговор со специалистом", credits:30000},
  {code:"urgent_contact", title:"Срочная связь со специалистом", credits:40000},
  {code:"online_consultation", title:"Онлайн-консультация", credits:50000},
  {code:"offline_consultation", title:"Очная консультация", credits:75000}
];
const REASONS = [
  {value:"discuss_report", label:"Обсудить разбор"},
  {value:"follow_up", label:"Продолжить разговор"},
  {value:"new_concern", label:"Новая ситуация"},
  {value:"other", label:"Другое"}
];
const STATUS = {
  submitted:"Отправлен — ожидает ответа", new:"Отправлен — ожидает ответа",
  accepted:"Принят специалистом", needs_clarification:"Нужно уточнение",
  scheduled:"Запланирован", answered:"Получен ответ",
  completed:"Завершён", cancelled:"Отменён"
};
const TIME_REQUIRED = new Set(["phone_consultation","urgent_contact","online_consultation","offline_consultation"]);
const EMPTY = {service_code:"",reason:"",message:"",preferred_date:"",time_from:"",time_to:"",comment:""};
const EXAMPLE_REQUESTS = [
  {id:"example-1", title:"Письменная консультация", created_at:"2026-11-07T14:00:00",
   status:"answered", message:"Хотелось уточнить, на что обратить внимание после разговора.",
   specialist_response:"Пример ответа: обсудим вашу ситуацию на консультации."},
  {id:"example-2", title:"Короткое уточнение", created_at:"2026-11-03T12:00:00",
   status:"completed", message:"Вопрос по следующему шагу."}
];
function dateLabel(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ru-RU",{day:"numeric",month:"long",year:"numeric"});
}

/** Screen 09 — same backend request state/API, fictional interactions in preview. */
export default function StrawberrySpecialist({
  preview = false, specialist = null, requests = [], request = EMPTY,
  sending = false, onChangeRequest, onSubmit, onCancelRequest,
  onBack, onAbout, onEmergency, onInviteSpecialist, onFindSpecialist,
  emergency = false, matching = false,
}) {
  const [demo, setDemo] = useState({...EMPTY});
  const [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState("");
  const [done, setDone] = useState(false);
  const [demoEmergency, setDemoEmergency] = useState(false);
  const [selectedCancel, setSelectedCancel] = useState(null);
  const selected = preview ? demo : request || EMPTY;
  const doctor = preview ? {expertName:"Специалист проекта (пример)",expertSpecialty:"Психологическое консультирование"} : specialist;
  const list = preview ? EXAMPLE_REQUESTS : Array.isArray(requests) ? requests : [];
  const valid = Boolean(selected.service_code && selected.message?.trim()?.length >= 2 && consent && !sending);
  const needTime = TIME_REQUIRED.has(selected.service_code);
  function change(patch) {
    setNotice("");
    if (preview) setDemo(prev => ({...prev,...patch}));
    else onChangeRequest?.(prev=>({...prev,...patch}));
  }
  async function submit(event) {
    event.preventDefault();
    setNotice("");
    if (!valid) return;
    if (preview) {
      setDone(true);
      setNotice("Это демонстрация: заявка не отправлена, данные не сохранены.");
      return;
    }
    try {
      const ok = await onSubmit?.();
      if (ok) {
        setDone(true);
        setConsent(false);
        setNotice("Заявка принята системой. Её статус можно посмотреть ниже.");
      } else {
        setNotice("Не удалось отправить заявку. Проверьте сообщение и повторите попытку.");
      }
    } catch {
      setNotice("Не удалось отправить заявку. Попробуйте ещё раз.");
    }
  }
  async function cancelRequest(id) {
    if (preview) {
      setNotice("В демонстрации отмена заявок не выполняется.");
      return;
    }
    if (selectedCancel || !onCancelRequest) return;
    setSelectedCancel(id);
    try {
      await onCancelRequest(id);
    } finally {
      setSelectedCancel(null);
    }
  }
  return (
    <div className="strawberry-entry strawberry-specialist">
      <div className="strawberry-entry__atmosphere" aria-hidden="true"/>
      <header className="strawberry-entry__header">
        <button type="button" className="strawberry-entry__brand strawberry-specialist__brand"
          onClick={onBack} aria-label="Вернуться в кабинет">
          <img className="strawberry-entry__brand-sprig" src="/strawberry-support-mark-v2.webp" alt="" width="66" height="70"/>
          <span className="strawberry-entry__brand-type">
            <img className="strawberry-entry__wordmark" src="/strawberry-support-wordmark-v3.webp"
              alt="Земляничные поляны" width="320" height="56"/>
            <span className="strawberry-entry__brand-caption">ПОДДЕРЖКА</span>
          </span>
        </button>
        <nav aria-label="Навигация" className="strawberry-entry__nav">
          <button type="button" onClick={onAbout || (() => setNotice("Информация о проекте доступна в действующем Support."))}>О проекте</button>
          <button type="button" className="strawberry-entry__urgent" onClick={onEmergency || (() => setDemoEmergency(x=>!x))}>Срочная помощь</button>
        </nav>
      </header>
      <main className="strawberry-entry__main strawberry-specialist__main">
        <button className="strawberry-specialist__back" type="button" onClick={onBack}>← В личный кабинет</button>
        <p className="strawberry-specialist__eyebrow">ПОДДЕРЖКА · ПОМОЩЬ СПЕЦИАЛИСТА</p>
        <h1>Когда нужен разговор с человеком.</h1>
        <p className="strawberry-entry__intro strawberry-specialist__lead">
          Иногда важно обсудить происходящее со специалистом. Здесь можно оставить обращение и следить за его статусом.
        </p>
        {preview && <p className="strawberry-specialist__preview">Визуальный пример — сведения вымышлены, заявки не отправляются.</p>}
        {(emergency || demoEmergency) && <section className="strawberry-specialist__emergency" role="alert">
          <strong>Если помощь нужна немедленно</strong>
          <p>Обращение через сервис не является экстренной помощью. При непосредственной опасности в России звоните 112 или 103, в других странах — местный экстренный номер. Не ждите ответа специалиста.</p>
          <div><a href="tel:112">Позвонить 112</a><a href="tel:103">Позвонить 103</a></div>
        </section>}
        <section className="strawberry-specialist__section" aria-labelledby="strawberry-specialist-contact">
          <h2 id="strawberry-specialist-contact">Ваш специалист</h2>
          {doctor ? (
            <>
              <p className="strawberry-specialist__doctor">{doctor.expertName || "Прикреплённый специалист"}</p>
              {doctor.expertSpecialty && <p className="strawberry-specialist__subtle">{doctor.expertSpecialty}</p>}
              {doctor.organizationName && <p className="strawberry-specialist__subtle">{doctor.organizationName}</p>}
            </>
          ) : <>
            <p>Пока специалист не прикреплён. Можно пригласить своего врача или попросить помочь с подбором.</p>
            <div className="strawberry-specialist__secondary-actions">
              <button type="button" onClick={onInviteSpecialist}>Пригласить специалиста ↗</button>
              <button type="button" onClick={onFindSpecialist} disabled={matching}>
                {matching ? "Отправляем запрос…" : "Подобрать специалиста →"}
              </button>
            </div>
          </>}
        </section>
        <section className="strawberry-specialist__section" aria-labelledby="strawberry-specialist-new">
          <h2 id="strawberry-specialist-new">Новое обращение</h2>
          <p>Выберите формат и напишите, что хотели бы обсудить. Отправка запроса не означает подтверждение записи или оплаты.</p>
          {done && <p role="status" className="strawberry-specialist__confirmation">
            {preview ? "Пример заполнен. Ничего не отправлено." : "Обращение передано системе. Смотрите статус ниже."}
          </p>}
          <form onSubmit={submit} className="strawberry-specialist__form">
            <fieldset className="strawberry-specialist__fieldset">
              <legend>Формат обращения</legend>
              <div className="strawberry-specialist__services">
                {SERVICES.map(option => (
                  <button type="button" key={option.code} aria-pressed={selected.service_code === option.code}
                    className={selected.service_code === option.code ? "is-selected" : ""}
                    disabled={sending} onClick={()=>{change({service_code:option.code});setDone(false);}}>
                    <span>{option.title}</span>
                    <small>{option.credits.toLocaleString("ru-RU")}</small>
                  </button>
                ))}
              </div>
              <p className="strawberry-specialist__credits-note">Суммы указаны в условных кредитах для текущего тестового расчёта, не в рублях.</p>
            </fieldset>
            <fieldset className="strawberry-specialist__fieldset">
              <legend>О чём вы хотите поговорить?</legend>
              <div className="strawberry-specialist__reasons">
                {REASONS.map(r=><button type="button" key={r.value} aria-pressed={selected.reason === r.value}
                  className={selected.reason === r.value ? "is-selected" : ""}
                  onClick={()=>change({reason:r.value})} disabled={sending}>{r.label}</button>)}
              </div>
            </fieldset>
            <label htmlFor="strawberry-specialist-message">Ваше сообщение</label>
            <textarea id="strawberry-specialist-message" rows={4}
              value={selected.message || ""} disabled={sending} maxLength={2000}
              onChange={e=>change({message:e.target.value})}
              placeholder="Напишите, что вам важно обсудить…" />
            {selected.service_code === "urgent_contact" && (
              <p className="strawberry-specialist__urgent-note">
                Этот формат не гарантирует немедленного ответа. При непосредственной опасности звоните 112 или 103.
              </p>
            )}
            {needTime && <div className="strawberry-specialist__date-block">
              <label htmlFor="strawberry-specialist-date">Предпочтительная дата (не подтверждённая запись)</label>
              <input id="strawberry-specialist-date" type="date" value={selected.preferred_date || ""}
                disabled={sending} onChange={e=>change({preferred_date:e.target.value})}/>
              <div className="strawberry-specialist__times">
                <div><label htmlFor="strawberry-specialist-from">С</label>
                  <input type="time" id="strawberry-specialist-from" disabled={sending} value={selected.time_from || ""} onChange={e=>change({time_from:e.target.value})}/></div>
                <div><label htmlFor="strawberry-specialist-to">До</label>
                  <input type="time" id="strawberry-specialist-to" disabled={sending} value={selected.time_to || ""} onChange={e=>change({time_to:e.target.value})}/></div>
              </div>
            </div>}
            <label htmlFor="strawberry-specialist-comment">Дополнительные пожелания (необязательно)</label>
            <textarea id="strawberry-specialist-comment" rows={2} maxLength={1000} disabled={sending}
              value={selected.comment || ""} onChange={e=>change({comment:e.target.value})}
              placeholder="Если хочется что-то добавить…" />
            <label className="strawberry-specialist__consent">
              <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={sending}/>
              <span>Я понимаю, что после отправки специалисту могут быть доступны сведения из обращения и контекст выбранного разговора. До отправки запрос специалисту не направляется.</span>
            </label>
            <div className="strawberry-specialist__actions">
              <button type="submit" className="strawberry-entry__action strawberry-entry__action--primary"
                disabled={!valid}>{sending ? "Отправляем…" : preview ? "Проверить заполнение" : "Отправить обращение"} <span aria-hidden="true">→</span></button>
              <span>Срок ответа зависит от доступности специалиста.</span>
            </div>
            {notice && <p className="strawberry-specialist__notice" role="status">{notice}</p>}
          </form>
        </section>
        <section className="strawberry-specialist__section strawberry-specialist__history" aria-labelledby="strawberry-specialist-status">
          <h2 id="strawberry-specialist-status">Ваши обращения</h2>
          {list.length === 0 ? <p>Пока обращений нет. Здесь появятся отправленные запросы и ответы специалиста.</p> :
            <div className="strawberry-specialist__requests">
              {list.map((entry,i)=><div key={entry.id || i} className="strawberry-specialist__request">
                <div className="strawberry-specialist__request-head">
                  <span>{entry.title || entry.request_type || "Обращение"} <small>{dateLabel(entry.created_at)}</small></span>
                  <span className="strawberry-specialist__status">{STATUS[entry.status] || "Статус уточняется"}</span>
                </div>
                {entry.message && <p>{entry.message}</p>}
                {entry.scheduled_at && <p>Дата встречи: {dateLabel(entry.scheduled_at)} {entry.scheduled_comment || ""}</p>}
                {entry.specialist_response && <div className="strawberry-specialist__reply">
                  <span>Ответ специалиста</span><p>{entry.specialist_response}</p>
                </div>}
                {["submitted","new","accepted"].includes(entry.status) &&
                  <button type="button" className="strawberry-specialist__cancel" disabled={selectedCancel===entry.id}
                    onClick={()=>cancelRequest(entry.id)}>{selectedCancel===entry.id ? "Отменяем…" : "Отменить запрос"}</button>}
              </div>)}
            </div>}
        </section>
      </main>
      <footer className="strawberry-entry__footer">
        <span>Обращение не заменяет экстренную помощь или медицинскую консультацию.</span>
        <span>{preview ? "Демонстрация оформления" : "Земляничные поляны · Поддержка"}</span>
      </footer>
    </div>
  );
}
