import React, { useEffect, useState } from "react";
import { getBodySession, getSupportSession } from "./lib/sessionAccess.js";

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localTime() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const emptyForm = () => ({
  item_type: "medication", name: "", active_ingredient: "", dosage_form: "", strength: "",
  single_dose: "", dose_unit: "мг", route: "", frequency_type: "times_per_day",
  times_per_day: "1", scheduled_times: ["08:00"], instructions: "", start_date: localDate(),
  end_date: "", ongoing: false, doctor_comment: "", patient_comment: "",
});

const shell = { padding: 18, borderRadius: 14, background: "#faf6ef", border: "1px solid #e8e2d8", marginBottom: 18 };
const input = { width: "100%", minHeight: 42, padding: "8px 12px", borderRadius: 9, border: "1px solid #d8cec1", background: "white", color: "#2f2925", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" };
const labelStyle = { display: "block", marginBottom: 5, color: "#5f574f", fontSize: 13, fontWeight: 600 };
const fieldStyle = { marginBottom: 11 };
const primaryButton = { padding: "9px 14px", borderRadius: 9, border: 0, background: "#7D9A89", color: "white", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

function orderLabel(order) {
  return order.item_type === "supplement" ? "Рекомендовано врачом — со слов пациента" : "Назначено врачом — со слов пациента";
}

function frequencyLabel(order) {
  if (order.frequency_type === "scheduled_times") return `${order.scheduled_times?.length || 0} раз${order.scheduled_times?.length === 1 ? "" : "а"} в день · ${(order.scheduled_times || []).join(" / ")}`;
  if (order.frequency_type === "times_per_day") return `${order.times_per_day} раз${order.times_per_day === 1 ? "" : "а"} в день`;
  if (order.frequency_type === "as_needed") return "По необходимости";
  return order.instructions || "Схема указана пациентом";
}

export default function PatientMedicationOrders({ module = "health", mode = "manage", scheduledDate, sessionId }) {
  const [orders, setOrders] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [intakeDraft, setIntakeDraft] = useState(null);
  const [referenceCandidates, setReferenceCandidates] = useState({});
  const [referenceLoadingId, setReferenceLoadingId] = useState(null);

  function getSession() {
    const saved = module === "support" ? getSupportSession() : getBodySession();
    return { session_id: sessionId || saved.sessionId, access_token: saved.accessToken };
  }

  async function request(action, extra = {}) {
    const auth = getSession();
    if (!auth.session_id || !auth.access_token) throw new Error("Сессия не найдена. Войдите в кабинет заново.");
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, module, ...auth, ...extra }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Не удалось выполнить запрос.");
    return data;
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const data = await request("listPatientMedicationOrders", {
        include_schedule: mode === "schedule",
        scheduled_date: scheduledDate || localDate(),
      });
      setOrders(data.orders || []);
      setSchedule(data.schedule || []);
    } catch (e) {
      setError(e.message || "Не удалось загрузить список.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [module, mode, scheduledDate, sessionId]);

  function beginEdit(order) {
    setEditingId(order.id);
    setForm({ ...emptyForm(), ...order, single_dose: String(order.single_dose), end_date: order.end_date || "", scheduled_times: order.scheduled_times || ["08:00"] });
    setFormOpen(true);
    setNotice("");
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm());
  }

  async function saveOrder(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const data = await request("savePatientMedicationOrder", { order_id: editingId || undefined, order: form });
      closeForm();
      await refresh();
      setNotice(data.message || "Изменения сохранены.");
    } catch (e) {
      setError(e.message || "Не удалось сохранить назначение.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(order, status) {
    setError("");
    try {
      await request("updatePatientMedicationOrderStatus", { order_id: order.id, status });
      await refresh();
      setNotice(status === "completed" ? "Назначение завершено." : status === "cancelled" ? "Назначение убрано из активного списка." : "Статус обновлён.");
    } catch (e) {
      setError(e.message || "Не удалось обновить статус.");
    }
  }

  async function findReferenceCandidates(order) {
    setReferenceLoadingId(order.id);
    setError("");
    try {
      const result = await request("findPatientMedicationReferenceCandidates", { order_id: order.id });
      setReferenceCandidates((current) => ({ ...current, [order.id]: result }));
      await refresh();
    } catch (e) {
      setError(e.message || "Не удалось проверить точное совпадение.");
    } finally {
      setReferenceLoadingId(null);
    }
  }

  async function confirmReferenceCandidate(order, concept) {
    setError("");
    try {
      await request("confirmPatientMedicationReferenceMatch", { order_id: order.id, medication_concept_id: concept.medication_concept_id });
      setReferenceCandidates((current) => ({ ...current, [order.id]: null }));
      await refresh();
      setNotice("Название сопоставлено с внутренним каталогом. Это не подтверждает сведения о препарате.");
    } catch (e) {
      setError(e.message || "Не удалось сохранить сопоставление.");
    }
  }

  async function saveIntake(task, status) {
    const draft = intakeDraft?.key === `${task.medication_order_id}:${task.scheduled_slot}` ? intakeDraft : {};
    setError("");
    try {
      await request("recordMedicationIntake", {
        order_id: task.medication_order_id,
        intake: {
          scheduled_date: task.scheduled_date,
          scheduled_slot: task.scheduled_slot,
          status,
          actual_time: status === "taken_late" ? draft.actual_time : status === "taken" || status === "different_dose" ? localTime() : null,
          actual_dose: status === "different_dose" ? draft.actual_dose : null,
          actual_dose_unit: status === "different_dose" ? draft.actual_dose_unit : null,
          patient_note: draft.patient_note || "",
        },
      });
      setIntakeDraft(null);
      await refresh();
    } catch (e) {
      setError(e.message || "Не удалось сохранить отметку.");
    }
  }

  const scheduleMode = mode === "schedule";
  const activeOrders = orders.filter((order) => order.status === "active");
  const draftKey = (task) => `${task.medication_order_id}:${task.scheduled_slot}`;
  const updateDraft = (task, changes) => setIntakeDraft((current) => ({
    key: draftKey(task),
    ...(current?.key === draftKey(task) ? current : {}),
    ...changes,
  }));

  if (loading) return <div style={{ padding: 12, color: "#7a7268", fontSize: 13 }}>Загружаем список лекарств и БАДов…</div>;

  return (
    <section style={shell} data-testid={scheduleMode ? "medication-intake-schedule" : "patient-medication-orders"}>
      <div style={{ fontSize: 17, fontWeight: 700, color: "#2f2925", marginBottom: 6 }}>
        {scheduleMode ? "Лекарства и БАДы сегодня" : "Лекарства и БАДы"}
      </div>
      <div style={{ color: "#7a7268", fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>
        Сведения записаны со слов пациента. Сервис не проверяет назначение врача и не меняет схему приёма.
      </div>

      {error && <div role="alert" style={{ color: "#b5473f", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {notice && <div role="status" style={{ color: "#426b55", fontSize: 13, marginBottom: 10 }}>{notice}</div>}

      {scheduleMode ? (
        schedule.length === 0 ? <div style={{ color: "#7a7268", fontSize: 13 }}>На этот день нет запланированных приёмов.</div> : (
          <div style={{ display: "grid", gap: 10 }}>
            {schedule.map((task) => {
              const log = task.intake_log;
              const draft = intakeDraft?.key === draftKey(task) ? intakeDraft : {};
              return (
                <div key={draftKey(task)} style={{ padding: 12, background: "white", border: "1px solid #e8e2d8", borderRadius: 11 }}>
                  <div style={{ fontWeight: 700, color: "#2f2925" }}>{task.name} · {task.single_dose} {task.dose_unit}</div>
                  <div style={{ fontSize: 13, color: "#665c52", marginTop: 3 }}>
                    {task.scheduled_time || `Приём ${task.scheduled_slot}, время не указано`}
                  </div>
                  {log ? (
                    <div style={{ marginTop: 8, color: "#426b55", fontSize: 13 }}>
                      {({ taken: "Принял(а)", missed: "Пропустил(а)", taken_late: `Принял(а) позже${log.actual_time ? `, в ${log.actual_time.slice(0, 5)}` : ""}`, different_dose: `Другая доза: ${log.actual_dose} ${log.actual_dose_unit}` })[log.status]}
                      {log.patient_note && <div style={{ color: "#7a7268", marginTop: 3 }}>{log.patient_note}</div>}
                    </div>
                  ) : (
                    <>
                      <label style={{ display: "block", marginTop: 9 }}>
                        <span style={labelStyle}>Комментарий / самочувствие после приёма</span>
                        <input style={input} placeholder="Необязательно" value={draft.patient_note || ""} onChange={(e) => updateDraft(task, { patient_note: e.target.value })} />
                      </label>
                      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
                        <button type="button" style={primaryButton} onClick={() => saveIntake(task, "taken")}>Принял</button>
                        <button type="button" style={{ ...primaryButton, background: "#ede7dc", color: "#5f574f" }} onClick={() => saveIntake(task, "missed")}>Пропустил</button>
                        <button type="button" style={{ ...primaryButton, background: "#fff", color: "#5f8b7a", border: "1px solid #7d9a89" }} onClick={() => updateDraft(task, { mode: "late" })}>Принял позже</button>
                        <button type="button" style={{ ...primaryButton, background: "#fff", color: "#5f8b7a", border: "1px solid #7d9a89" }} onClick={() => updateDraft(task, { mode: "dose" })}>Другая доза</button>
                      </div>
                      {draft.mode === "late" && (
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 180px) auto", gap: 8, alignItems: "end", marginTop: 10 }}>
                          <label style={fieldStyle}><span style={labelStyle}>Фактическое время</span><input type="time" style={input} value={draft.actual_time || ""} onChange={(e) => updateDraft(task, { actual_time: e.target.value })} /></label>
                          <button type="button" style={primaryButton} onClick={() => saveIntake(task, "taken_late")}>Сохранить</button>
                        </div>
                      )}
                      {draft.mode === "dose" && (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                          <label style={fieldStyle}><span style={labelStyle}>Фактическая доза</span><input type="number" min="0.01" step="any" style={input} value={draft.actual_dose || ""} onChange={(e) => updateDraft(task, { actual_dose: e.target.value })} /></label>
                          <label style={fieldStyle}><span style={labelStyle}>Единица</span><input style={input} value={draft.actual_dose_unit || task.dose_unit} onChange={(e) => updateDraft(task, { actual_dose_unit: e.target.value })} /></label>
                          <button type="button" style={{ ...primaryButton, gridColumn: "1 / -1", justifySelf: "start" }} onClick={() => saveIntake(task, "different_dose")}>Сохранить отметку</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : (
        <>
          {activeOrders.length === 0 && <div style={{ color: "#7a7268", fontSize: 13, marginBottom: 10 }}>Пока нет активных назначений.</div>}
          <div style={{ display: "grid", gap: 9 }}>
            {orders.map((order) => (
              <article key={order.id} style={{ padding: 12, background: "white", border: "1px solid #e8e2d8", borderRadius: 11 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "#2f2925" }}>{order.name}</div>
                    {order.strength && <div style={{ fontSize: 13, color: "#665c52", marginTop: 2 }}>{order.strength}</div>}
                    <div style={{ fontSize: 13, color: "#665c52", marginTop: 3 }}>{order.single_dose} {order.dose_unit} · {frequencyLabel(order)}</div>
                    <div style={{ fontSize: 12, color: "#7a7268", marginTop: 3 }}>
                      С {new Date(`${order.start_date}T00:00:00`).toLocaleDateString("ru-RU")}{order.end_date ? ` по ${new Date(`${order.end_date}T00:00:00`).toLocaleDateString("ru-RU")}` : order.ongoing ? " · постоянно" : ""}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: "#5f7d6c", textAlign: "right" }}>{order.status === "active" ? "Активно" : order.status === "completed" ? "Завершено" : order.status === "paused" ? "Приостановлено" : "Архив"}</span>
                </div>
                <div style={{ marginTop: 8, padding: "7px 9px", borderRadius: 8, background: "#f4f1eb", color: "#665c52", fontSize: 11 }}>{orderLabel(order)}</div>
                <div style={{ marginTop: 8, fontSize: 12, color: "#665c52" }}>
                  <strong>Справочная информация: </strong>
                  {order.medication_reference?.verified_reference?.verified
                    ? `${order.medication_reference.verified_reference.source.source_title} · ${order.medication_reference.verified_reference.source.source_version} · ${new Date(order.medication_reference.verified_reference.source.retrieved_at).toLocaleDateString("ru-RU")}`
                    : order.reference_status === "matched"
                      ? `название сопоставлено${order.medication_reference?.concept?.display_name ? `: ${order.medication_reference.concept.display_name}` : ""}, но источник не подтверждён`
                      : order.reference_status === "candidate"
                        ? "есть кандидат по точному совпадению названия; сопоставление не подтверждено"
                        : order.reference_status === "ambiguous"
                          ? "найдено несколько точных вариантов; требуется выбор пациента"
                          : "пока не подтверждена"}
                </div>
                {order.item_type === "medication" && order.reference_status !== "verified" && order.reference_status !== "matched" && (
                  <div style={{ marginTop: 6 }}>
                    <button type="button" disabled={referenceLoadingId === order.id} onClick={() => findReferenceCandidates(order)} style={{ border: 0, background: "none", color: "#5f8b7a", padding: 0, cursor: "pointer", fontSize: 12 }}>
                      {referenceLoadingId === order.id ? "Проверяем точное совпадение…" : "Найти точное совпадение"}
                    </button>
                    {referenceCandidates[order.id] && (
                      referenceCandidates[order.id].candidates?.length ? (
                        <div style={{ marginTop: 6, padding: 9, background: "#f7f5f0", borderRadius: 8 }}>
                          <div style={{ color: "#7a7268", fontSize: 11, marginBottom: 5 }}>Кандидат по названию. Выбор связывает названия, но не подтверждает справочные факты.</div>
                          {referenceCandidates[order.id].candidates.map((concept) => (
                            <div key={concept.medication_concept_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 5 }}>
                              <span style={{ fontSize: 12 }}>{concept.display_name}</span>
                              <button type="button" onClick={() => confirmReferenceCandidate(order, concept)} style={{ border: "1px solid #7d9a89", borderRadius: 7, background: "white", color: "#5f7d6c", padding: "4px 8px", cursor: "pointer", fontSize: 11 }}>Это мой препарат</button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ marginTop: 5, color: "#7a7268", fontSize: 11 }}>Точного совпадения нет. Справочная информация недоступна.</div>
                      )
                    )}
                  </div>
                )}
                {(order.active_ingredient || order.dosage_form || order.route || order.instructions || order.doctor_comment || order.patient_comment) && (
                  <div style={{ marginTop: 7, fontSize: 12, color: "#7a7268", lineHeight: 1.45 }}>
                    {order.active_ingredient && <div>Действующее вещество: {order.active_ingredient}</div>}
                    {order.dosage_form && <div>Форма: {order.dosage_form}</div>}
                    {order.route && <div>Способ применения: {order.route}</div>}
                    {order.instructions && <div>Указание: {order.instructions}</div>}
                    {order.doctor_comment && <div>Комментарий врача (со слов пациента): {order.doctor_comment}</div>}
                    {order.patient_comment && <div>Комментарий пациента: {order.patient_comment}</div>}
                  </div>
                )}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                  <button type="button" onClick={() => beginEdit(order)} style={{ border: 0, background: "none", color: "#5f8b7a", padding: 0, cursor: "pointer", fontSize: 12 }}>Изменить</button>
                  {order.status === "active" && <>
                    <button type="button" onClick={() => changeStatus(order, "completed")} style={{ border: 0, background: "none", color: "#5f8b7a", padding: 0, cursor: "pointer", fontSize: 12 }}>Завершить</button>
                    <button type="button" onClick={() => changeStatus(order, "cancelled")} style={{ border: 0, background: "none", color: "#b5473f", padding: 0, cursor: "pointer", fontSize: 12 }}>Убрать из списка</button>
                  </>}
                </div>
              </article>
            ))}
          </div>

          {!formOpen ? (
            <button type="button" style={{ ...primaryButton, marginTop: 12 }} onClick={() => { setForm(emptyForm()); setFormOpen(true); setEditingId(null); }}>+ Добавить назначение врача</button>
          ) : (
            <form onSubmit={saveOrder} style={{ marginTop: 14, padding: 14, background: "white", border: "1px solid #d8cec1", borderRadius: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 12, color: "#2f2925" }}>{editingId ? "Изменить назначение" : "Что назначил или рекомендовал врач?"}</div>
              <div style={fieldStyle}><label style={labelStyle}>Что назначил или рекомендовал врач?</label><select style={input} value={form.item_type} onChange={(e) => setForm({ ...form, item_type: e.target.value })}><option value="medication">Лекарственный препарат</option><option value="supplement">БАД</option></select></div>
              <div style={fieldStyle}><label style={labelStyle}>Название *</label><input required maxLength={200} style={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 9 }}>
                <label style={fieldStyle}><span style={labelStyle}>Разовая доза *</span><input required type="number" min="0.01" step="any" style={input} value={form.single_dose} onChange={(e) => setForm({ ...form, single_dose: e.target.value })} /></label>
                <label style={fieldStyle}><span style={labelStyle}>Единица дозы *</span><input required maxLength={40} style={input} placeholder="мг, таблетка" value={form.dose_unit} onChange={(e) => setForm({ ...form, dose_unit: e.target.value })} /></label>
                <label style={fieldStyle}><span style={labelStyle}>Концентрация</span><input style={input} value={form.strength || ""} onChange={(e) => setForm({ ...form, strength: e.target.value })} /></label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 9 }}>
                <label style={fieldStyle}><span style={labelStyle}>Схема *</span><select style={input} value={form.frequency_type} onChange={(e) => setForm({ ...form, frequency_type: e.target.value })}><option value="times_per_day">Несколько раз в день</option><option value="scheduled_times">Конкретное время</option><option value="as_needed">По необходимости</option><option value="text">Своими словами</option></select></label>
                {form.frequency_type === "times_per_day" && <label style={fieldStyle}><span style={labelStyle}>Сколько раз в день</span><input type="number" min="1" max="24" style={input} value={form.times_per_day} onChange={(e) => setForm({ ...form, times_per_day: e.target.value })} /></label>}
                {form.frequency_type === "scheduled_times" && <label style={fieldStyle}><span style={labelStyle}>Время, через запятую</span><input style={input} placeholder="08:00, 20:00" value={(form.scheduled_times || []).join(", ")} onChange={(e) => setForm({ ...form, scheduled_times: e.target.value.split(",").map((time) => time.trim()).filter(Boolean) })} /></label>}
              </div>
              {(form.frequency_type === "text" || form.frequency_type === "as_needed") && <label style={fieldStyle}><span style={labelStyle}>{form.frequency_type === "text" ? "Как вам назначено принимать?" : "Указание врача (необязательно)"}</span><textarea style={{ ...input, minHeight: 68 }} value={form.instructions || ""} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></label>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 9 }}>
                <label style={fieldStyle}><span style={labelStyle}>Дата начала *</span><input required type="date" style={input} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
                <label style={fieldStyle}><span style={labelStyle}>Дата окончания</span><input type="date" style={input} disabled={form.ongoing} value={form.end_date || ""} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 11, color: "#5f574f", fontSize: 13 }}><input type="checkbox" checked={!!form.ongoing} onChange={(e) => setForm({ ...form, ongoing: e.target.checked, end_date: "" })} />Принимать постоянно</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 9 }}>
                <label style={fieldStyle}><span style={labelStyle}>Действующее вещество</span><input style={input} value={form.active_ingredient || ""} onChange={(e) => setForm({ ...form, active_ingredient: e.target.value })} /></label>
                <label style={fieldStyle}><span style={labelStyle}>Форма</span><input style={input} value={form.dosage_form || ""} onChange={(e) => setForm({ ...form, dosage_form: e.target.value })} /></label>
                <label style={fieldStyle}><span style={labelStyle}>Способ применения</span><input style={input} value={form.route || ""} onChange={(e) => setForm({ ...form, route: e.target.value })} /></label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 9 }}>
                <label style={fieldStyle}><span style={labelStyle}>Комментарий врача</span><textarea style={{ ...input, minHeight: 60 }} value={form.doctor_comment || ""} onChange={(e) => setForm({ ...form, doctor_comment: e.target.value })} /></label>
                <label style={fieldStyle}><span style={labelStyle}>Комментарий пациента</span><textarea style={{ ...input, minHeight: 60 }} value={form.patient_comment || ""} onChange={(e) => setForm({ ...form, patient_comment: e.target.value })} /></label>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="submit" disabled={saving} style={{ ...primaryButton, opacity: saving ? 0.6 : 1 }}>{saving ? "Сохраняем…" : "Сохранить назначение"}</button>
                <button type="button" onClick={closeForm} style={{ padding: "9px 14px", borderRadius: 9, border: "1px solid #d8cec1", background: "white", color: "#5f574f", cursor: "pointer" }}>Отмена</button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
