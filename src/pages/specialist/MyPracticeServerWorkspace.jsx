import React, {useMemo, useState} from "react";
import {SYNTHETIC_PRACTICE_SERVICE_NAMES} from "../../../lib/my-practice/workspace-validation.js";
import "./MyPracticeServerWorkspace.css";

// Separate authenticated workspace: never maps public fake demo clinics to real organizations.
const EMPTY=()=>({scope:"synthetic",catalog:[],schedule:[]});
const WEEKDAY="2026-11-09";
const BOOKING_STATUSES={pending:"Ожидает",confirmed:"Подтверждена",cancelled:"Отменена",completed:"Завершена"};
const BUSY_REASONS={clinic:"Приём в клинике",personal:"Личное время",vacation:"Отпуск",unavailable:"Недоступен"};
const PATIENT_ALIASES=["demo-p1","demo-p2","demo-p3","demo-p4"];
const newId=prefix=>prefix+"-"+(globalThis.crypto?.randomUUID?.()||String(Date.now())+"-"+String(Math.floor(Math.random()*1e6)));
const defaultService=()=>({id:"",name:SYNTHETIC_PRACTICE_SERVICE_NAMES[0],priceRub:"3000",minutes:"45",format:"offline"});
const defaultEvent=()=>({id:"",kind:"busy",day:WEEKDAY,start:"09:00",end:"10:00",reason:"clinic",
  serviceId:"",patientAlias:"demo-p1",status:"pending"});
const same=event=>({...event});
const rubles=n=>new Intl.NumberFormat("ru-RU",{style:"currency",currency:"RUB",maximumFractionDigits:0}).format(n);

async function callWorkspace(action,data={}){
  const res=await fetch("/api/specialist",{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action,...data}),
  });
  let json={};
  try{json=await res.json();}catch{}
  if(!res.ok||!json.ok){
    const message=res.status===404?"Серверное хранение ещё не подключено к безопасной тестовой базе.":
      res.status===401?"Сессия врача истекла. Войдите в кабинет снова.":
      res.status===409?"Конфликт версии или доступа: черновик мог измениться в другой вкладке. Не перезаписывайте его без проверки.":
      json.error||"Ошибка загрузки черновика.";
    throw new Error(message);
  }
  return json;
}

