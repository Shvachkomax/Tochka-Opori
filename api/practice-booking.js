// A2 practice booking API — test contour only. Production-safe:
// blocked unless MY_PRACTICE_SERVER_ENABLED=true (exact-test-ref guarded).
import { getSupabase } from "../lib/supabase.js";
import { applyCors, handleOptions } from "../lib/security/cors.js";
import { authorizeSpecialist } from "./specialist.js";
import { resolveSupportOwner } from "./session.js";
import { isMyPracticeServerEnabled } from "../lib/my-practice/workspace-handler.js";
import {
  handlePracticePlaces,
  handlePracticeServices,
  handlePracticeAvailability,
  handlePracticeBooking,
} from "../lib/my-practice/booking-handler.js";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);

  if (!isMyPracticeServerEnabled(process.env)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ ok: false, error: "Бронирование недоступно в этом окружении." });
  }
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { action } = req.body || {};
  // Patient identity: resolve via verified session (function injected to keep handler light).
  const resolvePatient = async (session_id, access_token) => {
    const r = await resolveSupportOwner(session_id, access_token);
    if (!r) return null;
    return { ownerId: r.ownerId, sessionId: r.sessionId, publicCode: r.publicCode };
  };
  const deps = { authorizeSpecialist, getSupabase, resolvePatient };

  switch (action) {
    case "listPracticePlaces":
    case "savePracticePlace":
    case "deletePracticePlace":
      return handlePracticePlaces(req, res, deps);
    case "listPracticeServices":
    case "savePracticeService":
    case "deactivatePracticeService":
      return handlePracticeServices(req, res, deps);
    case "listPracticeAvailability":
    case "savePracticeAvailability":
    case "deletePracticeAvailability":
      return handlePracticeAvailability(req, res, deps);
    case "getPracticeSlots":
    case "listPracticeDoctorServices":
    case "reservePracticeBooking":
    case "confirmPracticeTestPayment":
    case "cancelPracticeBookingPublic":
    case "listPracticeBookings":
    case "completePracticeBooking":
    case "getPracticeFinance":
      return handlePracticeBooking(req, res, deps);
    default:
      return res.status(400).json({ ok: false, error: "Unknown action" });
  }
}
