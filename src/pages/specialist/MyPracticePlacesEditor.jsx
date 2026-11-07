import React,{useState} from "react";
import {addDraftPlace,updateDraftPlace,removeDraftPlace} from "../../../lib/my-practice/catalog-draft.js";
import {PAID_DEMO_KEY,restorePaidDemo} from "../../../lib/my-practice/paid-booking-demo.js";
import "./MyPracticePlacesEditor.css";

const EMPTY={name:"",address:""};
export default function MyPracticePlacesEditor({
  catalog,schedule,onChange,onSave,dirty,storageMessage,onServices,
}){
  const [editId,setEditId]=useState(null);
  const [showForm,setShowForm]=useState(false);
  const [form,setForm]=useState(EMPTY);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const startNew=()=>{setEditId(null);setForm(EMPTY);setShowForm(true);setError("");setMessage("");};
  const startEdit=place=>{setEditId(place.id);setForm({name:place.name,address:place.address||""});
    setShowForm(true);setError("");setMessage("");};
  const close=()=>{setEditId(null);setShowForm(false);setForm(EMPTY);setError("");};
  const save=e=>{
    e.preventDefault();
    try{
      const next=editId
        ?updateDraftPlace(catalog,{placeId:editId,...form})
        :addDraftPlace(catalog,form);
      onChange(next);
      setMessage(editId?"Название и адрес места обновлены в черновике.":"Место добавлено в справочный каталог.");
      close();
    }catch(ex){setError(ex.message||"Проверьте название места.");}
  };
  const remove=place=>{
    setError("");setMessage("");
    try{
      let paidSlots=[];
      try{paidSlots=restorePaidDemo(localStorage.getItem(PAID_DEMO_KEY)).slots;}
      catch{throw Error("Не удалось проверить учебные платные слоты в браузере. Удаление отменено.");}
      const linked=paidSlots.filter(s=>s.clinicId===place.id).length;
      if(linked)throw Error("Для этого места есть "+linked+" платных демо-слотов. Очистите их в разделе «Платные приёмы» перед удалением.");
      const count=place.offers.length;
      const events=schedule.filter(x=>x.clinicId===place.id).length;
      const prompt="Удалить место «"+place.name+"» из учебного справочника?\n"
        +"Связанные учебные услуги: "+count+"; события календаря: "+events+".\n"
        +"Они будут удалены вместе с местом. Продолжить?";
      if(!window.confirm(prompt))return;
      const next=removeDraftPlace(catalog,place.id,{schedule,paidSlots});
      onChange(next.catalog,next.schedule);
      if(editId===place.id)close();
      setMessage("Место удалено вместе с его учебными услугами и событиями. Для сохранения после перезагрузки нажмите кнопку ниже.");
    }catch(ex){setError(ex.message||"Не удалось удалить место.");}
  };
  return <section data-testid="my-practice-places" className="mp-places" aria-label="Справочник мест работы врача">
    <div className="mp-places-heading">
      <div><h3>Места работы и приёма</h3>
        <p>Личный справочник врача, как в календаре. Название и адрес можно менять самостоятельно.</p></div>
      <button type="button" className="mp-primary" data-testid="mp-add-place" onClick={startNew}>+ Добавить место</button>
    </div>
    <div className="mp-two-col">
      {catalog.map(place=><article className="mp-clinic mp-place-card" key={place.id} data-testid={"mp-place-"+place.id}>
        <span className="mp-clinic-dot" style={{background:place.color}} aria-hidden="true"/>
        <div>
          <h4>{place.name}</h4>
          <p>{place.address||"Адрес пока не указан"}</p>
          <p className="mp-muted">{place.offers.length} учебных услуг · {schedule.filter(x=>x.clinicId===place.id).length} событий календаря</p>
          <div className="mp-place-actions">
            <button type="button" onClick={()=>startEdit(place)} data-testid={"mp-edit-place-"+place.id}>Изменить</button>
            <button type="button" onClick={()=>onServices(place.id)}>Услуги</button>
            <button type="button" className="mp-place-delete" onClick={()=>remove(place)} data-testid={"mp-delete-place-"+place.id}>Удалить</button>
          </div>
        </div>
      </article>)}
      {!catalog.length&&<p className="mp-muted">Справочник пуст. Добавьте первое место работы — например, клинику или частный кабинет.</p>}
    </div>
    {showForm&&<form className="mp-place-form" data-testid="mp-place-form" onSubmit={save}>
      <h4>{editId?"Редактировать место работы":"Новое место работы"}</h4>
      <label>Название
        <input autoFocus required minLength={3} maxLength={80} value={form.name}
          placeholder="Например, клиника, частный кабинет или онлайн-приём"
          onChange={e=>setForm({...form,name:e.target.value})} data-testid="mp-place-name"/>
      </label>
      <label>Адрес или пояснение (необязательно)
        <input maxLength={120} value={form.address}
          placeholder="Район или адрес учебного места"
          onChange={e=>setForm({...form,address:e.target.value})} data-testid="mp-place-address"/>
      </label>
      <div className="mp-place-actions">
        <button type="submit" className="mp-primary">Сохранить место</button>
        <button type="button" className="mp-secondary" onClick={close}>Отмена</button>
      </div>
      <p className="mp-footnote">Место — лишь запись для личного расписания. Оно не подтверждает медицинскую лицензию и не включает оплату.</p>
    </form>}
    {error&&<p role="alert" className="mp-editor-error">{error}</p>}
    {message&&<p role="status" className="mp-editor-note">{message}</p>}
    <div className="mp-places-footer">
      <span>{dirty?"Есть несохранённые изменения справочника / расписания":(storageMessage||"Изменения остаются только в браузере")}</span>
      <button type="button" className="mp-primary" disabled={!dirty} onClick={onSave}
        data-testid="mp-save-places">Сохранить справочник в браузере</button>
    </div>
    <p className="mp-footnote">Удаление места требует подтверждения и убирает связанные учебные услуги и события календаря. При наличии платных демо-слотов сначала очистите их отдельно. Не вводите настоящие персональные или медицинские сведения.</p>
  </section>;
}
