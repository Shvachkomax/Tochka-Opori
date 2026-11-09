// A2 server-side booking for «Моя практика» (test contour only).
// Own tables (practice_places/services/availability/bookings/payments/commissions/events).
// Never touches usage_wallets/usage_ledger (AI credits) or partner accruals.
// Authorization: doctor actions require specialist session + membership in the context.
// Patient public path exposes free slots only — no clinical data, no PII of others.
import { isMyPracticeServerEnabled, isSameOriginPracticeRequest } from "./workspace-handler.js";
import { freeSlotsForDay } from "./availability.js";
import { timeInMinutes } from "./schedule-draft.js";
import { addDaysUTC } from "./pilot-data.js";

function requireServerContext(res) {
  if (!isMyPracticeServerEnabled(process.env)) {
    res.status(503).json({ ok: false, error: "Бронирование недоступно в этом окружении." });
    return false;
  }
  return true;
}

async function assertDoctorContext({ authorizeSpecialist, getSupabase, req }) {
  const auth = await authorizeSpecialist(req);
  if (auth.error) return { error: { status: auth.status || 401, message: auth.error } };
  const body = req.body || {};
  const orgId = body.organization_id ?? null;
  const memberships = auth.memberships || [];
  if (orgId !== null) {
    // doctor must have active membership in the context organization
    const ok = memberships.some((m) => m.organization_id === orgId && m.status === "active");
    if (!ok) return { error: { status: 403, message: "Нет доступа к организации." } };
  }
  return { auth, supabase: getSupabase(), orgId };
}

// ── Doctor: places / services / availability CRUD (server truth) ──
export async function handlePracticePlaces(req, res, deps) {
  res.setHeader("Cache-Control", "no-store");
  if (!requireServerContext(res)) return;
  const ctx = await assertDoctorContext({ ...deps, req });
  if (ctx.error) return res.status(ctx.error.status).json({ ok: false, error: ctx.error.message });
  const { supabase, auth } = ctx;
  const body = req.body || {};
  const action = body.action;
  if (action === "listPracticePlaces") {
    const { data, error } = await supabase.from("practice_places").select("*").eq("expert_id", auth.expert.id).order("created_at");
    if (error) return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    return res.status(200).json({ ok: true, places: data || [] });
  }
  if (action === "savePracticePlace") {
    const { id, name, address, note } = body;
    if (!name || !String(name).trim()) return res.status(400).json({ ok: false, error: "Укажите название места." });
    const payload = { expert_id: auth.expert.id, name: String(name).trim().slice(0, 120), address: address ? String(address).slice(0, 300) : null, note: note ? String(note).slice(0, 500) : null };
    let result;
    if (id) {
      result = await supabase.from("practice_places").update(payload).eq("id", id).eq("expert_id", auth.expert.id).select().maybeSingle();
    } else {
      result = await supabase.from("practice_places").insert(payload).select().maybeSingle();
    }
    if (result.error) return res.status(503).json({ ok: false, error: "Не удалось сохранить." });
    return res.status(200).json({ ok: true, place: result.data });
  }
  if (action === "deletePracticePlace") {
    const { data: services } = await supabase.from("practice_services").select("id").eq("place_id", body.id);
    if (services?.length) return res.status(400).json({ ok: false, error: "Сначала удалите или перепривяжите услуги этого места." });
    const { error } = await supabase.from("practice_places").delete().eq("id", body.id).eq("expert_id", auth.expert.id);
    if (error) return res.status(503).json({ ok: false, error: "Не удалось удалить." });
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ ok: false, error: "Некорректная операция." });
}

export async function handlePracticeServices(req, res, deps) {
  res.setHeader("Cache-Control", "no-store");
  if (!requireServerContext(res)) return;
  const ctx = await assertDoctorContext({ ...deps, req });
  if (ctx.error) return res.status(ctx.error.status).json({ ok: false, error: ctx.error.message });
  const { supabase, auth } = ctx;
  const body = req.body || {};
  const action = body.action;
  if (action === "listPracticeServices") {
    const { data, error } = await supabase.from("practice_services").select("*").eq("expert_id", auth.expert.id).eq("is_active", true).order("created_at");
    if (error) return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    return res.status(200).json({ ok: true, services: data || [] });
  }
  if (action === "savePracticeService") {
    const { id, organization_id, place_id, name, format, price_kop, duration_min } = body;
    if (!name || !String(name).trim()) return res.status(400).json({ ok: false, error: "Название обязательно." });
    if (!Number.isInteger(price_kop) || price_kop < 0) return res.status(400).json({ ok: false, error: "Некорректная цена." });
    if (!Number.isInteger(duration_min) || duration_min < 15 || duration_min > 240) return res.status(400).json({ ok: false, error: "Длительность 15–240 минут." });
    const payload = {
      expert_id: auth.expert.id,
      organization_id: organization_id ?? null,
      place_id: place_id ?? null,
      name: String(name).trim().slice(0, 160),
      format: ["offline", "online", "phone", "video"].includes(format) ? format : "offline",
      price_kop, duration_min, is_active: true,
    };
    let result;
    if (id) result = await supabase.from("practice_services").update(payload).eq("id", id).eq("expert_id", auth.expert.id).select().maybeSingle();
    else result = await supabase.from("practice_services").insert(payload).select().maybeSingle();
    if (result.error) return res.status(503).json({ ok: false, error: "Не удалось сохранить." });
    return res.status(200).json({ ok: true, service: result.data });
  }
  if (action === "deactivatePracticeService") {
    const { error } = await supabase.from("practice_services").update({ is_active: false }).eq("id", body.id).eq("expert_id", auth.expert.id);
    if (error) return res.status(503).json({ ok: false, error: "Ошибка." });
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ ok: false, error: "Некорректная операция." });
}

