// Availability helpers for the My Practice calendar (A1).
// Synthetic demo only: no patients, no real availability claims.
// The server-side availability truth is part of the A2 booking spec and is
// NOT implemented here. `DEMO_WORKING_HOURS` is an explicit demo placeholder
// (Mon–Fri 09:00–18:00) used to derive *reference* free intervals in UI.

import { timeInMinutes } from "./schedule-draft.js";
import { addDaysUTC } from "./pilot-data.js";

export const DEMO_WORKING_HOURS = Object.freeze({
  // Mon=1 .. Sun=7 (ISO weekday)
  days: Object.freeze([1, 2, 3, 4, 5]),
  start: "09:00",
  end: "18:00",
  label: "справочное рабочее время (демонстрация)",
});

export function weekdayOf(day) {
  // day: YYYY-MM-DD; returns ISO weekday 1 (Mon) .. 7 (Sun)
  const d = new Date(day + "T12:00:00Z");
  return ((d.getUTCDay() + 6) % 7) + 1;
}

export function isWorkingDay(day, hours = DEMO_WORKING_HOURS) {
  return hours.days.includes(weekdayOf(day));
}

export function isActiveEntry(entry) {
  // Mirrors schedule-draft isActiveScheduleEvent: busy always blocks,
  // cancelled bookings do not.
  return entry.kind === "busy" || entry.status !== "cancelled";
}

/**
 * Free reference intervals for a single day: working window minus active
 * entries. Returns [{ start, end }] in HH:MM, sorted ascending.
 * Used only to render background "free" intervals in the calendar.
 */
export function freeIntervalsForDay(day, entries, hours = DEMO_WORKING_HOURS) {
  if (!isWorkingDay(day, hours)) return [];
  const winStart = timeInMinutes(hours.start);
  const winEnd = timeInMinutes(hours.end);
  const occupied = (entries || [])
    .filter((e) => e.day === day && isActiveEntry(e))
    .map((e) => [timeInMinutes(e.start), timeInMinutes(e.end)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const gaps = [];
  let cursor = winStart;
  const toHHMM = (mins) =>
    String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
  for (const [s, e] of occupied) {
    const cs = Math.max(s, winStart);
    const ce = Math.min(e, winEnd);
    if (ce <= winStart || cs >= winEnd) continue;
    if (cs > cursor) gaps.push({ start: toHHMM(cursor), end: toHHMM(cs) });
    cursor = Math.max(cursor, ce);
    if (cursor >= winEnd) break;
  }
  if (cursor < winEnd) gaps.push({ start: toHHMM(cursor), end: toHHMM(winEnd) });
  return gaps;
}

/**
 * NOTE: FullCalendar resource views (resource timelines, per-resource
 * columns) are Premium features and are NOT used here. Multi-clinic support
 * in the free MIT build = clinic filter + clinic name in every event title
 * (see toCalendarEvents). No resourceId/resources — single calendar.
 */

/**
 * FullCalendar events for busy blocks and bookings (free tier, no resources).
 * Each event carries extendedProps.entryId so eventClick can open the
 * existing ScheduleForm. Clinic name is always shown in the title.
 */
export function toCalendarEvents(entries, catalog, { includeFree = false, monday = null, days = 7 } = {}) {
  const catalogById = new Map((catalog || []).map((c) => [c.id, c]));
  const events = (entries || []).map((e) => {
    const clinic = catalogById.get(e.clinicId);
    const offer = clinic?.offers?.find((o) => o.id === e.serviceId);
    const title = e.title ||
      (e.kind === "busy"
        ? e.reason === "clinic"
          ? "Занято — приём в клинике"
          : e.reason === "personal"
            ? "Личное время"
            : e.reason === "vacation"
              ? "Отпуск"
              : "Недоступен"
        : offer?.name || "Запись");
    const status = e.kind === "busy" ? "busy" : e.status;
    const colors = {
      busy: { bg: "#e8e9e8", border: "#858e88", text: "#59645d" },
      confirmed: { bg: "#e3f2e8", border: "#62a87b", text: "#386e50" },
      pending: { bg: "#fff2cd", border: "#d5ae56", text: "#846426" },
      cancelled: { bg: "#fae5e2", border: "#c47b77", text: "#994f47" },
      completed: { bg: "#e4ecf7", border: "#739ac4", text: "#47678a" },
    }[status] || { bg: "#f1f3f1", border: "#858e88", text: "#59645d" };
    return {
      id: e.id,
      // No resourceId: resource views are Premium. Clinic is in the title.
      title: e.title || `${title} · ${clinic?.name || ""}`.trim(),
      start: `${e.day}T${e.start}`,
      end: `${e.day}T${e.end}`,
      backgroundColor: colors.bg,
      borderColor: colors.border,
      textColor: colors.text,
      extendedProps: { entryId: e.id, kind: e.kind, status },
    };
  });

  if (!includeFree || !monday) return events;

  const freeEvents = [];
  for (let i = 0; i < days; i++) {
    const day = addDaysUTC(monday, i);
    for (const gap of freeIntervalsForDay(day, entries)) {
      // One background event per free gap per clinic column handled at render
      // level: emit per-resource so each clinic column shows its free window.
      freeEvents.push({
        id: `free-${day}-${gap.start}`,
        title: "Свободно (справочно)",
        start: `${day}T${gap.start}`,
        end: `${day}T${gap.end}`,
        rendering: "background",
        backgroundColor: "rgba(98,168,123,0.10)",
        extendedProps: { kind: "free" },
      });
    }
  }
  return [...events, ...freeEvents];
}

/**
 * Candidate slot start times for one day given a service duration.
 * Pure helper for the future server spec; the UI in A1 derives free
 * intervals from the same function so behaviour stays consistent.
 */
export function freeSlotsForDay(day, entries, { durationMin, hours = DEMO_WORKING_HOURS } = {}) {
  if (!Number.isInteger(durationMin) || durationMin < 15 || durationMin > 120) {
    throw new Error("Некорректная длительность услуги.");
  }
  return freeIntervalsForDay(day, entries, hours)
    .filter((g) => timeInMinutes(g.end) - timeInMinutes(g.start) >= durationMin)
    .flatMap((g) => {
      const out = [];
      for (let t = timeInMinutes(g.start); t + durationMin <= timeInMinutes(g.end); t += durationMin) {
        out.push(
          String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"),
        );
      }
      return out;
    });
}
