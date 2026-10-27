import React, { useState } from "react";

const S = {
  page: { minHeight: "100vh", background: "#F6F0E7", color: "#2E2A25", fontFamily: "Inter, system-ui, sans-serif", padding: 24 },
  card: { background: "#fff", border: "1px solid rgba(46,42,37,.1)", borderRadius: 20, padding: 24, marginBottom: 20 },
  input: { width: "100%", border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, background: "#fff", color: "#2E2A25", padding: "12px 14px", fontSize: 14, outline: "none" },
  btn: { border: 0, borderRadius: 12, padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer", color: "#fff", background: "#B85C4A" },
  small: { fontSize: 12, color: "#7A7268", lineHeight: 1.5 },
};

const DEMO_DRUGS = [
  { id: "demo-drug-1", name: "Демо-сертралин", substance: "сертралин", form: "таблетки", indications: ["демонстрационное снижение настроения"], contraindications: ["только демонстрация"], dosing: "Демонстрационная доза не является назначением.", price: 0 },
  { id: "demo-drug-2", name: "Демо-атомоксетин", substance: "атомоксетин", form: "капсулы", indications: ["демонстрационный СДВГ"], contraindications: ["только демонстрация"], dosing: "Демонстрационная доза не является назначением.", price: 5 },
];

const DEMO_GUIDELINES = [
  { id: "demo-guide-1", title: "Демонстрационные рекомендации по тревоге", edition: "demo-2026", summary: "Тестовый материал для демонстрации поиска.", price: 0 },
  { id: "demo-guide-2", title: "Демонстрационные рекомендации по сну", edition: "demo-2026", summary: "Тестовый материал для демонстрации поиска.", price: 0 },
];

const DEMO_CASES = [
  { id: "demo-case-1", title: "Синтетический случай: снижение настроения", match: 82, differences: "Демонстрационные различия.", outcome: "Демонстрационный результат.", price: 20 },
  { id: "demo-case-2", title: "Синтетический случай: тревога и бессонница", match: 67, differences: "Демонстрационные различия.", outcome: "Демонстрационный результат.", price: 20 },
];

function filterByQuery(items, query, field = "name") {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => String(item[field] || item.title || "").toLowerCase().includes(q));
}

export default function ClinicalKnowledgeDemo() {
  const [section, setSection] = useState("drugs");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);

  const price = section === "cases" ? 20 : 0;

  function runSearch() {
    setLoading(true);
    setResults(null);
    setSelected(null);
    setTimeout(() => {
      let data = [];
      if (section === "drugs") data = filterByQuery(DEMO_DRUGS, query, "name");
      if (section === "guidelines") data = filterByQuery(DEMO_GUIDELINES, query, "title");
      if (section === "cases") data = filterByQuery(DEMO_CASES, query, "title");
      setResults(data);
      setHistory((prev) => [{ id: Date.now(), section, query: query || "(пустой запрос)", count: data.length, price, time: new Date().toLocaleTimeString("ru-RU") }, ...prev].slice(0, 10));
      setLoading(false);
    }, 500);
  }

  return (
    <div style={S.page}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Клиническая библиотека — Демо-режим</h1>
      <div style={{ ...S.card, background: "#FFF7E6", border: "1px solid #E9C97A" }}>
        <strong>Тестовые данные — не медицинский справочник.</strong>
        <div style={S.small}>Все материалы синтетические. Реальные списания отключены.</div>
      </div>
      <div style={{ display: "flex", gap: 8, margin: "16px 0", flexWrap: "wrap" }}>
        {[["drugs", "Препараты"], ["guidelines", "Клинические рекомендации"], ["cases", "Похожие случаи"]].map(([id, label]) => (
          <button key={id} onClick={() => { setSection(id); setResults(null); setSelected(null); }} style={{ ...S.btn, background: section === id ? "#B85C4A" : "#7A7268" }}>{label}</button>
        ))}
      </div>
      <div style={S.card}>
        <label style={S.small}>Введите запрос (например: {section === "drugs" ? "сертралин" : section === "guidelines" ? "тревога" : "снижение настроения"})</label>
        <input style={S.input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Введите запрос" />
        <div style={{ marginTop: 8, ...S.small }}>Условная стоимость запроса: {price} ₽. Реальное списание не выполняется.</div>
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={S.btn} onClick={runSearch} disabled={loading}>{loading ? "Поиск…" : "Найти"}</button>
          {section === "drugs" && <button style={{ ...S.btn, background: "#7A7268" }} onClick={() => setQuery("сертралин")}>Пример: сертралин</button>}
          {section === "guidelines" && <button style={{ ...S.btn, background: "#7A7268" }} onClick={() => setQuery("тревога")}>Пример: тревога</button>}
          {section === "cases" && <button style={{ ...S.btn, background: "#7A7268" }} onClick={() => setQuery("снижение настроения")}>Пример: снижение настроения</button>}
        </div>
      </div>
      {loading && <div style={S.card}>Выполняется поиск…</div>}
      {results && !loading && (
        <div style={S.card}>
          {results.length === 0 ? <div>Ничего не найдено. Попробуйте другой запрос.</div> : results.map((item) => (
            <div key={item.id} style={{ border: "1px solid rgba(46,42,37,.1)", borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <div style={{ fontWeight: 700 }}>{item.name || item.title}</div>
              <div style={S.small}>{item.summary || item.dosing || item.outcome}</div>
              <button style={{ ...S.btn, marginTop: 8 }} onClick={() => setSelected(item)}>Открыть карточку</button>
            </div>
          ))}
        </div>
      )}
      {selected && (
        <div style={S.card}>
          <button style={{ ...S.btn, background: "#7A7268", marginBottom: 12 }} onClick={() => setSelected(null)}>Вернуться к поиску</button>
          <h3>{selected.name || selected.title}</h3>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{JSON.stringify(selected, null, 2)}</pre>
        </div>
      )}
      {history.length > 0 && (
        <div style={S.card}>
          <h3>История запросов</h3>
          {history.map((h) => <div key={h.id} style={S.small}>{h.time} · {h.section} · «{h.query}» · результатов: {h.count} · {h.price} ₽</div>)}
        </div>
      )}
    </div>
  );
}
