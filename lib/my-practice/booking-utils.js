// A2 booking helpers (no side effects, pure).
// Extraction to avoid a heavy import of api/session.js from the handler chain
// (booking-handler used to import api/session.js which also imports live relay maps).

import { timeInMinutes } from "./schedule-draft.js";
import { addDaysUTC } from "./pilot-data.js";
export function isMyPracticeServerEnabled(env = process.env) {
  if (env.MY_PRACTICE_SERVER_ENABLED !== "true") return false;
  if (env.VERCEL_ENV !== "preview") return false;
  const expected = env.MY_PRACTICE_ALLOWED_SUPABASE_REF;
  if (expected !== "eehyehlhiyztciaezaus") return false;
  try {
    const parsed = new URL(env.SUPABASE_URL || "");
    return parsed.protocol === "https:" && parsed.hostname === expected + ".supabase.co";
  } catch { return false; }
}

export function slotsForServiceDay({ service, availabilityRows, bookingsRows, day }) {
  const isoWeekday = ((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
  const isException = (availabilityRows || []).some((r) => r.exception_date === day && r.is_active !== false);
  if (isException) return [];
  const windows = (availabilityRows || []).filter((r) => r.weekday === isoWeekday && r.is_active !== false);
  if (!windows.length) return [];
  const dur = service.duration_min;
  const slots = new Set();
  for (const w of windows) {
    for (let t = timeInMinutes(w.start_time); t + dur <= timeInMinutes(w.end_time); t += dur) {
      slots.add(
        String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"),
      );
    }
  }
  const busy = (bookingsRows || [])
    .filter((b) => ["held", "confirmed"].includes(b.status) && b.starts_at.startsWith(day))
    .map((b) => [new Date(b.starts_at), new Date(b.ends_at)]);
  return [...slots]
    .map((s) => {
      const start = new Date(`${day}T${s}:00Z`);
      const end = new Date(start.getTime() + dur * 60000);
      return { start, end };
    })
    .filter(({ start, end }) => !busy.some(([bs, be]) => start < be && bs < end))
    .map(({ start, end }) => ({
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      start_time: String(start.getUTCHours()).padStart(2, "0") + ":" + String(start.getUTCMinutes()).padStart(2, "0"),
    }));
}

export function publicServiceView(serviceRow) {
  return {
    service_id: serviceRow.id,
    name: serviceRow.name,
    format: serviceRow.format,
    price_kop: serviceRow.price_kop,
    duration_min: serviceRow.duration_min,
    doctor_id: String(serviceRow.expert_id).slice(0, 8),
  };
}
