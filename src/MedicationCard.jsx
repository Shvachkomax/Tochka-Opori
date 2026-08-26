const STATE_LABELS = {
  active: "Действует",
  scheduled: "Начнёт действовать позже",
  revoked: "Отозвано",
  superseded: "Заменено новой версией",
  completed: "Завершено",
  expired: "Срок действия закончился",
};

function formatDate(value) {
  if (!value) return "не указано";
  return new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function formatFrequency(value) {
  return {
    once_daily: "1 раз в день",
    twice_daily: "2 раза в день",
    three_times_daily: "3 раза в день",
    every_other_day: "через день",
    weekly: "1 раз в неделю",
  }[value] || value;
}

export default function MedicationCard({ cards = [] }) {
  if (!cards.length) return null;

  return (
    <section style={{ marginBottom: 24 }} data-testid="patient-medication-cards">
      <div style={{ fontSize: 16, fontWeight: 700, color: "#2E2A25", marginBottom: 12 }}>Назначено специалистом</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {cards.map((card) => (
          <article key={card.order_ref} style={{ padding: 16, borderRadius: 14, background: "#F2F6F2", border: "1px solid rgba(125,154,137,.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#2E2A25" }}>{card.medication_name}</div>
                <div style={{ fontSize: 13, color: "#5F7D6C", marginTop: 3 }}>
                  {card.strength_value} {card.strength_unit}{card.formulation ? ` · ${card.formulation}` : ""} · {card.route_code}
                </div>
              </div>
              <span style={{ alignSelf: "flex-start", padding: "3px 9px", borderRadius: 10, background: "#E2EBE4", color: "#5F7D6C", fontSize: 11, fontWeight: 700 }}>
                {STATE_LABELS[card.effective_state] || card.effective_state}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 8 }}>
              Срок: {formatDate(card.valid_from)} — {card.valid_until ? formatDate(card.valid_until) : "без конечной даты"}
            </div>
            {card.prescriber?.name && (
              <div style={{ fontSize: 12, color: "#7A7268", marginBottom: 8 }}>
                Специалист: {card.prescriber.name}{card.prescriber.specialty ? ` · ${card.prescriber.specialty}` : ""}
              </div>
            )}
            {card.schedules?.map((phase) => (
              <div key={phase.phase_number} style={{ padding: "8px 10px", borderRadius: 9, background: "#fff", marginTop: 6, fontSize: 13, color: "#5F574F" }}>
                {card.schedules.length > 1 && <strong>Фаза {phase.phase_number}: </strong>}
                {phase.dose_amount} {phase.dose_unit}, {formatFrequency(phase.frequency_code)}
                {phase.phase_end_at ? ` · до ${formatDate(phase.phase_end_at)}` : " · далее"}
              </div>
            ))}
            {card.clinician_instruction && (
              <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5, color: "#5F574F" }}>
                {card.clinician_instruction}
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: 11, color: "#8A7E72" }}>
              Карточка только для просмотра. Изменение лечения обсуждается со специалистом.
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
