// A suggestion is a reference food, not a claim about the recipe on the plate.
import { foods } from "./portionFoods.js";

const aliases = [
  [/тортиль|буррито|тако/u, ["167535", "2708522"]],
  [/авокадо/u, ["171705"]],
  [/гуакамоле/u, ["2709307"]],
  [/лук/u, ["170000"]],
  [/помидор|томат/u, ["170457"]],
  [/перец/u, ["170108"]],
  [/фасол/u, ["175194"]],
  [/сальса/u, ["174524"]],
];

export function portionSuggestions(name) {
  const label = name.trim().toLowerCase().replaceAll("ё", "е");
  if (!label || label === "соус") return [];
  const matches = aliases.filter(([pattern]) => pattern.test(label)).flatMap(([, ids]) => ids);
  const direct = foods.filter(f => f.name.toLowerCase().replaceAll("ё","е").startsWith(label));
  return [...new Set([...matches, ...direct.map(f => f.id)])];
}

export function detectedItem(hint) {
  const ids = portionSuggestions(hint);
  const id = ids.length === 1 && !/ или /i.test(hint) ? ids[0] : "";
  return { hint, id, grams: "" };
}
