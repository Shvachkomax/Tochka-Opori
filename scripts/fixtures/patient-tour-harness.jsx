import React from "react";
import { createRoot } from "react-dom/client";
import PatientCabinetTour from "../../src/components/PatientCabinetTour.jsx";

const params = new URLSearchParams(window.location.search);
const profile = params.get("profile") === "health" ? "health" : "support";
const scope = params.get("scope") || "fixture-patient";
const specialists = Math.max(0, Number(params.get("specialists") ?? 1) || 0);
const services = Math.max(0, Number(params.get("services") ?? 1) || 0);
const unavailable = params.get("unavailable") === "true";
window.__patientTourEffects = { medical: 0, payment: 0, voice: 0, api: 0 };

const panelStyle = {
  minHeight: 150,
  padding: 18,
  marginBottom: 32,
  border: "1px solid #d9dfd9",
  borderRadius: 14,
  background: "#fff",
  boxSizing: "border-box",
};
const fieldStyle = { display: "block", width: "100%", boxSizing: "border-box", margin: "10px 0", minHeight: 42 };

function DemoCabinet() {
  return (
    <main data-tour-container style={{ width: "min(680px, calc(100vw - 32px))", margin: "24px 0 80px 32px", fontFamily: "Arial, sans-serif" }}>
      <PatientCabinetTour profile={profile} scope={scope} />
      <header data-tour-target="patient-overview" style={panelStyle}>
        <h1>Кабинет пациента {profile === "health" ? "Health" : "Support"}</h1>
        <p>Настоящие разделы тестового кабинета.</p>
      </header>
      <section data-tour-target="patient-diary" style={panelStyle}>
        <h2>Дневник</h2>
        <label>Запись дня<input style={fieldStyle} defaultValue="Без изменений" /></label>
        <button type="button">Открыть дневник</button>
      </section>
      <section data-tour-target="patient-ai" style={panelStyle}>
        <h2>Общение</h2>
        <textarea style={fieldStyle} defaultValue="Черновик остаётся на месте" />
        <button type="button">Начать текстовый разговор</button>{" "}
        <button type="button" onClick={() => { window.__patientTourEffects.voice += 1; }}>Начать голосовой разговор</button>
      </section>
      <section
        data-tour-target="patient-specialist"
        data-tour-specialist-count={specialists}
        data-tour-service-count={services}
        data-tour-unavailable={unavailable ? "true" : "false"}
        style={panelStyle}
      >
        <h2>Мои специалисты</h2>
        {unavailable ? <p>Серверный раздел временно недоступен.</p>
          : specialists ? <button type="button">Услуги и запись</button>
            : <p>Прикреплённых специалистов пока нет.</p>}
      </section>
      <section
        data-tour-target="patient-booking"
        data-tour-specialist-count={specialists}
        data-tour-service-count={services}
        data-tour-unavailable={unavailable ? "true" : "false"}
        style={panelStyle}
      >
        <h2>Запись на приём</h2>
        {specialists > 0 && services > 0 ? (
          <form onSubmit={(event) => event.preventDefault()}>
            <label>Услуга<select style={fieldStyle} defaultValue="consultation"><option value="consultation">Консультация</option></select></label>
            <label>Дата<input style={fieldStyle} type="date" defaultValue="2030-01-15" /></label>
            <button type="button" onClick={() => { window.__patientTourEffects.payment += 1; }}>Оплатить и записаться</button>
          </form>
        ) : specialists > 0 ? <p>Нет опубликованных серверных услуг.</p> : <p>Сначала прикрепите специалиста.</p>}
      </section>
      <section data-tour-target="patient-health" style={panelStyle}>
        <h2>Сведения о здоровье</h2>
        <label>Препарат<input data-testid="fixture-medication" style={fieldStyle} defaultValue="Назначение не меняется" /></label>
        <button type="button" onClick={() => { window.__patientTourEffects.medical += 1; }}>Сохранить сведения</button>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<DemoCabinet />);