export default function MyPracticeServerWorkspace({expertId}){
  const [phase,setPhase]=useState("idle");
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [working,setWorking]=useState(false);
  const [organizations,setOrganizations]=useState([]);
  const [orgId,setOrgId]=useState("");
  const [version,setVersion]=useState(null);
  const [workspace,setWorkspace]=useState(EMPTY);
  const [dirty,setDirty]=useState(false);
  const [serviceForm,setServiceForm]=useState(defaultService);
  const [eventForm,setEventForm]=useState(defaultEvent);
  const current=workspace.catalog.find(c=>c.organization_id===orgId);
  const offers=current?.offers||[];
  const events=workspace.schedule.filter(e=>e.organization_id===orgId)
    .sort((a,b)=>a.day.localeCompare(b.day)||a.start.localeCompare(b.start));
  const serviceIds=useMemo(()=>new Set(offers.map(o=>o.id)),[offers]);
  const resetForms=()=>{setServiceForm(defaultService());setEventForm(defaultEvent());};
  const changeWorkspace=next=>{setWorkspace(next);setDirty(true);setError("");setMessage("Изменения только на экране. Сохраните их на тестовом сервере.");};

  const load=async()=>{
    if(dirty&&!window.confirm("Есть несохранённые изменения. Загрузить серверную версию вместо них?"))return;
    setWorking(true);setError("");setMessage("");
    try{
      const result=await callWorkspace("getMyPracticeWorkspace");
      setOrganizations(result.organizations||[]);
      const data=result.workspace||EMPTY();
      setWorkspace(data);setVersion(result.version);
      const next=(result.organizations||[]).some(o=>o.organization_id===orgId)
        ?orgId:(result.organizations||[])[0]?.organization_id||"";
      setOrgId(next);
      setDirty(false);setPhase("ready");resetForms();
      setMessage("Загружен учебный черновик из тестовой базы; версия "+result.version+".");
    }catch(e){setError(e.message);setPhase("unavailable");}
    finally{setWorking(false);}
  };
  const ensureOrg=()=>{
    if(!orgId||!organizations.some(x=>x.organization_id===orgId))throw new Error("Выберите свою организацию.");
  };
  const updateOrgCatalog=(updater)=>{
    ensureOrg();
    const exists=workspace.catalog.some(x=>x.organization_id===orgId);
    if(!exists&&workspace.catalog.length>=20)throw new Error("Превышено количество клиник.");
    let updated=exists
      ?workspace.catalog.map(c=>c.organization_id===orgId?{...c,offers:updater(c.offers)}:c)
      :[...workspace.catalog,{organization_id:orgId,offers:updater([])}];
    return {...workspace,catalog:updated};
  };
  const saveService=e=>{
    e.preventDefault();
    try{
      const value={name:serviceForm.name,priceRub:Number(serviceForm.priceRub),
        minutes:Number(serviceForm.minutes),format:serviceForm.format};
      const next=updateOrgCatalog(offers=>{
        if(serviceForm.id){
          if(!offers.some(o=>o.id===serviceForm.id))throw new Error("Услуга не найдена.");
          return offers.map(o=>o.id===serviceForm.id?{...o,...value}:o);
        }
        if(offers.length>=30)throw new Error("Максимум 30 учебных услуг на организацию.");
        return [...offers,{...value,id:newId("svc"),status:"active"}];
      });
      changeWorkspace(next);setServiceForm(defaultService());
    }catch(e){setError(e.message);}
  };
  const archiveService=(offer)=>{
    try{changeWorkspace(updateOrgCatalog(offers=>offers.map(o=>o.id===offer.id?
      {...o,status:o.status==="archived"?"active":"archived"}:o)));}
    catch(e){setError(e.message);}
  };
  const onChangeOrg=value=>{setOrgId(value);resetForms();setError("");};
  const beginEventEdit=entry=>setEventForm({...entry});
  const saveEvent=e=>{
    e.preventDefault();
    try{
      ensureOrg();
      const value={id:eventForm.id||newId("evt"),organization_id:orgId,source:"manual",
        kind:eventForm.kind,day:eventForm.day,start:eventForm.start,end:eventForm.end};
      if(value.kind==="busy")value.reason=eventForm.reason;
      else {
        if(!serviceIds.has(eventForm.serviceId))throw new Error("Услуга не выбрана или относится к другой клинике.");
        value.serviceId=eventForm.serviceId;value.patientAlias=eventForm.patientAlias;value.status=eventForm.status;
      }
      const exists=workspace.schedule.some(s=>s.id===value.id);
      if(!exists&&workspace.schedule.length>=200)throw new Error("Превышен лимит календаря.");
      const next={...workspace,schedule:exists?
        workspace.schedule.map(s=>s.id===value.id?value:s):[...workspace.schedule,value]};
      changeWorkspace(next);setEventForm(defaultEvent());
    }catch(e){setError(e.message);}
  };
  const removeEvent=id=>{
    if(!window.confirm("Удалить учебное событие?"))return;
    changeWorkspace({...workspace,schedule:workspace.schedule.filter(s=>s.id!==id)});
    setEventForm(defaultEvent());
  };
  const save=async()=>{
    if(!dirty||working||phase!=="ready")return;
    setWorking(true);setError("");setMessage("");
    try{
      const result=await callWorkspace("saveMyPracticeWorkspace",{version,workspace});
      setWorkspace(result.workspace);setVersion(result.version);setDirty(false);
      setMessage("Черновик сохранён на тестовом сервере · версия "+result.version+".");
    }catch(e){setError(e.message);}
    finally{setWorking(false);}
  };
  return <section className="mp-server-workspace" data-testid="my-practice-server-workspace"
    aria-label="Серверный учебный кабинет врача">
    <div className="mp-server-heading">
      <div><h3>Моя практика · серверные черновики</h3>
        <p>Только для авторизованного специалиста. Клиники из вашего разрешённого списка, без данных пациентов.</p></div>
      <span className="mp-server-tag">Только Preview / учебный режим</span>
    </div>
    {phase!=="ready"?<div className="mp-server-start">
      <p>Данные публичной демоверсии не копируются в реальные организации. Для тестовой синхронизации используйте новый каталог в своём кабинете.</p>
      <button type="button" className="mp-primary" disabled={working} onClick={load}
        data-testid="mp-server-load">{working?"Проверяем подключение…":"Загрузить серверный черновик"}</button>
    </div>:<>
      <div className="mp-server-toolbar">
        <label>Организация
          <select value={orgId} onChange={e=>onChangeOrg(e.target.value)} data-testid="mp-server-org">
            {organizations.map(o=><option key={o.organization_id} value={o.organization_id}>{o.name}</option>)}
          </select>
        </label>
        <span>Версия: {version} · {organizations.length} разрешённых организаций</span>
      </div>
      <div className="mp-server-grid">
        <section className="mp-server-card">
          <h4>Услуги выбранной организации</h4>
          {offers.map(offer=><div key={offer.id} className="mp-server-entry">
            <div><strong>{offer.name}</strong><small>{rubles(offer.priceRub)} · {offer.minutes} мин · {offer.format==="online"?"онлайн":"очно"} · {offer.status==="archived"?"архив":"активна"}</small></div>
            <div className="mp-server-entry-actions">
              <button type="button" onClick={()=>setServiceForm({...offer,priceRub:String(offer.priceRub),minutes:String(offer.minutes)})}>Изменить</button>
              <button type="button" onClick={()=>archiveService(offer)}>{offer.status==="archived"?"Восстановить":"В архив"}</button>
            </div>
          </div>)}
          <form onSubmit={saveService}>
            <h5>{serviceForm.id?"Изменить услугу":"Добавить учебную услугу"}</h5>
            <label>Название
              <select value={serviceForm.name} onChange={e=>setServiceForm({...serviceForm,name:e.target.value})}>
                {SYNTHETIC_PRACTICE_SERVICE_NAMES.map(n=><option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="mp-server-fields">
              <label>Цена, ₽<input type="number" required min="0" max="200000" step="1"
                value={serviceForm.priceRub} onChange={e=>setServiceForm({...serviceForm,priceRub:e.target.value})}/></label>
              <label>Минуты<input type="number" required min="15" max="240" step="1"
                value={serviceForm.minutes} onChange={e=>setServiceForm({...serviceForm,minutes:e.target.value})}/></label>
            </div>
            <label>Формат
              <select value={serviceForm.format} onChange={e=>setServiceForm({...serviceForm,format:e.target.value})}>
                <option value="offline">Очно</option><option value="online">Онлайн (учебно)</option>
              </select>
            </label>
            <div className="mp-server-actions">
              <button type="submit" className="mp-primary">{serviceForm.id?"Применить изменение":"Добавить услугу"}</button>
              {serviceForm.id&&<button type="button" className="mp-secondary" onClick={()=>setServiceForm(defaultService())}>Отмена</button>}
            </div>
          </form>
        </section>
        <section className="mp-server-card">
          <h4>Расписание выбранной организации</h4>
          {events.map(entry=><div key={entry.id} className="mp-server-entry">
            <div><strong>{entry.day} · {entry.start}–{entry.end}</strong>
              <small>{entry.kind==="busy"?(BUSY_REASONS[entry.reason]||"Занятость"):
                (BOOKING_STATUSES[entry.status]||"Запись")+" · "+entry.patientAlias}</small></div>
            <div className="mp-server-entry-actions">
              <button type="button" onClick={()=>beginEventEdit(entry)}>Изменить</button>
              <button type="button" onClick={()=>removeEvent(entry.id)}>Удалить</button>
            </div>
          </div>)}
          <form onSubmit={saveEvent}>
            <h5>{eventForm.id?"Изменить событие":"Добавить событие"}</h5>
            <label>Тип
              <select value={eventForm.kind} onChange={e=>setEventForm({...defaultEvent(),kind:e.target.value,day:eventForm.day,start:eventForm.start,end:eventForm.end})}>
                <option value="busy">Блок занятости</option><option value="booking">Учебная запись</option>
              </select>
            </label>
            <div className="mp-server-fields">
              <label>Дата<input type="date" required min="2020-01-01" max="2038-12-31"
                value={eventForm.day} onChange={e=>setEventForm({...eventForm,day:e.target.value})}/></label>
              <label>Начало<input type="time" required value={eventForm.start}
                onChange={e=>setEventForm({...eventForm,start:e.target.value})}/></label>
              <label>Окончание<input type="time" required value={eventForm.end}
                onChange={e=>setEventForm({...eventForm,end:e.target.value})}/></label>
            </div>
            {eventForm.kind==="busy"?<label>Причина
              <select value={eventForm.reason} onChange={e=>setEventForm({...eventForm,reason:e.target.value})}>
                {Object.entries(BUSY_REASONS).map(([v,n])=><option key={v} value={v}>{n}</option>)}
              </select>
            </label>:<>
              <label>Услуга
                <select required value={eventForm.serviceId}
                  onChange={e=>setEventForm({...eventForm,serviceId:e.target.value})}>
                  <option value="">Выберите услугу</option>
                  {offers.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label>Пациент (вымышленный)
                <select value={eventForm.patientAlias} onChange={e=>setEventForm({...eventForm,patientAlias:e.target.value})}>
                  {PATIENT_ALIASES.map((id,i)=><option key={id} value={id}>Учебный пациент №{i+1}</option>)}
                </select>
              </label>
              <label>Статус
                <select value={eventForm.status} onChange={e=>setEventForm({...eventForm,status:e.target.value})}>
                  {Object.entries(BOOKING_STATUSES).map(([v,n])=><option key={v} value={v}>{n}</option>)}
                </select>
              </label>
            </>}
            <div className="mp-server-actions">
              <button type="submit" className="mp-primary">Применить событие</button>
              {eventForm.id&&<button type="button" className="mp-secondary" onClick={()=>setEventForm(defaultEvent())}>Отмена</button>}
            </div>
          </form>
        </section>
      </div>
      <div className="mp-server-footer">
        <span>{dirty?"Есть изменения на экране, ещё не сохранённые на сервере":"Синхронизировано · версия "+version}</span>
        <button type="button" className="mp-primary" disabled={!dirty||working} onClick={save}
          data-testid="mp-server-save">{working?"Сохраняем…":"Сохранить на тестовом сервере"}</button>
        <button type="button" className="mp-secondary" disabled={working} onClick={load}>Загрузить с сервера</button>
      </div>
    </>}
    {message&&<p role="status" className="mp-server-info">{message}</p>}
    {error&&<p role="alert" className="mp-server-error">{error}</p>}
    <p className="mp-server-footnote">Нет синхронизации с МИС, настоящими пациентами, приглашениями или платежами.
      Не вводите персональные и медицинские сведения. В случае конфликта версий изменения другого окна автоматически не стираются.</p>
  </section>;
}
