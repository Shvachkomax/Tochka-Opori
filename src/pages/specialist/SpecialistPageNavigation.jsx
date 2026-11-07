import React from "react";

/**
 * Возврат из автономных разделов кабинета врача.
 * Кнопка «В кабинет» всегда ведёт на известный маршрут /specialist.
 * «Назад» не отправляет пользователя случайно на внешний сайт:
 * при отсутствии внутреннего referrer тоже ведёт в кабинет.
 */
export function returnToPreviousSpecialistPage() {
  if (typeof window === "undefined") return;
  const target = "/specialist";
  const referrer = document.referrer;
  if (referrer && window.history.length > 1) {
    try {
      const previous = new URL(referrer, window.location.href);
      const current = new URL(window.location.href);
      if (previous.origin === current.origin &&
          previous.pathname !== current.pathname &&
          /^\/specialist(?:\/|$)/.test(previous.pathname)) {
        window.history.back();
        return;
      }
    } catch {
      // Invalid referrer: use the fixed specialist route.
    }
  }
  window.location.assign(target);
}

export default function SpecialistPageNavigation({ className = "" }) {
  return (
    <nav aria-label="Навигация кабинета специалиста"
      className={["specialist-page-navigation", className].filter(Boolean).join(" ")}
      style={{
        display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
        margin: "0 0 22px",
      }}>
      <button type="button" onClick={returnToPreviousSpecialistPage}
        aria-label="Назад к предыдущему разделу"
        style={{
          font: "600 13px Inter, system-ui, sans-serif", color: "#496357",
          background: "transparent", border: "1px solid #dce3dc",
          borderRadius: 10, padding: "10px 14px", cursor: "pointer",
        }}>← Назад</button>
      <a href="/specialist"
        style={{
          display: "inline-flex", alignItems: "center", textDecoration: "none",
          background: "#486a59", color: "#fff", borderRadius: 10, padding: "11px 15px",
          font: "650 13px Inter, system-ui, sans-serif",
        }}>В кабинет специалиста</a>
    </nav>
  );
}
