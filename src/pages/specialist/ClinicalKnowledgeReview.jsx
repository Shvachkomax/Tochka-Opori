import React, { useState, useEffect } from "react";

export default function ClinicalKnowledgeReview() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [comment, setComment] = useState("");
  const [decision, setDecision] = useState("request_changes");
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/clinical-knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "listPendingReviews" }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setItems(d.items || []);
        else setError(d.error || "Нет доступа");
      })
      .catch(() => setError("Ошибка сети"));
  }, []);

  async function submit() {
    if (!selected || !comment.trim()) {
      setError("Комментарий обязателен");
      return;
    }
    setError("");
    const res = await fetch("/api/clinical-knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submitExpertReview", case_id: selected.id, decision, comment, version: selected.version, idempotency_key: `review-${selected.id}-${decision}` }),
    });
    const data = await res.json();
    if (data.ok) {
      setHistory((prev) => [{ id: Date.now(), case_id: selected.id, decision, comment }, ...prev]);
      setSelected(null);
      setComment("");
    } else {
      setError(data.error || "Ошибка");
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F6F0E7", color: "#2E2A25", fontFamily: "Inter, system-ui, sans-serif", padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Экспертная проверка публикаций</h1>
      <a href="/specialist" style={{ display: "inline-block", marginBottom: 12, color: "#B85C4A", fontWeight: 700 }}>Вернуться в кабинет</a>
      <p style={{ fontSize: 12, color: "#7A7268", lineHeight: 1.5 }}>Доступно только клиническим рецензентам. Материалы pending_review не считаются подтверждёнными.</p>
      {error && <div style={{ color: "#B85C4A", marginBottom: 12 }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <h3>Очередь</h3>
          {items.map((item) => (
            <div key={item.id} style={{ border: "1px solid rgba(46,42,37,.1)", borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <div style={{ fontWeight: 700 }}>{item.title}</div>
              <div style={{ fontSize: 12, color: "#7A7268" }}>{item.journal} · {item.year}</div>
              {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Открыть первоисточник</a>}
              <button style={{ marginTop: 8, border: 0, borderRadius: 8, padding: "6px 10px", background: "#B85C4A", color: "#fff", cursor: "pointer" }} onClick={() => setSelected(item)}>Открыть</button>
            </div>
          ))}
          {items.length === 0 && <div style={{ fontSize: 12, color: "#7A7268" }}>Очередь пуста.</div>}
        </div>
        <div>
          {selected && (
            <div style={{ border: "1px solid rgba(46,42,37,.1)", borderRadius: 12, padding: 12 }}>
              <h3>{selected.title}</h3>
              <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 8 }}>{selected.authors} · {selected.journal} · {selected.year}</div>
              <div style={{ fontSize: 13, marginBottom: 8 }}><strong>Жалобы и симптомы:</strong> {(selected.symptoms || []).join(", ")}</div>
              {selected.diagnosis && <div style={{ fontSize: 13, marginBottom: 8 }}><strong>Диагноз:</strong> {selected.diagnosis}</div>}
              {selected.examinations && <div style={{ fontSize: 13, marginBottom: 8 }}><strong>Обследование:</strong> {selected.examinations.join(", ")}</div>}
              {selected.treatment && <div style={{ fontSize: 13, marginBottom: 8 }}><strong>Лечение:</strong> {selected.treatment}</div>}
              {selected.medications && selected.medications.length > 0 && (
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  <strong>Медикаментозное лечение:</strong>
                  {selected.medications.map((m, idx) => (
                    <div key={idx} style={{ marginTop: 6, paddingLeft: 8, borderLeft: "2px solid #B85C4A" }}>
                      <div>МНН: {m.inn} ({m.original_name})</div>
                      <div>Доза: {m.dose}</div>
                      <div>Цель: {m.purpose}</div>
                      <div>Результат: {m.result}</div>
                      <div>Побочные эффекты: {m.side_effects}</div>
                      <div>Отмена/изменение: {m.discontinuation_reason}</div>
                      {m.source_url && <a href={m.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Источник</a>}
                    </div>
                  ))}
                </div>
              )}
              {selected.outcomes && <div style={{ fontSize: 13, marginBottom: 8 }}><strong>Результат:</strong> {selected.outcomes}</div>}
              {selected.applicability_limits && <div style={{ fontSize: 13, marginBottom: 8 }}><strong>Ограничения:</strong> {selected.applicability_limits}</div>}
              <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 8 }}>Источник: {selected.source_url}</div>
              <label style={{ fontSize: 12 }}>Решение</label>
              <select value={decision} onChange={(e) => setDecision(e.target.value)} style={{ width: "100%", marginBottom: 8 }}>
                <option value="approve" disabled={!(selected?.source_verified && selected?.rights_verified)}>Утвердить</option>
                <option value="request_changes">Вернуть на доработку</option>
                <option value="reject">Отклонить</option>
              </select>
              <label style={{ fontSize: 12 }}>Обязательное заключение</label>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} style={{ width: "100%", minHeight: 80, marginBottom: 8 }} />
              <button onClick={submit} style={{ border: 0, borderRadius: 8, padding: "8px 12px", background: "#B85C4A", color: "#fff", cursor: "pointer" }}>Сохранить решение</button>
            </div>
          )}
          <h3 style={{ marginTop: 16 }}>История решений</h3>
          {history.map((h) => <div key={h.id} style={{ fontSize: 12, color: "#7A7268", marginBottom: 4 }}>{h.case_id}: {h.decision} — {h.comment}</div>)}
        </div>
      </div>
    </div>
  );
}
