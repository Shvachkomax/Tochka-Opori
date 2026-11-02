import React, { useState } from "react";
import { foods } from "./lib/portionFoods.js";

export function calculatePortion(items) {
  const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  if (!items.length) return null;
  for (const item of items) {
    const food = foods.find(f => f.id === item.id);
    const grams = Number(item.grams);
    if (!food || !Number.isFinite(grams) || grams <= 0 || grams > 10000) return null;
    for (const key of Object.keys(totals)) totals[key] += food[key] * grams / 100;
  }
  return Object.fromEntries(Object.entries(totals).map(([key, n]) => [key, Math.round(n)]));
}

export default function PlatePortion({ analysis, manual, onConfirm }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [overlap, setOverlap] = useState("");
  const prior = analysis.portion;
  const estimate = calculatePortion(items);
  const needsChoice = !prior && Number(manual) > 0;
  function edit() {
    const guesses = (Array.isArray(analysis.detected_foods) ? analysis.detected_foods : []).filter(x => typeof x === "string");
    setItems(prior?.items || [...new Set(guesses)].map(name => ({
      id: foods.find(f => f.name.toLowerCase().startsWith(name.toLowerCase()))?.id || "",
      hint: name, grams: "",
    })));
    if (!prior && !guesses.length) setItems([{ id: "", grams: "" }]);
    setOverlap("");
    setOpen(true);
  }
  function update(index, patch) {
    setItems(items.map((item,i) => i === index ? { ...item, ...patch } : item));
  }
  return <div className="portion">
    {prior && <p>Учтено за день · ≈{prior.kcal} ккал · Б {prior.protein} / Ж {prior.fat} / У {prior.carbs} г</p>}
    {!open ? <button type="button" onClick={edit}>{prior ? "Изменить порцию" : "Уточнить порцию"}</button> : <>
      <h3>Состав и вес порции</h3>
      {items.map((item,i) => <div key={i} className="portion-row">
        <label>{item.hint || "Продукт"}<select value={item.id} onChange={e => update(i,{id:e.target.value})}>
          <option value="">Выберите продукт</option>
          {foods.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select></label>
        <label>Вес, г<input type="number" min="0.1" step="any" value={item.grams} onChange={e => update(i,{grams:e.target.value})}/></label>
        <button type="button" onClick={() => setItems(items.filter((_,j) => j !== i))}>Убрать</button>
      </div>)}
      <button type="button" onClick={() => setItems([...items,{id:"",grams:""}])}>+ Продукт</button>
      <p>Расчёт по весу и справочнику USDA FoodData Central. Укажите вес съеденной части.</p>
      {estimate && <p>≈{estimate.kcal} ккал · Белки {estimate.protein} г · Жиры {estimate.fat} г · Углеводы {estimate.carbs} г</p>}
      {needsChoice && <label>Эта порция входит во введённые вручную {manual} ккал?
        <select value={overlap} onChange={e => setOverlap(e.target.value)}><option value="">Выберите</option><option value="yes">Да, уже входит</option><option value="no">Нет, прибавить порцию</option></select>
      </label>}
      {needsChoice && overlap === "yes" && estimate?.kcal > Number(manual) && <p>Порция больше введённого итога. Проверьте вес или ручной ввод.</p>}
      <button type="button" disabled={!estimate || (needsChoice && (!overlap || (overlap === "yes" && estimate.kcal > Number(manual))))} onClick={() => { onConfirm({items,...estimate},needsChoice && overlap === "yes"); setOpen(false); }}>
        {prior ? "Обновить" : "Добавить в день"}{estimate && ' · ≈'+estimate.kcal+' ккал'}
      </button> <button type="button" onClick={() => setOpen(false)}>Отмена</button>
    </>}
  </div>;
}