export async function handlePracticeAvailability(req, res, deps) {
  res.setHeader("Cache-Control", "no-store");
  if (!requireServerContext(res)) return;
  const ctx = await assertDoctorContext({ ...deps, req });
  if (ctx.error) return res.status(ctx.error.status).json({ ok: false, error: ctx.error.message });
  const { supabase, auth } = ctx;
  const body = req.body || {};
  const action = body.action;
  if (action === "listPracticeAvailability") {
    const { data, error } = await supabase.from("practice_availability").select("*").eq("expert_id", auth.expert.id).eq("is_active", true).order("weekday");
    if (error) return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    return res.status(200).json({ ok: true, availability: data || [] });
  }
  if (action === "savePracticeAvailability") {
    const { id, organization_id, weekday, exception_date, start_time, end_time, note } = body;
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 7) return res.status(400).json({ ok: false, error: "weekday 0..7." });
    if (start_time >= end_time) return res.status(400).json({ ok: false, error: "Конец должен быть позже начала." });
    const payload = {
      expert_id: auth.expert.id, organization_id: organization_id ?? null,
      weekday, exception_date: exception_date ?? null,
      start_time, end_time, note: note ? String(note).slice(0, 300) : null, is_active: true,
    };
    let result;
    if (id) result = await supabase.from("practice_availability").update(payload).eq("id", id).eq("expert_id", auth.expert.id).select().maybeSingle();
    else result = await supabase.from("practice_availability").insert(payload).select().maybeSingle();
    if (result.error) return res.status(503).json({ ok: false, error: "Не удалось сохранить." });
    return res.status(200).json({ ok: true, entry: result.data });
  }
  if (action === "deletePracticeAvailability") {
    const { error } = await supabase.from("practice_availability").update({ is_active: false }).eq("id", body.id).eq("expert_id", auth.expert.id);
    if (error) return res.status(503).json({ ok: false, error: "Ошибка." });
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ ok: false, error: "Некорректная операция." });
}

// ── Public slot computation (server truth, per service) ──
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

