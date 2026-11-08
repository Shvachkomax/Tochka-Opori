import React, {useState} from "react";
import {
  addDraftOffer, updateDraftOffer, setDraftOfferArchived, countActiveOffers,
} from "../../../lib/my-practice/catalog-draft.js";

const BLANK={name:"",format:"offline",priceRub:"3000",minutes:"45"};
export default function MyPracticeCatalogEditor({catalog,onChange,onSave,onReset,dirty,storageMessage}) {
  const [clinicId,setClinicId]=useState(catalog[0]?.id||"");
  const [editId,setEditId]=useState(null);
  const [fields,setFields]=useState(BLANK);
  const [error,setError]=useState("");
  const selected=catalog.find(c=>c.id===clinicId)||catalog[0];
  const resetForm=()=>{setEditId(null);setFields(BLANK);setError("");};
  const beginEdit=(offer)=>{setEditId(offer.id);setFields({
    name:offer.name,format:offer.format,priceRub:String(offer.priceRub),minutes:String(offer.minutes),
  });setError("");};
  const changeClinic=(id)=>{setClinicId(id);resetForm();};
  const saveOffer=(e)=>{
    e.preventDefault();
    try{
      const next=editId
        ? updateDraftOffer(catalog,{clinicId:selected.id,offerId:editId,...fields})
        : addDraftOffer(catalog,{clinicId:selected.id,...fields});
      onChange(next);
      resetForm();
    }catch(err){setError(err.message||"Проверьте поля услуги.");}
  };
  const toggleArchive=(offer,archived)=>{
    try{onChange(setDraftOfferArchived(catalog,{clinicId:selected.id,offerId:offer.id,archived}));if(editId===offer.id)resetForm();}
    catch(err){setError(err.message||"Не удалось изменить запись.");}
  };
  return <section data-testid="my-practice-editor" className="mp-editor">
    <div className="mp-section-title"><h3>Редактор услуг врача</h3>
      <p>Услуги привязаны к месту приёма. Изменения сохраняются в этом браузере.</p>
    </div>
    <div className="mp-editor-status" role="note">
      <span>{dirty?"Есть несохранённые изменения":"Черновик без несохранённых изменений"}</span>
      <span>{countActiveOffers(catalog)} активных услуг</span>
    </div>
    <label className="mp-field mp-field-block">Выберите клинику
      <select data-testid="my-practice-editor-clinic" value={selected?.id||""} onChange={e=>changeClinic(e.target.value)} disabled={!selected}>
        {catalog.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
    <p className="mp-footnote">Участие врача в клинике не означает согласия клиники на публикацию услуг. Права будут проверяться на сервере в следующем этапе.</p>
    <div className="mp-editor-layout">
      <form onSubmit={saveOffer} className="mp-editor-form" data-testid="my-practice-offer-form">
        <h4>{editId?"Изменить услугу":"Добавить услугу"}</h4>
        {!selected&&<p className="mp-muted">Для создания услуги сначала добавьте место работы на вкладке «Обзор».</p>}
        <label className="mp-field mp-field-block">Название услуги
          <input required maxLength={100} minLength={3} value={fields.name}
            onChange={e=>setFields({...fields,name:e.target.value})}
            placeholder="Например: повторная консультация"/>
        </label>
        <label className="mp-field mp-field-block">Формат
          <select value={fields.format} onChange={e=>setFields({...fields,format:e.target.value})}>
            <option value="offline">Очно</option><option value="online">Дистанционно*</option>
          </select>
        </label>
        <div className="mp-editor-form-row">
          <label className="mp-field">Цена, ₽
            <input type="number" min="0" max="200000" step="1" required value={fields.priceRub}
              onChange={e=>setFields({...fields,priceRub:e.target.value})}/>
          </label>
          <label className="mp-field">Продолжительность, мин
            <input type="number" min="15" max="240" step="1" required value={fields.minutes}
              onChange={e=>setFields({...fields,minutes:e.target.value})}/>
          </label>
        </div>
        {error&&<p className="mp-editor-error" role="alert">{error}</p>}
        <div className="mp-editor-actions">
          <button type="submit" className="mp-primary" disabled={!selected}>{editId?"Сохранить изменение":"Добавить услугу"}</button>
          {editId&&<button type="button" className="mp-secondary" onClick={resetForm}>Отменить</button>}
        </div>
      </form>
      <div className="mp-editor-list">
        <h4>Услуги: {selected?.name||"Место не выбрано"}</h4>
        {(selected?.offers||[]).map(offer=><div key={offer.id} className={"mp-editor-offer "+(offer.status==="archived"?"mp-archived":"")}>
          <div><strong>{offer.name}</strong><p>{offer.format==="online"?"Дистанционно*":"Очно"} · {offer.minutes} мин · {offer.priceRub.toLocaleString("ru-RU")} ₽</p>
          {offer.status==="archived"&&<small>В архиве</small>}</div>
          <div className="mp-editor-offer-actions">
            {offer.status!=="archived"&&<button type="button" onClick={()=>beginEdit(offer)}>Изменить</button>}
            <button type="button" onClick={()=>toggleArchive(offer,offer.status!=="archived")}>
              {offer.status==="archived"?"Восстановить":"В архив"}
            </button>
          </div>
        </div>)}
        {!selected?.offers.length&&<p className="mp-muted">Услуг пока нет.</p>}
      </div>
    </div>
    <div className="mp-editor-footer">
      <button type="button" className="mp-primary" onClick={onSave} disabled={!dirty} data-testid="my-practice-save-draft">Сохранить</button>
      <button type="button" className="mp-secondary" onClick={()=>{if(window.confirm("Вернуть исходные места, услуги и календарь? Текущие несохранённые изменения будут потеряны.")){onReset();resetForm();}}} data-testid="my-practice-reset-draft">Вернуть исходные данные</button>
    </div>
    {storageMessage&&<p role="status" className="mp-editor-note">{storageMessage}</p>}
    <p className="mp-footnote">Сохранение не отправляет данные в Supabase и не публикует их для пациентов. Не вводите настоящие персональные данные. * Дистанционный приём возможен только при наличии правовых оснований.</p>
  </section>;
}
