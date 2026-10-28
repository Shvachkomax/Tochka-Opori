import React, { useState } from "react";

const S = {
  page: { minHeight: "100vh", background: "#F6F0E7", color: "#2E2A25", fontFamily: "Inter, system-ui, sans-serif", padding: 32 },
  card: { background: "#fff", border: "1px solid rgba(46,42,37,.1)", borderRadius: 20, padding: 24, marginBottom: 20 },
  input: { width: "100%", border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, background: "#fff", color: "#2E2A25", padding: "12px 14px", fontSize: 14, outline: "none" },
  btn: { border: 0, borderRadius: 12, padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer", color: "#fff", background: "#B85C4A" },
  small: { fontSize: 12, color: "#7A7268", lineHeight: 1.5 },
};

export default function ClinicalKnowledge() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [section, setSection] = useState("drugs");

  async function runSearch() {
    setLoading(true);
    setResults(null);
    try {
      let action = "searchDrugs";
      let payload = { query, extended: false, actor: { id: null, role: "specialist" } };
      if (section === "guidelines") {
        action = "searchGuidelines";
        payload = { symptoms: [query], diagnosis: "", ageGroup: "adult", actor: { id: null, role: "specialist" } };
      } else if (section === "cases") {
        action = "searchSimilarCases";
        payload = { symptoms: [query], diagnosis: "", ageGroup: "adult", actor: { id: null, role: "specialist" } };
      }
      const res = await fetch("/api/clinical-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await res.json();
      setResults(data);
    } catch (error) {
      setResults({ ok: false, error: "Ошибка сети." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.page}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Клиническая библиотека</h1>
      <a href="/specialist/knowledge/demo" style={{ display: "inline-block", marginBottom: 12, color: "#B85C4A", fontWeight: 700 }}>Демо-режим</a>
      <p style={S.small}>Справочный инструмент. Данные демонстрационные (mock). Реальные списания отключены.</p>
      <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        {[
          ["drugs", "Препараты"],
          ["guidelines", "Клинические рекомендации"],
          ["cases", "Похожие случаи"],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setSection(id)} style={{ ...S.btn, background: section === id ? "#B85C4A" : "#7A7268" }}>{label}</button>
        ))}
      </div>
      <div style={S.card}>
        <input style={S.input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Введите запрос" />
        <div style={{ marginTop: 12 }}>
          <button style={S.btn} onClick={runSearch} disabled={loading}>{loading ? "Поиск…" : "Найти"}</button>
        </div>
      </div>
      {results && (
        <div style={S.card}>
          {!results.ok ? (
            <div style={{ color: "#B85C4A" }}>{results.error}</div>
          ) : (
            <>
              <div style={S.small}>Источник: {results.provider} ({results.provider_mode}). Расчётная стоимость: {results.charge?.price_rub} ₽. В тестовом режиме бесплатно. Реальное списание не выполняется.</div>
              {results.results.length === 0 ? <div>{results.no_results_message || "По вашему запросу пока ничего не найдено. Уточните поиск."}</div> : results.results.map((item, idx) => (
                <div key={item.id || idx} style={{ border: "1px solid rgba(46,42,37,.1)", borderRadius: 12, padding: 12, marginTop: 10 }}>
                  <div style={{ fontWeight: 700 }}>{item.name || item.title || "Демонстрационный результат"}</div>
                  {item.substance && <div style={S.small}>Действующее вещество: {item.substance}</div>}
                  {item.summary && <div style={S.small}>{item.summary}</div>}
                  {item.dosing && <div style={S.small}>Демонстрационное описание: {item.dosing}</div>}
                  {item.complaints && <div style={S.small}>Жалобы: {item.complaints.join(", ")}</div>}
                  {item.outcomes && <div style={S.small}>Результат наблюдения: {item.outcomes}</div>}
                  {item.source && <div style={S.small}>Источник: {item.source} (тестовые данные)</div>}
                  {item.source_url && <div style={S.small}><a href={item.source_url} target="_blank" rel="noreferrer">Открыть официальный документ</a></div>}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
