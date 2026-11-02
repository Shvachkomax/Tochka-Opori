import React, { useState } from "react";
import { foods } from "./lib/portionFoods.js";

const nutrients = [
  { key: "protein", name: "Белки", energy: 4, color: "#496c50" },
  { key: "fat", name: "Жиры", energy: 9, color: "#b57148" },
  { key: "carbs", name: "Углеводы", energy: 4, color: "#63809b" },
];
const format = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const foodById = new Map(foods.map(food => [food.id, food]));

export function macroSummary(rows) {
  const meals = [];
  const totals = { protein: 0, fat: 0, carbs: 0 };
  let covered = 0;
  let partial = false;
  for (const [index, row] of (rows || []).entries()) {
    const items = [];
    let mealKcal = 0;
    for (const item of row?.portion?.items || []) {
      const food = foodById.get(item.id);
      const grams = Number(item.grams);
      if (!food || item.skip || !Number.isFinite(grams) || grams <= 0) { partial = true; continue; }
      const entry = { name: food.name, grams };
      for (const { key } of nutrients) {
        entry[key] = food[key] * grams / 100;
        totals[key] += entry[key];
      }
      mealKcal += food.kcal * grams / 100;
      items.push(entry);
    }
    if (!items.length) { partial = true; continue; }
    covered += Math.round(mealKcal);
    meals.push({ name: row.photo_name || ('Тарелка ' + (index + 1)), items });
  }
  return { totals, covered, meals, partial };
}

export default function DayMacros({ rows, calories }) {
  const [showMacros, setShowMacros] = useState(true);
  const { totals, covered, meals, partial } = macroSummary(rows);
  const totalEnergy = nutrients.reduce((sum, n) => sum + totals[n.key] * n.energy, 0);
  const hasCalories = calories != null && calories !== "" && Number.isFinite(Number(calories));
  return <section className="day-nutrition" aria-label="Питание за день">
    <h2>Питание за день</h2>
    <div className="nutrition-switch">
      <button type="button" aria-pressed={!showMacros} onClick={() => setShowMacros(false)}>Калории</button>
      <button type="button" aria-pressed={showMacros} onClick={() => setShowMacros(true)}>БЖУ</button>
    </div>
    {showMacros ? meals.length ? <>
      <p>БЖУ рассчитаны для ≈{covered}{hasCalories ? ' из ' + calories : ''} ккал дневника.</p>
      {partial && <p>Часть состава тарелок осталась вне расчёта.</p>}
      {totalEnergy > 0 && <div className="macro-bar" aria-hidden="true">{nutrients.map(n => <span key={n.key} style={{ width: (totals[n.key] * n.energy / totalEnergy * 100) + "%", background: n.color }} />)}</div>}
      <small>Доли энергии из белков, жиров и углеводов. Нажмите на строку, чтобы увидеть продукты.</small>
      {nutrients.map(n => <details key={n.key}>
        <summary><strong>{n.name}</strong> · {format.format(totals[n.key])} г{totalEnergy > 0 && ' · ' + Math.round(totals[n.key] * n.energy / totalEnergy * 100) + '%'}</summary>
        {meals.map((meal,i) => <div key={i}><b>{meal.name} · {format.format(meal.items.reduce((sum,item) => sum + item[n.key], 0))} г</b>
          {meal.items.map((item,j) => <div key={j}>{item.name} ({format.format(item.grams)} г) · {format.format(item[n.key])} г</div>)}
        </div>)}
      </details>)}
    </> : <p>Состав питания пока неизвестен. Уточните продукты и вес порции в дневнике, чтобы увидеть БЖУ.</p>
    : <p>{hasCalories ? 'Получено с пищей за день: ≈' + calories + ' ккал.' : 'Калории за день пока не указаны.'}
      {hasCalories && Number(calories) >= covered && <> По подтверждённым порциям — {covered} ккал. Без разбивки по БЖУ — {Number(calories) - covered} ккал.</>}</p>}
  </section>;
}
