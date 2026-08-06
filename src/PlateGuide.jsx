import React, { useState } from "react";

const ZONES = [
  {
    id: "veggies",
    label: "Овощи и зелень",
    subtitle: "для объёма, клетчатки и баланса",
    proportion: "примерно 1/2 тарелки",
    color: "#7D9A89",
    bgColor: "#e8f0ea",
    borderColor: "#c4d0c6",
    icon: "🥬",
    items: [
      "огурцы", "помидоры", "листья салата", "капуста", "брокколи",
      "цветная капуста", "кабачки", "баклажаны", "болгарский перец",
      "морковь", "зелень", "шпинат", "руккола",
    ],
    note: "Можно брать свежие, тушёные, запечённые или приготовленные на пару. Главное — не идеальность, а регулярное присутствие овощей в рационе.",
  },
  {
    id: "protein",
    label: "Белок",
    subtitle: "для сытости и восстановления",
    proportion: "примерно 1/4 тарелки",
    color: "#b8956a",
    bgColor: "#fdf6ee",
    borderColor: "#e8d5b8",
    icon: "🍗",
    items: [
      "курица", "индейка", "рыба", "яйца", "творог",
      "йогурт без сахара", "сыр", "фасоль", "чечевица", "нут", "тофу",
    ],
    note: "Белок помогает дольше чувствовать сытость и поддерживать мышцы. Источник можно выбирать по вкусу, привычкам и ограничениям.",
  },
  {
    id: "carbs",
    label: "Углеводы / гарнир",
    subtitle: "для энергии",
    proportion: "примерно 1/4 тарелки",
    color: "#c4956a",
    bgColor: "#f5f0e8",
    borderColor: "#d8cec1",
    icon: "🍚",
    items: [
      "гречка", "рис", "булгур", "овсянка", "цельнозерновые макароны",
      "картофель", "батат", "цельнозерновой хлеб", "хлебцы", "бобовые",
    ],
    note: 'Гарнир — это не "запрещённая еда", а источник энергии. Лучше ориентироваться на порцию и сочетание с белком и овощами.',
  },
];

export default function PlateGuide() {
  const [openZone, setOpenZone] = useState(null);

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Plate visual */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <svg width="280" height="280" viewBox="0 0 280 280" style={{ maxWidth: "80%", minWidth: 200 }}>
          {/* Plate circle */}
          <circle cx="140" cy="140" r="130" fill="#faf6ef" stroke="#e8e2d8" strokeWidth="2" />
          {/* Veggies half - left */}
          <path d="M140,140 L140,10 A130,130 0 0,0 10,140 Z" fill="#e8f0ea" stroke="#c4d0c6" strokeWidth="1" />
          <text x="65" y="128" textAnchor="middle" fontSize="32">🥬</text>
          <text x="65" y="158" textAnchor="middle" fontSize="20" fill="#5f574f" fontWeight="700">½</text>
          {/* Protein - top right */}
          <path d="M140,140 L140,10 A130,130 0 0,1 270,140 Z" fill="#fdf6ee" stroke="#e8d5b8" strokeWidth="1" />
          <text x="205" y="100" textAnchor="middle" fontSize="32">🍗</text>
          <text x="205" y="130" textAnchor="middle" fontSize="20" fill="#5f574f" fontWeight="700">¼</text>
          {/* Carbs - bottom right */}
          <path d="M140,140 L270,140 A130,130 0 0,1 140,270 Z" fill="#f5f0e8" stroke="#d8cec1" strokeWidth="1" />
          <text x="205" y="195" textAnchor="middle" fontSize="32">🍚</text>
          <text x="205" y="225" textAnchor="middle" fontSize="20" fill="#5f574f" fontWeight="700">¼</text>
        </svg>
      </div>

      {/* Disclaimer */}
      <div style={{ fontSize: 13, color: "#8a7e72", textAlign: "center", marginBottom: 16, lineHeight: 1.5 }}>
        Это ориентир, а не строгое правило. Не нужно собирать идеальную тарелку каждый раз — схема помогает примерно видеть баланс.
      </div>

      {/* Interactive zones */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {ZONES.map(zone => (
          <div key={zone.id}>
            <button
              onClick={() => setOpenZone(openZone === zone.id ? null : zone.id)}
              aria-expanded={openZone === zone.id}
              style={{
                width: "100%", padding: "12px 16px", borderRadius: 12,
                border: `1px solid ${zone.borderColor}`,
                background: openZone === zone.id ? zone.bgColor : "#fff",
                cursor: "pointer", display: "flex", justifyContent: "space-between",
                alignItems: "center", textAlign: "left", fontFamily: "inherit",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{zone.icon}</span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#2f2925" }}>{zone.label}</span>
                </div>
                <div style={{ fontSize: 13, color: "#8a7e72", marginTop: 2 }}>{zone.subtitle}</div>
                <div style={{ fontSize: 12, color: zone.color, marginTop: 2, fontWeight: 600 }}>{zone.proportion}</div>
              </div>
              <span style={{ fontSize: 12, color: "#8a7e72", transition: "transform 0.2s", transform: openZone === zone.id ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
            </button>

            {openZone === zone.id && (
              <div style={{ padding: "12px 16px", border: `1px solid ${zone.borderColor}`, borderTop: 0, borderRadius: "0 0 12px 12px", background: "#fff" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {zone.items.map(item => (
                    <span key={item} style={{ padding: "4px 10px", borderRadius: 8, background: zone.bgColor, border: `1px solid ${zone.borderColor}`, fontSize: 13, color: "#5f574f" }}>
                      {item}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 13, color: "#8a7e72", lineHeight: 1.5 }}>{zone.note}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
