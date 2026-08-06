import React, { useState, useEffect } from "react";
import { getClientToken } from "./lib/clientToken.js";
import { getBodySession } from "./lib/sessionAccess.js";

const PRESCRIBED_BY = [
  { value: "doctor", label: "Врач" },
  { value: "specialist", label: "Специалист" },
  { value: "self", label: "Самостоятельно" },
  { value: "unknown", label: "Не знаю / не помню" },
];

const LAB_ITEMS = [
  "Общий анализ крови", "Глюкоза", "Инсулин", "ТТГ", "Т4 свободный",
  "Ферритин", "Витамин D", "Липидограмма", "Другое",
];

const s = {
  page: { maxWidth: 780, margin: "32px auto 64px", padding: "0 16px", width: "100%", boxSizing: "border-box" },
  section: { padding: 20, borderRadius: 16, background: "#faf6ef", border: "1px solid #e8e2d8", marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 700, color: "#2f2925", marginBottom: 8, fontFamily: "Georgia, serif" },
  subtitle: { color: "#665c52", fontSize: 14, lineHeight: 1.5, marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: "#2f2925", marginBottom: 8 },
  note: { color: "#8a7e72", fontSize: 13, lineHeight: 1.5, marginBottom: 12 },
  input: { width: "100%", height: 44, padding: "0 14px", borderRadius: 12, border: "1px solid #d8cec1", background: "#fff", color: "#2f2925", fontSize: 15, outline: "none", fontFamily: "inherit", boxSizing: "border-box" },
  textarea: { width: "100%", minHeight: 80, padding: 12, borderRadius: 12, border: "1px solid #d8cec1", background: "#fff", color: "#2f2925", fontSize: 15, outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" },
  select: { width: "100%", height: 44, padding: "0 14px", borderRadius: 12, border: "1px solid #d8cec1", background: "#fff", color: "#2f2925", fontSize: 15, outline: "none", boxSizing: "border-box" },
  label: { display: "block", color: "#5f574f", fontSize: 14, fontWeight: 600, marginBottom: 5 },
  field: { marginBottom: 12 },
  row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  button: { width: "100%", height: 52, borderRadius: 16, border: 0, background: "#5f8b7a", color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: "inherit" },
  danger: { fontSize: 12, color: "#b5473f", background: "none", border: "none", cursor: "pointer", padding: "4px 0" },
  addBtn: { padding: "8px 16px", borderRadius: 10, border: "1px dashed #d8cec1", background: "#fff", cursor: "pointer", fontSize: 13, color: "#5f8b7a", fontWeight: 600 },
  chip: { padding: "6px 12px", borderRadius: 8, border: "1px solid #d8cec1", background: "#fff", cursor: "pointer", fontSize: 13, color: "#5f574f", textAlign: "center" },
  chipActive: { padding: "6px 12px", borderRadius: 8, border: "1px solid #86a08f", background: "#e8f0ea", cursor: "pointer", fontSize: 13, color: "#2f2925", fontWeight: 600, textAlign: "center" },
};

export default function BodyHealthContext({ onCancel, onComplete }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [conditions, setConditions] = useState([]);
  const [medications, setMedications] = useState([]);
  const [supplements, setSupplements] = useState([]);
  const [labNotes, setLabNotes] = useState({ has_recent_labs: false, labs_date: "", items: [], comment: "" });
  const [documentsNote, setDocumentsNote] = useState("");
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    async function load() {
      const saved = getBodySession();
      if (!saved.sessionId || !saved.accessToken) { setLoading(false); return; }
      try {
        let token;
        try { token = await getClientToken("body", "session"); } catch {}
        const hdrs = { "Content-Type": "application/json" };
        if (token) hdrs["Authorization"] = `Bearer ${token}`;
        const res = await fetch("/api/session", {
          method: "POST", headers: hdrs,
          body: JSON.stringify({ action: "getBodyHealthContext", session_id: saved.sessionId, access_token: saved.accessToken }),
        });
        const data = await res.json();
        if (data.ok && data.context) {
          const c = data.context;
          setConditions(c.health_conditions || []);
          setMedications(c.medications || []);
          setSupplements(c.supplements || []);
          setLabNotes(c.lab_notes || {});
          setDocumentsNote(c.documents_note || "");
          setConsent(c.consent_acknowledged || false);
        }
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  function addItem(list, setter, template) {
    setter([...list, template]);
  }
  function removeItem(list, setter, idx) {
    setter(list.filter((_, i) => i !== idx));
  }
  function updateItem(list, setter, idx, field, value) {
    setter(list.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    const saved = getBodySession();
    if (!saved.sessionId || !saved.accessToken) { setError("Сессия не найдена."); setSaving(false); return; }
    try {
      let token;
      try { token = await getClientToken("body", "session"); } catch {}
      const hdrs = { "Content-Type": "application/json" };
      if (token) hdrs["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/session", {
        method: "POST", headers: hdrs,
        body: JSON.stringify({
          action: "saveBodyHealthContext",
          session_id: saved.sessionId, access_token: saved.accessToken,
          health_context: {
            health_conditions: conditions,
            medications: medications,
            supplements: supplements,
            lab_notes: labNotes,
            documents_note: documentsNote || null,
            consent_acknowledged: consent,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Не удалось сохранить.");
      onComplete && onComplete();
    } catch (e) {
      setError(e.message || "Ошибка сохранения.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#8a7e72" }}>Загрузка...</div>;

  const hasAnything = conditions.length > 0 || medications.length > 0 || supplements.length > 0 || labNotes.has_recent_labs;

  return (
    <div style={s.page}>
      <div style={s.title}>Здоровье, анализы и препараты</div>
      <div style={s.subtitle}>
        Этот раздел помогает специалисту учитывать ваш контекст. Сервис не назначает и не отменяет лекарства, БАДы или лечение.
      </div>

      {/* Conditions */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Что важно знать о здоровье</div>
        <div style={s.note}>Есть ли состояния или диагнозы, которые важно учитывать?</div>
        {conditions.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <input style={s.input} placeholder="Например: гипотиреоз, диабет, гипертония..." value={c.name || ""} onChange={e => updateItem(conditions, setConditions, i, "name", e.target.value)} />
              <input style={{ ...s.input, marginTop: 6 }} placeholder="Комментарий (необязательно)" value={c.comment || ""} onChange={e => updateItem(conditions, setConditions, i, "comment", e.target.value)} />
            </div>
            <button onClick={() => removeItem(conditions, setConditions, i)} style={s.danger}>Убрать</button>
          </div>
        ))}
        <button onClick={() => addItem(conditions, setConditions, { name: "", status: "active", comment: "" })} style={s.addBtn}>+ Добавить состояние</button>
      </div>

      {/* Medications */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Лекарства</div>
        <div style={s.note}>Укажите только то, что уже принимаете. Не начинайте и не отменяйте препараты без врача.</div>
        {medications.map((m, i) => (
          <div key={i} style={{ padding: 12, borderRadius: 10, background: "#fff", border: "1px solid #e8e2d8", marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#2f2925" }}>Препарат {i + 1}</div>
              <button onClick={() => removeItem(medications, setMedications, i)} style={s.danger}>Убрать</button>
            </div>
            <div style={s.field}>
              <input style={s.input} placeholder="Название препарата" value={m.name || ""} onChange={e => updateItem(medications, setMedications, i, "name", e.target.value)} />
            </div>
            <div style={s.row2}>
              <div style={s.field}>
                <input style={s.input} placeholder="Дозировка" value={m.dosage || ""} onChange={e => updateItem(medications, setMedications, i, "dosage", e.target.value)} />
              </div>
              <div style={s.field}>
                <input style={s.input} placeholder="Как часто" value={m.frequency || ""} onChange={e => updateItem(medications, setMedications, i, "frequency", e.target.value)} />
              </div>
            </div>
            <div style={s.field}>
              <select style={s.select} value={m.prescribed_by || ""} onChange={e => updateItem(medications, setMedications, i, "prescribed_by", e.target.value)}>
                <option value="">Кто назначил?</option>
                {PRESCRIBED_BY.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div style={s.field}>
              <input style={s.input} placeholder="Комментарий (необязательно)" value={m.comment || ""} onChange={e => updateItem(medications, setMedications, i, "comment", e.target.value)} />
            </div>
          </div>
        ))}
        <button onClick={() => addItem(medications, setMedications, { name: "", dosage: "", frequency: "", prescribed_by: "", comment: "" })} style={s.addBtn}>+ Добавить препарат</button>
      </div>

      {/* Supplements */}
      <div style={s.section}>
        <div style={s.sectionTitle}>БАДы и витамины</div>
        <div style={s.note}>БАДы тоже важно учитывать: они могут влиять на самочувствие и сочетаться с препаратами.</div>
        {supplements.map((sp, i) => (
          <div key={i} style={{ padding: 12, borderRadius: 10, background: "#fff", border: "1px solid #e8e2d8", marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#2f2925" }}>БАД / витамин {i + 1}</div>
              <button onClick={() => removeItem(supplements, setSupplements, i)} style={s.danger}>Убрать</button>
            </div>
            <div style={s.field}>
              <input style={s.input} placeholder="Название" value={sp.name || ""} onChange={e => updateItem(supplements, setSupplements, i, "name", e.target.value)} />
            </div>
            <div style={s.row2}>
              <div style={s.field}>
                <input style={s.input} placeholder="Дозировка" value={sp.dosage || ""} onChange={e => updateItem(supplements, setSupplements, i, "dosage", e.target.value)} />
              </div>
              <div style={s.field}>
                <input style={s.input} placeholder="Как часто" value={sp.frequency || ""} onChange={e => updateItem(supplements, setSupplements, i, "frequency", e.target.value)} />
              </div>
            </div>
            <div style={s.field}>
              <select style={s.select} value={sp.recommended_by || ""} onChange={e => updateItem(supplements, setSupplements, i, "recommended_by", e.target.value)}>
                <option value="">Кто рекомендовал?</option>
                {PRESCRIBED_BY.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div style={s.field}>
              <input style={s.input} placeholder="Комментарий (необязательно)" value={sp.comment || ""} onChange={e => updateItem(supplements, setSupplements, i, "comment", e.target.value)} />
            </div>
          </div>
        ))}
        <button onClick={() => addItem(supplements, setSupplements, { name: "", dosage: "", frequency: "", recommended_by: "", comment: "" })} style={s.addBtn}>+ Добавить БАД / витамин</button>
      </div>

      {/* Labs */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Анализы и выписки</div>
        <div style={s.note}>Пока можно описать анализы словами. Загрузку файлов добавим позже.</div>
        <div style={s.field}>
          <label style={s.label}>Есть ли свежие анализы?</label>
          <div style={{ display: "flex", gap: 8 }}>
            {[{ v: true, l: "Да" }, { v: false, l: "Нет" }].map(o => (
              <button key={String(o.v)} onClick={() => setLabNotes({ ...labNotes, has_recent_labs: o.v })} style={labNotes.has_recent_labs === o.v ? s.chipActive : s.chip}>{o.l}</button>
            ))}
          </div>
        </div>
        {labNotes.has_recent_labs && (
          <>
            <div style={s.field}>
              <label style={s.label}>Какие есть данные?</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {LAB_ITEMS.map(item => {
                  const active = (labNotes.items || []).includes(item);
                  return (
                    <button key={item} onClick={() => {
                      const items = labNotes.items || [];
                      setLabNotes({ ...labNotes, items: active ? items.filter(x => x !== item) : [...items, item] });
                    }} style={active ? s.chipActive : s.chip}>{item}</button>
                  );
                })}
              </div>
            </div>
            <div style={s.field}>
              <label style={s.label}>Дата анализов</label>
              <input style={s.input} type="date" value={labNotes.labs_date || ""} onChange={e => setLabNotes({ ...labNotes, labs_date: e.target.value })} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Что важно из анализов или выписки?</label>
              <textarea style={s.textarea} placeholder="Свободным текстом..." value={labNotes.comment || ""} onChange={e => setLabNotes({ ...labNotes, comment: e.target.value })} />
            </div>
          </>
        )}
      </div>

      {/* Consent */}
      {hasAnything && (
        <div style={{ ...s.section, background: "#fdf6ee", border: "1px solid #e8d5b8" }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
            <span style={{ fontSize: 13, color: "#5f574f", lineHeight: 1.5 }}>
              Я понимаю, что сервис не назначает и не отменяет лекарства. Эти данные нужны как контекст для специалиста.
            </span>
          </label>
        </div>
      )}

      {error && <div style={{ color: "#b5473f", fontSize: 14, marginBottom: 12 }}>{error}</div>}

      {/* Actions */}
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={handleSave} disabled={saving} style={{ ...s.button, flex: 1, opacity: saving ? 0.6 : 1, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Сохранение..." : "Сохранить"}
        </button>
        <button onClick={onCancel} disabled={saving} style={{ padding: "12px 20px", borderRadius: 16, border: "1px solid #d8cec1", background: "#ede7dc", color: "#2f2925", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
          Вернуться в кабинет
        </button>
      </div>
    </div>
  );
}