// ── Booking actions ──
async function loadAvailabilityAndBookings(supabase, expertId, organizationId, day) {
  const isoWeekday = ((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
  const { data: av } = await supabase
    .from("practice_availability")
    .select("*")
    .eq("expert_id", expertId)
    .eq("is_active", true);
  const windows = (av || []).filter((r) => r.weekday === isoWeekday || r.exception_date === day);
  const dayStart = `${day}T00:00:00Z`, dayEnd = `${addDaysUTC(day, 1)}T00:00:00Z`;
  let bookingsQuery = supabase
    .from("practice_bookings")
    .select("id, status, starts_at, ends_at, service_id, place_id, owner_type, owner_id")
    .eq("expert_id", expertId)
    .in("status", ["held", "confirmed"])
    .gte("starts_at", dayStart)
    .lt("starts_at", dayEnd);
  if (organizationId === null) bookingsQuery = bookingsQuery.is("organization_id", null);
  else bookingsQuery = bookingsQuery.eq("organization_id", organizationId);
  const { data: bk } = await bookingsQuery;
  return { windows, bookings: bk || [] };
}

export async function handlePracticeBooking(req, res, deps) {
  res.setHeader("Cache-Control", "no-store");
  if (!requireServerContext(res)) return;
  const { getSupabase } = deps;
  const body = req.body || {};
  const action = body.action;
  const supabase = getSupabase();

  // ── Public: free slots for a service ──
  if (action === "getPracticeSlots") {
    const { service_id, day } = body;
    if (!service_id || !day) return res.status(400).json({ ok: false, error: "Нужны service_id и day." });
    const { data: service } = await supabase.from("practice_services").select("*").eq("id", service_id).eq("is_active", true).maybeSingle();
    if (!service) return res.status(404).json({ ok: false, error: "Услуга не найдена." });
    const { windows, bookings } = await loadAvailabilityAndBookings(supabase, service.expert_id, service.organization_id, day);
    const slots = slotsForServiceDay({ service, availabilityRows: windows, bookingsRows: bookings, day });
    return res.status(200).json({ ok: true, service: publicServiceView(service), free: slots });
  }

  // ── Public: reserve (test flow, existing patient identity) ──
  if (action === "reservePracticeBooking") {
    const { service_id, day, start_time, idempotency_key: idemKey, owner_type, owner_id, session_id } = body;
    if (!service_id || !day || !start_time || !idemKey) {
      return res.status(400).json({ ok: false, error: "Нужны service_id, day, start_time, idempotency_key." });
    }
    const { data: service } = await supabase.from("practice_services").select("*").eq("id", service_id).eq("is_active", true).maybeSingle();
    if (!service) return res.status(404).json({ ok: false, error: "Услуга не найдена." });
    const startsAt = new Date(`${day}T${start_time}:00Z`).toISOString();
    const { data, error } = await supabase.rpc("reserve_practice_booking", {
      p_expert_id: service.expert_id,
      p_organization_id: service.organization_id ?? null,
      p_place_id: service.place_id ?? null,
      p_service_id: service.id,
      p_owner_type: owner_type ?? null,
      p_owner_id: owner_id ?? null,
      p_session_id: session_id ?? null,
      p_starts_at: startsAt,
      p_ends_at: null,
      p_idempotency_key: String(idemKey).slice(0, 128),
      p_ttl_hours: 2,
    });
    if (error) {
      const code = error.code || "";
      if (code === "23P01" || /double|exclusion|duplicate key/i.test(error.message || "")) {
        return res.status(409).json({ ok: false, error: "Это время уже занято." });
      }
      return res.status(503).json({ ok: false, error: "Не удалось зарезервировать." });
    }
    return res.status(200).json({ ok: true, booking_id: data.id, status: data.status, idempotent_replay: data.idempotent_replay === true });
  }

  // ── Public equivalent for test: confirm test payment ──
  if (action === "confirmPracticeTestPayment") {
    const { booking_id } = body;
    if (!booking_id) return res.status(400).json({ ok: false, error: "Нужен booking_id." });
    const { data, error } = await supabase.rpc("confirm_practice_booking", {
      p_booking_id: booking_id,
      p_payment_idempotency_key: `test-${booking_id}`,
      p_actor: "patient_test",
    });
    if (error) return res.status(409).json({ ok: false, error: "Оплату нельзя продолжить." });
    return res.status(200).json({ ok: true, booking_id: data.booking_id, status: data.status });
  }

  if (action === "cancelPracticeBookingPublic") {
    const { booking_id } = body;
    if (!booking_id) return res.status(400).json({ ok: false, error: "Нужен booking_id." });
    const { data, error } = await supabase.rpc("cancel_practice_booking", { p_booking_id: booking_id, p_actor: "patient_test" });
    if (error) return res.status(409).json({ ok: false, error: "Отменить нельзя." });
    return res.status(200).json({ ok: true, booking_id: data.booking_id, status: data.status });
  }

  // ── Doctor side ──
  const ctx = await assertDoctorContext({ ...deps, req });
  if (ctx.error) return res.status(ctx.error.status).json({ ok: false, error: ctx.error.message });
  const { auth } = ctx;

  if (action === "listPracticeBookings") {
    let q = supabase.from("practice_bookings").select("*, practice_services(name)").eq("expert_id", auth.expert.id).order("starts_at", { ascending: false }).limit(100);
    const { data, error } = await q;
    if (error) return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    return res.status(200).json({ ok: true, bookings: data || [] });
  }
  if (action === "completePracticeBooking") {
    const { booking_id } = body;
    const { data, error } = await supabase.rpc("complete_practice_booking", { p_booking_id: booking_id, p_actor: auth.expert.id });
    if (error) return res.status(409).json({ ok: false, error: "Завершить нельзя." });
    return res.status(200).json({ ok: true, booking_id: data.booking_id, status: data.status, commission_id: data.commission_id });
  }
  if (action === "getPracticeFinance") {
    const { data, error } = await supabase.from("practice_commissions").select("*").eq("status", "payable").order("created_at", { ascending: false }).limit(50);
    if (error) return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    const total = (data || []).reduce((s, c) => s + c.fee_kop, 0);
    return res.status(200).json({ ok: true, payable: data || [], payable_total_kop: total });
  }
  return res.status(400).json({ ok: false, error: "Некорректная операция." });
}
