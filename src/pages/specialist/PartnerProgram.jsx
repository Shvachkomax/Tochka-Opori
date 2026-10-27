import React, { useEffect, useState } from "react";

const format = value => Number(value).toLocaleString("ru-RU");

export default function PartnerProgram({ module, organizationId, styles }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError("");
    setResult(null);
    (async () => {
      try {
        const response = await fetch("/api/specialist", {
          method: "POST", credentials: "same-origin", signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getPartnerProgram", module, organization_id: organizationId }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Не удалось загрузить начисления.");
        if (current) setResult(data);
      } catch (err) {
        if (current) setError(err.message || "Не удалось подключиться к сервису.");
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; controller.abort(); };
  }, [open, attempt, module, organizationId]);

  return <section style={styles.card} data-testid="partner-program">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}
      aria-controls="partner-program-content"
      style={{ background: "none", border: 0, padding: 0, color: "#2E2A25", fontSize: 16, fontWeight: 700, cursor: "pointer", width: "100%", textAlign: "left" }}>
      Партнёрская программа <span aria-hidden="true">{open ? "▴" : "▾"}</span>
    </button>
    <p style={{ fontSize: 14, color: "#625A50", lineHeight: 1.5, marginBottom: 0 }}>
      Ваша доля — 25% от использования сервиса прикреплёнными пациентами.
    </p>
    {open && <div id="partner-program-content" style={{ marginTop: 16 }}>
      <p style={{ fontSize: 13, lineHeight: 1.5, color: "#625A50" }}>
        Сейчас действует тестовый учёт. Начисления в единицах не являются деньгами и не подлежат выплате.
        Оплата личных консультаций учитывается отдельно.
      </p>
      {loading && <p role="status">Загружаем начисления…</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" style={styles.btnSecondary} onClick={() => setAttempt(value => value + 1)}>Повторить</button></div>}
      {!loading && result && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          {[
            ["Расход пациентов", `${format(result.summary.base_credits)} ед.`],
            ["Тестовые начисления", `${format(result.summary.earned_credits)} ед.`],
            ["Пациенты с начислениями", format(result.summary.contributing_patients)],
          ].map(([label, value]) => <div key={label} style={{ background: "#F6F0E7", borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, color: "#625A50" }}>{label}</div>
            <div style={{ fontSize: 21, fontWeight: 700, marginTop: 6 }}>{value}</div>
          </div>)}
        </div>
        <p style={{ fontSize: 12, color: "#625A50", lineHeight: 1.5 }}>Итоги за всё время с момента включения программы, с учётом возвратов. Дробные доли накапливаются до целой единицы. Выплаты в рублях пока недоступны.</p>
        <h4 style={{ marginBottom: 12 }}>Последние начисления и возвраты</h4>
        {result.history.length === 0 ? <p>Начислений пока нет. Они появятся после использования сервиса прикреплёнными пациентами.</p> :
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <caption style={{ textAlign: "left", color: "#625A50", paddingBottom: 8 }}>Последние 50 операций · время московское</caption>
              <thead><tr>{["Дата", "Операция", "Расход, ед.", "Ваша доля, ед."].map(label => <th key={label} scope="col" style={{ textAlign: "left", padding: 8 }}>{label}</th>)}</tr></thead>
              <tbody>{result.history.map(row => <tr key={row.id}>
                <td style={{ padding: 8 }}>{new Date(row.created_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" })}</td>
                <td style={{ padding: 8 }}>{Number(row.base_delta) < 0 ? "Возврат" : "Использование сервиса"}</td>
                <td style={{ padding: 8 }}>{format(row.base_delta)}</td>
                <td style={{ padding: 8 }}>{format(row.credit_delta)}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        <button type="button" style={{ ...styles.btnSecondary, marginTop: 12 }} onClick={() => setAttempt(value => value + 1)}>Обновить начисления</button>
      </>}
    </div>}
  </section>;
}
