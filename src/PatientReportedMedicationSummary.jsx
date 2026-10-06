import React from "react";

function scheduleText(order) {
  if (order.frequency_type === "scheduled_times") return (order.scheduled_times || []).join(" / ");
  if (order.frequency_type === "times_per_day") return `${order.times_per_day} раз${order.times_per_day === 1 ? "" : "а"} в день`;
  if (order.frequency_type === "as_needed") return "По необходимости";
  return order.instructions || "Схема указана пациентом";
}

export default function PatientReportedMedicationSummary({ data, loading }) {
  if (loading) return <p style={{ fontSize: 13, color: "#7A7268" }}>Загрузка сведений пациента о лекарствах…</p>;
  if (data?.error) return <p style={{ fontSize: 13, color: "#991B1B" }}>{data.error}</p>;
  const orders = data?.orders || [];
  const logs = data?.intake_logs || [];
  if (!orders.length) return <p style={{ fontSize: 13, color: "#7A7268" }}>Пациент пока не добавил сведения о лекарствах и БАДах.</p>;

  return (
    <div data-testid="patient-reported-medication-summary">
      <div style={{ padding: "9px 12px", marginBottom: 10, borderRadius: 9, background: "#F4F1EB", color: "#665C52", fontSize: 12 }}>
        Это сведения пациента, приведённые как описание назначения или рекомендации врача. Сервис не проверял их.
      </div>
      {orders.map((order) => (
        <article key={order.id} style={{ padding: "11px 0", borderBottom: "1px solid rgba(46,42,37,.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <strong style={{ fontSize: 14 }}>{order.name}{order.strength ? ` · ${order.strength}` : ""}</strong>
            <span style={{ color: "#7A7268", fontSize: 11 }}>{order.status === "active" ? "Активно" : order.status === "completed" ? "Завершено" : order.status === "paused" ? "Приостановлено" : "Архив"}</span>
          </div>
          <div style={{ marginTop: 3, color: "#665C52", fontSize: 12 }}>{order.single_dose} {order.dose_unit} · {scheduleText(order)}</div>
          <div style={{ marginTop: 3, color: "#7A7268", fontSize: 11 }}>
            {order.item_type === "supplement" ? "Рекомендовано врачом" : "Назначено врачом"} — со слов пациента · с {new Date(`${order.start_date}T00:00:00`).toLocaleDateString("ru-RU")}
          </div>
          <div style={{ marginTop: 4, color: "#7A7268", fontSize: 11 }}>
            <strong>Справка: </strong>
            {order.medication_reference?.verified_reference?.verified
              ? `${order.medication_reference.verified_reference.source.source_title} · ${order.medication_reference.verified_reference.source.source_version} · ${new Date(order.medication_reference.verified_reference.source.retrieved_at).toLocaleDateString("ru-RU")}`
              : order.reference_status === "matched"
                ? `сопоставлено со слов пациента${order.medication_reference?.concept?.display_name ? `: ${order.medication_reference.concept.display_name}` : ""}; источник не подтверждён`
                : order.reference_status === "candidate"
                  ? "найден кандидат по точному названию; совпадение не подтверждено"
                  : order.reference_status === "ambiguous"
                    ? "несколько точных вариантов, требуется выбор пациента"
                    : "справочная информация не подтверждена"}
          </div>
          {order.patient_comment && <div style={{ marginTop: 5, color: "#665C52", fontSize: 12 }}>Комментарий пациента: {order.patient_comment}</div>}
          {order.doctor_comment && <div style={{ marginTop: 5, color: "#665C52", fontSize: 12 }}>Комментарий врача (со слов пациента): {order.doctor_comment}</div>}
          {logs.filter((log) => log.medication_order_id === order.id).slice(0, 5).map((log) => (
            <div key={log.id} style={{ marginTop: 4, color: "#7A7268", fontSize: 11 }}>
              {log.scheduled_date}: {({ taken: "принято", missed: "пропущено", taken_late: "принято позже", different_dose: "другая доза" })[log.status]}
              {log.actual_time ? `, ${String(log.actual_time).slice(0, 5)}` : ""}
              {log.actual_dose != null ? `, ${log.actual_dose} ${log.actual_dose_unit}` : ""}
              {log.patient_note ? ` · ${log.patient_note}` : ""}
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}
