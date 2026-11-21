import React, { useState } from "react";
import SpecialistPageNavigation from "./SpecialistPageNavigation.jsx";

const S = {
  page: { minHeight: "100vh", background: "#F6F0E7", color: "#2E2A25", fontFamily: "Inter, system-ui, sans-serif", padding: "clamp(16px, 4vw, 32px)" },
  card: { background: "#fff", border: "1px solid rgba(46,42,37,.1)", borderRadius: 20, padding: 24, marginBottom: 20 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid rgba(46,42,37,.15)", borderRadius: 12, background: "#fff", color: "#2E2A25", padding: "12px 14px", fontSize: 14, outline: "none" },
  btn: { border: 0, borderRadius: 12, padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer", color: "#fff", background: "#B85C4A" },
  small: { fontSize: 12, color: "#7A7268", lineHeight: 1.5 },
};

const PROVIDER_LABELS = {
  vidal: "Vidal",
  minzdrav_guidelines: "Клинические рекомендации Минздрава России",
  clinical_cases: "Одобренные клинические материалы",
  approved_clinical_cases: "Одобренные клинические материалы",
};

function chargeMessage(charge, realChargePerformed) {
  if (!charge || Number(charge.price_rub || 0) === 0) return "Поиск выполнен без списания средств.";
  if (realChargePerformed) return `Списано: ${Number(charge.price_rub).toLocaleString("ru-RU")} ₽.`;
  return `Расчётная стоимость операции: ${Number(charge.price_rub).toLocaleString("ru-RU")} ₽. Списание средств не выполнялось.`;
}

export default function ClinicalKnowledge() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [section, setSection] = useState("drugs");

  async function runSearch() {
    if (!query.trim()) {
      setResults({ ok: false, error: "Введите запрос для поиска." });
      return;
    }
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
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Не удалось выполнить поиск.");
      setResults(data);
    } catch (error) {
      setResults({ ok: false, error: error.message || "Не удалось выполнить поиск." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.page}>
      <SpecialistPageNavigation />
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Клиническая библиотека</h1>
      <p style={S.small}>
        Поиск по подключённым справочным источникам и одобренным материалам. Результаты требуют
        профессиональной оценки и не заменяют клиническое решение.
      </p>
      <div style={{ display: "flex", gap: 8, margin: "16px 0", flexWrap: "wrap" }} role="group" aria-label="Раздел библиотеки">
        {[
          ["drugs", "Препараты"],
          ["guidelines", "Клинические рекомендации"],
          ["cases", "Похожие случаи"],
        ].map(([id, label]) => (
          <button type="button" key={id} onClick={() => { setSection(id); setResults(null); }}
            aria-pressed={section === id}
            style={{ ...S.btn, background: section === id ? "#B85C4A" : "#7A7268" }}>{label}</button>
        ))}
      </div>
      <div style={S.card}>
        <label htmlFor="clinical-knowledge-query" style={{ ...S.small, display: "block", marginBottom: 6 }}>Поисковый запрос</label>
        <input id="clinical-knowledge-query" style={S.input} value={query}
          onChange={(e) => setQuery(e.target.value)} placeholder="Введите препарат, симптом или диагноз"
          onKeyDown={(event) => { if (event.key === "Enter") runSearch(); }} />
        <div style={{ marginTop: 12 }}>
          <button type="button" style={{ ...S.btn, opacity: loading ? 0.65 : 1 }} onClick={runSearch} disabled={loading}>{loading ? "Поиск…" : "Найти"}</button>
        </div>
      </div>
      {results && (
        <div style={S.card}>
          {!results.ok ? (
            <div style={{ color: "#B85C4A" }}>{results.error}</div>
          ) : (
            <>
              <div style={S.small}>
                Источник: {PROVIDER_LABELS[results.provider] || "подключённый справочный источник"}. {chargeMessage(results.charge, results.real_charge_performed)}
              </div>
              {(results.results || []).length === 0 ? <div style={{ marginTop: 12 }}>{results.no_results_message || results.no_confirmed_sources_message || "По вашему запросу пока ничего не найдено. Уточните поиск."}</div> : results.results.map((item, idx) => (
                <div key={item.id || idx} style={{ border: "1px solid rgba(46,42,37,.1)", borderRadius: 12, padding: 12, marginTop: 10 }}>
                  <div style={{ fontWeight: 700 }}>{item.name || item.title || "Материал без названия"}</div>
                  {item.substance && <div style={S.small}>Действующее вещество: {item.substance}</div>}
                  {item.summary && <div style={S.small}>{item.summary}</div>}
                  {item.content && <div style={S.small}>{item.content}</div>}
                  {item.dosing && <div style={S.small}>Сведения о применении: {item.dosing}</div>}
                  {Array.isArray(item.complaints) && item.complaints.length > 0 && <div style={S.small}>Жалобы: {item.complaints.join(", ")}</div>}
                  {item.outcomes && <div style={S.small}>Результат наблюдения: {item.outcomes}</div>}
                  {item.important_differences && <div style={S.small}>Важные различия: {item.important_differences}</div>}
                  {item.missing_data && <div style={S.small}>Требует уточнения: {item.missing_data}</div>}
                  {(item.source_name || item.source) && <div style={S.small}>Источник: {item.source_name || item.source}</div>}
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
