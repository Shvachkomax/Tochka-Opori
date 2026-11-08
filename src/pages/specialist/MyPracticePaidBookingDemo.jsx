import React,{useCallback,useEffect,useMemo,useState} from "react";
import {
  PAID_DEMO_KEY,emptyPaidDemo,restorePaidDemo,addPaidDemoSlot,
  offerFromLink,offerToLink,beginPaidDemoHold,simulatePaidDemoPayment,
  cancelPaidDemoBooking,isAvailable,getBookingStatus,settlementForBooking,
  demoExecutor,
} from "../../../lib/my-practice/paid-booking-demo.js";
import {DEMO_CLINICS,DEMO_DOCTOR} from "../../../lib/my-practice/pilot-data.js";
import {endForDuration} from "../../../lib/my-practice/schedule-draft.js";
import {formatPracticeRubles,quotePracticeCommission} from "../../../lib/my-practice/commission.js";
import SpecialistPageNavigation from "./SpecialistPageNavigation.jsx";
import "./MyPracticePaidBookingDemo.css";

const dateLabel=d=>new Intl.DateTimeFormat("ru-RU",{dateStyle:"medium",timeZone:"UTC"}).format(new Date(d+"T12:00:00Z"));
const nowDay=()=>{
  const d=new Date();d.setDate(d.getDate()+4);
  return d.toISOString().slice(0,10);
};
const generateId=prefix=>prefix+"-"+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+"-"+Math.floor(Math.random()*1e7));
function read(storageKey){
 try{return restorePaidDemo(localStorage.getItem(storageKey));}
 catch{return emptyPaidDemo();}
}
function usePaidDemoStore(storageScope = "public-demo"){
 const storageKey = PAID_DEMO_KEY + ":" + storageScope;
 const [data,setData]=useState(()=>read(storageKey));
 const [error,setError]=useState("");
 const refresh=useCallback(()=>setData(read(storageKey)),[storageKey]);
 useEffect(()=>{
   const onStorage=e=>{if(e.key===storageKey)refresh();};
   window.addEventListener("storage",onStorage);
   window.addEventListener("focus",refresh);
   return()=>{window.removeEventListener("storage",onStorage);window.removeEventListener("focus",refresh);};
 },[refresh,storageKey]);
 // Local, non-atomic browser demo only: no cross-device availability guarantee.
 const update=action=>{
  try {
   const latest=read(storageKey);
   const next=action(latest);
   localStorage.setItem(storageKey,JSON.stringify(next));
   setData(next);setError("");
   return next;
  }catch(e){setError(e?.message||"Не удалось изменить данные.");return null;}
 };
 return {data,error,setError,update,refresh};
}
function quoteBox(priceKopecks){
 const q=quotePracticeCommission(priceKopecks);
 return <div className="mp-paid-quote">
   <span><small>Приём</small><strong>{formatPracticeRubles(q.priceKopecks)}</strong></span>
   <span><small>Платформа · 20%</small><strong>{formatPracticeRubles(q.platformFeeKopecks)}</strong></span>
   <span><small>Исполнитель · 80%</small><strong>{formatPracticeRubles(q.organizationShareKopecks)}</strong></span>
 </div>;
}
function offerName(catalog,slot){
 const c=catalog?.find(x=>x.id===slot.clinicId)||DEMO_CLINICS.find(x=>x.id===slot.clinicId);
 return c?.offers.find(o=>o.id===slot.serviceId)?.name || "консультация";
}
const statusName=(code)=>({
  held:"Бронь ожидает оплаты",expired:"Время брони истекло",
  simulated_paid:"предоплата подтверждена",cancelled:"Бронь отменена",
  simulated_refunded:"Расчёт возврата отмечен",
})[code]||"Неизвестный статус";
function linkFor(slot,storageScope){
 const url=new URL("/specialist/my-practice/booking-demo",window.location.origin);
 url.searchParams.set("offer",offerToLink(slot));
 url.searchParams.set("demoScope",storageScope);
 return url.href;
}
export function MyPracticePaidBookingsDemo({catalog,schedule,storageScope = "public-demo"}){
 const {data,error,setError,update}=usePaidDemoStore(storageScope);
 const options=useMemo(()=>catalog.flatMap(c=>c.offers.filter(o=>o.status!=="archived")
   .map(o=>({id:o.id,clinicId:c.id,clinic:c.name,...o}))),[catalog]);
 const [serviceId,setServiceId]=useState("a-first");
 const [day,setDay]=useState(nowDay);
 const [start,setStart]=useState("09:00");
 const [notice,setNotice]=useState("");
 const current=options.find(o=>o.id===serviceId)||options[0];
 const selectedDuration=current?.minutes||60;
 const end=useMemo(()=>{try{return endForDuration(start,selectedDuration);}catch{return null;}},[start,selectedDuration]);
 const make=e=>{
   e.preventDefault();setNotice("");setError("");
   if(!current||!end){setError("Выберите услугу и время до полуночи.");return;}
   const next=update(data=>addPaidDemoSlot(data,{
     id:generateId("paid"),clinicId:current.clinicId,serviceId:current.id,
     day,start,end,priceKopecks:current.priceRub*100,
   },schedule));
   if(next)setNotice("платный слот создан. Его можно показать пациенту по ссылке.");
 };
 const copy=async(slot)=>{
   const url=linkFor(slot,storageScope);
   try{await navigator.clipboard.writeText(url);setNotice("Ссылка скопирована. Деньги не списываются.");}
   catch{setNotice("Не удалось скопировать автоматически. Откройте ссылку ниже и скопируйте адрес.");}
 };
 const reset=()=>{
   if(!window.confirm("Удалить все платные слоты и записи в этом браузере?"))return;
   update(()=>emptyPaidDemo());setNotice("записи удалены из этого браузера.");
 };
 return <section className="mp-paid" data-testid="my-practice-paid-bookings">
   <div className="mp-section-title"><h3>Мои платные приёмы</h3>
     <p>Коммерческая запись отдельно от справочного календаря врача.</p></div>
   <p className="mp-paid-warning">Деньги не списываются. Записи сохраняются в этом браузере и не передаются в клиники.</p>
   <form className="mp-paid-form" onSubmit={make} data-testid="mp-paid-new-slot">
     <h4>1. Опубликовать слот</h4>
     <div className="mp-paid-inputs">
       <label>Услуга
         <select value={current?.id||""} onChange={e=>setServiceId(e.target.value)} required>
           {options.map(o=><option key={o.id} value={o.id}>{o.name} · {o.clinic}</option>)}
         </select>
       </label>
       <label>Дата
         <input type="date" required min={new Date().toISOString().slice(0,10)} value={day} onChange={e=>setDay(e.target.value)}/>
       </label>
       <label>Начало
         <input type="time" required value={start} onChange={e=>setStart(e.target.value)}/>
       </label>
       <label>Конец
         <input type="text" value={end||"Неверное время"} readOnly aria-label="Окончание приёма"/>
       </label>
     </div>
     <p className="mp-paid-footnote">Место приёма служит только справочной меткой. Оно не даёт права продавать услугу от имени клиники. В реальном сервисе исполнитель и лицензия проверяются до продажи.</p>
     {current&&quoteBox(current.priceRub*100)}
     <button className="mp-primary" disabled={!current||!end} type="submit">Создать слот</button>
   </form>
   <div className="mp-paid-section-heading">
     <h4>2. Ссылки и записи</h4>
     <button type="button" className="mp-secondary" onClick={reset}>Очистить записи</button>
   </div>
   {!data.slots.length&&<p className="mp-muted">Платных слотов пока нет — создайте первый выше.</p>}
   <div className="mp-paid-list">
     {data.slots.map(slot=>{
       const bookings=data.bookings.filter(b=>b.slotId===slot.id);
       const active=bookings.find(b=>["held","simulated_paid"].includes(getBookingStatus(b,Date.now())));
       return <article key={slot.id} className="mp-paid-slot" data-testid={"mp-paid-slot-"+slot.id}>
         <div className="mp-paid-slot-head"><div>
           <strong>{offerName(catalog,slot)}</strong>
           <p>{dateLabel(slot.day)} · {slot.start}–{slot.end}</p>
           <small>Справочное место: {catalog.find(c=>c.id===slot.clinicId)?.name||"Удалённое место"}</small>
         </div><strong>{formatPracticeRubles(slot.priceKopecks)}</strong></div>
         <p className="mp-paid-footnote">{active?statusName(getBookingStatus(active,Date.now())):"Нет активной брони"}</p>
         <div className="mp-paid-slot-actions">
           <button className="mp-secondary" type="button" onClick={()=>copy(slot)}>Копировать ссылку</button>
           <a href={linkFor(slot,storageScope)} rel="noreferrer" target="_blank">Посмотреть страницу пациента</a>
         </div>
         {bookings.length>0&&<div className="mp-paid-booking-list">{bookings.map(b=><div key={b.id}>
           <span>{statusName(getBookingStatus(b,Date.now()))}</span>
           <small>{b.status==="simulated_paid"?" · 20%: "+formatPracticeRubles(quotePracticeCommission(slot.priceKopecks).platformFeeKopecks):""}</small>
           {["held","simulated_paid"].includes(getBookingStatus(b,Date.now()))&&
             <button type="button" onClick={()=>update(s=>cancelPaidDemoBooking(s,b.id))}>
               {b.status==="simulated_paid"?"возврат":"Отменить бронь"}
             </button>}
         </div>)}</div>}
       </article>;
     })}
   </div>
   {notice&&<p role="status" className="mp-paid-notice">{notice}</p>}
   {error&&<p role="alert" className="mp-paid-error">{error}</p>}
   <p className="mp-paid-footnote">Комиссия 20% рассчитывается для платного приёма. События справочного календаря не создают начислений.</p>
 </section>;
}
export function MyPracticePatientBookingDemo(){
 const rawScope=new URLSearchParams(window.location.search).get("demoScope") || "public-demo";
 const storageScope=/^[a-zA-Z0-9:-]{1,100}$/.test(rawScope)?rawScope:"public-demo";
 const params=new URLSearchParams(window.location.search);
 const encoded=params.get("offer");
 const {data,error,setError,update}=usePaidDemoStore(storageScope);
 const [message,setMessage]=useState("");
 const [currentBookingId,setCurrentBookingId]=useState(null);
 let offer=null,linkError="";
 try{offer=offerFromLink(encoded||"");}catch(e){linkError=e.message;}
 const local=data.slots.find(s=>s.id===offer?.id);
 const effective=local||offer;
 const booking=data.bookings.find(b=>b.id===currentBookingId) ||
   [...data.bookings].reverse().find(b=>b.slotId===effective?.id && ["held","simulated_paid"].includes(getBookingStatus(b,Date.now())));
 const status=booking?getBookingStatus(booking,Date.now()):null;
 const canStartNew=!booking || ["expired","cancelled","simulated_refunded"].includes(status);
 const patientAction=()=>{
   setMessage("");setError("");
   if(!effective)return;
   const next=update(state=>{
     let stored=state;
     if(!state.slots.some(s=>s.id===effective.id)){
       stored=addPaidDemoSlot(state,{...effective},[]);
     }
     return beginPaidDemoHold(stored,effective.id,generateId("hold"));
   });
   if(next){
     setCurrentBookingId(next.bookings.at(-1).id);
     setMessage("Учебная бронь создана на 10 минут. Реальная бронь у врача НЕ создана.");
   }
 };
 const pay=()=>{
   if(!booking)return;
   const next=update(s=>simulatePaidDemoPayment(s,booking.id));
   if(next)setMessage("Учебная оплата отмечена. Реальных списаний, чеков ККТ и уведомлений врачу нет.");
 };
 const cancel=()=>{
   if(!booking)return;
   const next=update(s=>cancelPaidDemoBooking(s,booking.id));
   if(next)setMessage(booking.status==="simulated_paid"?"Отмечен учебный возврат (денег не было).":"Учебная бронь отменена.");
 };
 return <main className="mp-paid-patient" data-testid="my-practice-patient-paid-demo">
   <SpecialistPageNavigation />
   <div className="mp-paid-patient-heading"><p>Земляничные поляны · Моя практика</p><h1>Запись на приём — демонстрация</h1></div>
   <p className="mp-paid-warning"><strong>Это НЕ запись к настоящему врачу.</strong> Не вводите ФИО, телефон, диагноз или платёжные данные.
     Ссылка содержит только вымышленное предложение; действия сохраняются в вашем браузере и не синхронизируются с другими устройствами.</p>
   {linkError||!effective ? <p role="alert" className="mp-paid-error">{linkError||"Учебное предложение не найдено."}</p> :
     <div className="mp-paid-patient-card">
       <p className="mp-paid-eyebrow">Условный исполнитель · не проверен</p>
       <h2>{DEMO_DOCTOR.name}</h2>
       <p>{DEMO_DOCTOR.specialty}</p>
       <h3>{offerName(null,effective)}</h3>
       <p>{dateLabel(effective.day)} · {effective.start}–{effective.end}</p>
       {quoteBox(effective.priceKopecks)}
       <p className="mp-paid-footnote">Расчёт вознаграждения платформы условный. Юридический исполнитель медицинской услуги не определён.</p>
       {canStartNew&&<button type="button" className="mp-primary" onClick={patientAction} disabled={!isAvailable(data,effective.id)&&!!local}>
         Учебное бронирование на 10 минут
       </button>}
       {booking&&<div className="mp-paid-patient-checkout">
         <strong>Статус: {statusName(status)}</strong>
         {status==="held"&&<div className="mp-paid-checkout-actions">
           <button type="button" className="mp-primary" onClick={pay}>Имитировать предоплату</button>
           <button type="button" className="mp-secondary" onClick={cancel}>Отменить бронь</button>
         </div>}
         {status==="simulated_paid"&&<div className="mp-paid-checkout-actions">
           <p className="mp-paid-footnote">Учебное подтверждение №{booking.id.slice(-8)}. <strong>Не является кассовым чеком или подтверждением реальной услуги.</strong></p>
           <button type="button" className="mp-secondary" onClick={cancel}>Имитировать возврат</button>
         </div>}
       </div>}
       {message&&<p role="status" className="mp-paid-notice">{message}</p>}
       {error&&<p role="alert" className="mp-paid-error">{error}</p>}
     </div>}
   <p className="mp-paid-footnote">Для настоящих записей следующая версия должна обеспечить серверный резерв с атомарной блокировкой, подтверждение оплаты через webhook платёжного провайдера, фискализацию и права лицензированного исполнителя.</p>
 </main>;
}
