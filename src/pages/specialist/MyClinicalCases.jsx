import React, { useEffect, useState } from "react";

const PAGE = { minHeight: "100vh", background: "#F6F0E7", color: "#2E2A25", padding: "24px 16px", fontFamily: "Inter,system-ui,sans-serif" };
const CARD = { background: "#fffdf9", border: "1px solid #e4dcd1", borderRadius: 16, padding: 20, marginBottom: 16 };
const INPUT = { width: "100%", boxSizing: "border-box", border: "1px solid #d6cbbd", borderRadius: 9, background: "#fff", color: "#282924", fontSize: 14, padding: "10px", marginTop: 6 };
const BTN = { border: 0, borderRadius: 9, padding: "10px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer", background: "#B85C4A", color: "#fff" };
const TXT = { fontSize: 13, color: "#75695e", lineHeight: 1.55 };
const emptyCase = () => ({
  module: (() => { try { return sessionStorage.getItem("specialist_module") === "body" ? "health" : "support"; } catch { return "support"; } })(),
  title: "", age_band: "не указана", sex: "не указано",
  complaints: "", anamnesis: "", diagnosis: "", examinations: "",
  medications: [], psychotherapy: "", other_treatment: "", outcomes: "",
  adverse_events: "", observation_period: "", clinical_limitations: "",
  deidentified_confirmed: false, lawful_use_confirmed: false,
});
const statusNames = {
  draft: "Черновик", submitted: "На экспертизе", changes_requested: "На доработке",
  accepted: "Принят", rejected: "Отклонён",
};
async function request(action, data = {}) {
  const response = await fetch("/api/clinical-contributions", {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...data }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.ok) throw new Error(json.error || "Ошибка соединения");
  return json;
}
function Field({ label, value, onChange, rows = 3, hint }) {
  return <label style={{ display: "block", marginBottom: 14, fontSize: 13, fontWeight: 700 }}>
    {label}
    {rows > 1
      ? <textarea style={{ ...INPUT, minHeight: rows * 28, resize: "vertical" }} value={value || ""} onChange={(e) => onChange(e.target.value)} />
      : <input style={INPUT} value={value || ""} onChange={(e) => onChange(e.target.value)} />}
    {hint && <span style={{ ...TXT, display: "block" }}>{hint}</span>}
  </label>;
}
function CaseDetails({ item }) {
  if (!item) return null;
  const pairs = [
    ["Жалобы", item.complaints], ["Анамнез", item.anamnesis], ["Диагноз", item.diagnosis],
    ["Обследования", item.examinations], ["Психотерапевтическая помощь", item.psychotherapy],
    ["Другое лечение", item.other_treatment], ["Результат", item.outcomes],
    ["Побочные эффекты и осложнения", item.adverse_events],
    ["Продолжительность наблюдения", item.observation_period], ["Ограничения", item.clinical_limitations],
  ];
  return <div style={{ fontSize: 13, lineHeight: 1.65 }}>
    <div style={TXT}>Возрастная группа: {item.age_band} · Пол: {item.sex} · Направление: {item.module === "health" ? "Health" : "Support"}</div>
    {pairs.map(([name, value]) => value && <p key={name}><strong>{name}:</strong> {value}</p>)}
    <strong>Медикаментозное лечение:</strong>
    {item.medications?.length
      ? item.medications.map((m, i) => <div key={i} style={{ borderLeft: "2px solid #B85C4A", margin: "8px 0", paddingLeft: 12 }}>
          <b>{m.inn}</b> {m.dose ? "· " + m.dose : ""}<div>Цель: {m.purpose || "не указана"}</div><div>Результат: {m.result || "не указан"}</div>
        </div>)
      : <p style={TXT}>Препараты не описаны. Не следует считать, что они не применялись.</p>}
  </div>;
}
export default function MyClinicalCases() {
  const [items, setItems] = useState([]);
  const [queue, setQueue] = useState([]);
  const [tab, setTab] = useState("mine");
  const [reviewer, setReviewer] = useState(false);
  const [demoPoints, setDemoPoints] = useState(0);
  const [currentId, setCurrentId] = useState(null);
  const [form, setForm] = useState(emptyCase);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState(null);
  const [decision, setDecision] = useState("changes_requested");
  const [reviewComment, setReviewComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    const mine = await request("mine");
    setItems(mine.items || []);
    setDemoPoints(mine.demo_points || 0);
    setReviewer(!!mine.reviewer);
    if (mine.reviewer) {
      const review = await request("reviewQueue");
      setQueue(review.items || []);
    }
  };
  useEffect(() => { refresh().catch((err) => setError(err.message)); }, []);
  const editField = (key, value) => { setForm((s) => ({ ...s, [key]: value })); setDirty(true); };
  const openItem = (item) => {
    setForm({ ...emptyCase(), ...item, medications: Array.isArray(item.medications) ? item.medications : [] });
    setCurrentId(item.id);
    setDirty(false);
    setError(""); setNotice(""); setTab("mine");
  };
  const newItem = () => { setCurrentId(null); setForm(emptyCase()); setDirty(false); setNotice(""); setError(""); setTab("mine"); };
  const run = async (callback) => {
    setBusy(true); setError(""); setNotice("");
    try { await callback(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const org = (() => { try { return sessionStorage.getItem("specialist_org_id") || null; } catch { return null; } })();
    const response = await request("save", { id: currentId, case: form, organization_id: org });
    setCurrentId(response.item.id); setForm((x) => ({ ...x, ...response.item }));
    setDirty(false); setNotice("Черновик сохранён"); await refresh();
  });
  const submit = () => run(async () => {
    await request("submit", { id: currentId });
    setCurrentId(null); setForm(emptyCase()); setDirty(false);
    setNotice("Обезличенное описание отправлено эксперту"); await refresh();
  });
  const review = () => run(async () => {
    await request("review", { id: selected.id, decision, comment: reviewComment });
    setNotice(decision === "accept" ? "Наблюдение принято; тестовые баллы начислены автору" : "Решение сохранено");
    setSelected(null); setReviewComment(""); await refresh();
  });
  const canEdit = !currentId || ["draft", "changes_requested"].includes(form.status);
  const selectedBadge = currentId && form.status ? statusNames[form.status] : "Новая карточка";
  return <div style={PAGE}>
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <a href="/specialist" style={{ fontSize: 14, color: "#a14d3e", fontWeight: 700 }}>← Вернуться в кабинет врача</a>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Мои клинические случаи</h1>
      <p style={{ ...TXT, fontSize: 14 }}>Обезличенные врачебные наблюдения и экспертная проверка. Только тестовый контур.</p>
      <div style={{ ...CARD, background: "#fff6e8", borderColor: "#e9cfaa" }}>
        <b>Не загружайте медицинские карты и персональные данные пациентов.</b>
        <p style={{ ...TXT, margin: "6px 0 0" }}>Это демонстрационный инструмент. Допускаются только искусственные или надлежащим образом обезличенные описания при наличии законных оснований. Не указывайте ФИО, точный возраст, дату рождения, адреса, контакты, номер карты или редкие идентифицирующие обстоятельства. Автоматическая проверка не гарантирует обезличивание.</p>
      </div>
      <div style={{ ...CARD, display: "flex", justifyContent: "space-between", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
        <div><b>Мой клинический вклад</b><p style={{ ...TXT, margin: "4px 0" }}>Принято: {items.filter((x) => x.status === "accepted").length} · На проверке: {items.filter((x) => x.status === "submitted").length}</p></div>
        <div style={{ textAlign: "right" }}><b style={{ fontSize: 23, color: "#9f5542" }}>+{demoPoints}</b><div style={TXT}>Демонстрационных баллов · не обмениваются на услуги или деньги</div></div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button style={{ ...BTN, background: tab === "mine" ? "#B85C4A" : "#85796f" }} onClick={() => setTab("mine")}>Мои наблюдения</button>
        {reviewer && <button style={{ ...BTN, background: tab === "review" ? "#B85C4A" : "#85796f" }} onClick={() => setTab("review")}>Экспертиза ({queue.length})</button>}
      </div>
      {error && <p style={{ ...CARD, color: "#a52c2c" }}>{error}</p>}
      {notice && <p style={{ ...CARD, color: "#43785b" }}>{notice}</p>}
      {tab === "mine" && <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) minmax(300px,2fr)", gap: 16 }}>
        <div>
          <div style={CARD}><button style={BTN} onClick={newItem}>+ Добавить клинический случай</button></div>
          {items.map((item) => <button key={item.id} onClick={() => openItem(item)}
            style={{ ...CARD, width: "100%", textAlign: "left", cursor: "pointer", color: "#2E2A25", background: currentId === item.id ? "#fbeadf" : "#fffdf9" }}>
            <strong>{item.title || "Новый черновик"}</strong><div style={TXT}>{item.module === "health" ? "Health" : "Support"} · {statusNames[item.status] || item.status}</div>
            {item.review_comment && <div style={{ ...TXT, marginTop: 6 }}>Эксперт: {item.review_comment}</div>}
          </button>)}
          {!items.length && <p style={TXT}>Пока нет наблюдений. Начни с обезличенного учебного примера.</p>}
        </div>
        <div style={CARD}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <h2 style={{ fontSize: 19, marginTop: 0 }}>Карточка наблюдения</h2>
            <span style={TXT}>{selectedBadge}</span>
          </div>
          {canEdit ? <>
            <label style={{ fontSize: 13, fontWeight: 700 }}>Направление
              <select style={INPUT} value={form.module} onChange={(e) => editField("module", e.target.value)}>
                <option value="support">Support — психология и психиатрия</option>
                <option value="health">Health — здоровье и стройность</option>
              </select>
            </label>
            <Field label="Название случая" rows={1} value={form.title} onChange={(v) => editField("title", v)} />
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <label style={{ flex: 1, fontSize: 13 }}>Возрастная группа<select style={INPUT} value={form.age_band} onChange={(e) => editField("age_band", e.target.value)}>
                {["не указана", "0–17", "18–29", "30–44", "45–59", "60–74", "75+"].map((x) => <option key={x}>{x}</option>)}
              </select></label>
              <label style={{ flex: 1, fontSize: 13 }}>Пол<select style={INPUT} value={form.sex} onChange={(e) => editField("sex", e.target.value)}>
                {["не указано", "женский", "мужской", "другое"].map((x) => <option key={x}>{x}</option>)}
              </select></label>
            </div>
            <Field label="Жалобы и симптомы" value={form.complaints} onChange={(v) => editField("complaints", v)} />
            <Field label="Анамнез без идентифицирующих деталей" value={form.anamnesis} onChange={(v) => editField("anamnesis", v)} />
            <Field label="Диагноз (если установлен врачом)" rows={2} value={form.diagnosis} onChange={(v) => editField("diagnosis", v)} />
            <Field label="Обследования" value={form.examinations} onChange={(v) => editField("examinations", v)} />
            <div style={{ padding: 12, borderRadius: 10, background: "#f8f1e9", marginBottom: 15 }}>
              <b>Медикаментозное лечение</b>
              {(form.medications || []).map((m, i) => <div key={i} style={{ background: "#fff", borderRadius: 9, padding: 9, marginTop: 10 }}>
                {[["inn", "МНН / препарат"], ["dose", "Дозировка и режим"], ["purpose", "Показания в данном случае"], ["result", "Результат, нежелательные явления"]].map(([key, label]) => <Field key={key} rows={1} label={label} value={m[key]} onChange={(v) => {
                  const next = [...form.medications]; next[i] = { ...m, [key]: v }; editField("medications", next);
                }} />)}
                <button style={{ ...BTN, background: "#85796f" }} onClick={() => editField("medications", form.medications.filter((_, j) => j !== i))}>Удалить препарат</button>
              </div>)}
              <button style={{ ...BTN, background: "#85796f", marginTop: 12 }} onClick={() => editField("medications", [...form.medications, { inn: "", dose: "", purpose: "", result: "" }])}>+ Добавить препарат</button>
            </div>
            <Field label="Психотерапевтическая помощь" value={form.psychotherapy} onChange={(v) => editField("psychotherapy", v)} />
            <Field label="Другое лечение" value={form.other_treatment} onChange={(v) => editField("other_treatment", v)} />
            <Field label="Результаты и динамика" value={form.outcomes} onChange={(v) => editField("outcomes", v)} />
            <Field label="Осложнения и нежелательные реакции" value={form.adverse_events} onChange={(v) => editField("adverse_events", v)} />
            <Field label="Период наблюдения (без точных дат)" rows={1} value={form.observation_period} onChange={(v) => editField("observation_period", v)} />
            <Field label="Ограничения выводов" value={form.clinical_limitations} onChange={(v) => editField("clinical_limitations", v)} />
            <label style={{ display: "block", fontSize: 13, marginBottom: 12 }}>
              <input type="checkbox" checked={!!form.deidentified_confirmed} onChange={(e) => editField("deidentified_confirmed", e.target.checked)} /> Я проверил(а), что описание не позволяет установить личность пациента.
            </label>
            <label style={{ display: "block", fontSize: 13, marginBottom: 15 }}>
              <input type="checkbox" checked={!!form.lawful_use_confirmed} onChange={(e) => editField("lawful_use_confirmed", e.target.checked)} /> Подтверждаю наличие законных оснований для использования этих сведений.
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={BTN} disabled={busy} onClick={save}>{busy ? "Сохраняем…" : "Сохранить черновик"}</button>
              {currentId && <button style={{ ...BTN, background: "#567864" }} disabled={busy || dirty} title={dirty ? "Сначала сохраните изменения" : ""} onClick={submit}>Отправить на экспертизу</button>}
            </div>
          </> : <>
            <CaseDetails item={form} />
            <p style={TXT}>После отправки редактирование закрыто до решения эксперта.</p>
            {form.review_comment && <p><strong>Заключение эксперта:</strong> {form.review_comment}</p>}
          </>}
        </div>
      </div>}
      {tab === "review" && reviewer && <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,1fr) minmax(300px,2fr)", gap: 16 }}>
        <div>{queue.map((item) => <button key={item.id} onClick={() => { setSelected(item); setReviewComment(""); setError(""); }}
          style={{ ...CARD, cursor: "pointer", textAlign: "left", width: "100%", color: "#2E2A25" }}>
          <b>{item.title}</b><div style={TXT}>{item.module === "health" ? "Health" : "Support"} · Ожидает решения</div>
        </button>)}{!queue.length && <div style={CARD}>Очередь пуста.</div>}</div>
        <div style={CARD}>{selected ? <>
          <h2>{selected.title}</h2>
          <CaseDetails item={selected} />
          <label style={{ fontSize: 13 }}>Решение<select value={decision} onChange={(e) => setDecision(e.target.value)} style={INPUT}>
            <option value="changes_requested">Вернуть на доработку</option>
            <option value="rejected">Отклонить</option>
            <option value="accept">Принять в тестовую библиотеку (+100 демонстрационных баллов автору)</option>
          </select></label>
          <Field label="Обязательное экспертное заключение" value={reviewComment} onChange={setReviewComment} />
          <p style={TXT}>Оценка относится к качеству описания, не к правильности лечения. Принятие не публикует сведения пациентам и не начисляет реальные деньги.</p>
          <button style={BTN} disabled={busy} onClick={review}>{busy ? "Сохраняем…" : "Сохранить решение"}</button>
        </> : <p style={TXT}>Выберите наблюдение слева.</p>}</div>
      </div>}
    </div>
  </div>;
}
