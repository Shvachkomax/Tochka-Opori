// A2 server-side booking for «Моя практика» (test contour only).
// Own tables (practice_places/services/availability/bookings/payments/commissions/events).
// Never touches usage_wallets/usage_ledger (AI credits) or partner accruals.
// Authorization: doctor actions require specialist session + membership in the context.
// Patient public path exposes free slots only — no clinical data, no PII of others.
import { isMyPracticeServerEnabled } from "./workspace-handler.js";
import { freeSlotsForDay } from "./availability.js";
import { timeInMinutes } from "./schedule-draft.js";
import { addDaysUTC } from "./pilot-data.js";
import { slotsForServiceDay, publicServiceView } from "./booking-utils.js";

function requireServerContext(res) {
  if (!isMyPracticeServerEnabled(process.env)) {
    res.status(503).json({ ok: false, error: "Бронирование недоступно в этом окружении." });
    return false;
  }
  return true;
}

// Patient identity: resolve via existing session + access-token validation.
// Injected by deps.resolvePatient to keep this module light for tests.
async function resolvePatient({ resolvePatient, req, supabase }) {
  if (typeof resolvePatient === "function") {
    const r = await resolvePatient(req.body?.session_id, req.body?.access_token, supabase);
    if (!r) return null;
    return { ownerId: r.ownerId, ownerType: r.ownerType, sessionId: r.sessionId, publicCode: r.publicCode, module: r.module };
  }
  return null;
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
    // Context validation: organization must be one the doctor supports (or null for private).
    if (organization_id !== null && organization_id !== undefined) {
      const known = (ctx.auth.memberships || []).some((m) => m.organization_id === organization_id && m.status === "active");
      if (!known) return res.status(403).json({ ok: false, error: "Нет доступа к организации." });
    }
    // place_id must belong to this doctor (no cross-doctor reference places)
    if (place_id) {
      const { data: place } = await supabase.from("practice_places").select("id").eq("id", place_id).eq("expert_id", auth.expert.id).maybeSingle();
      if (!place) return res.status(403).json({ ok: false, error: "Место не принадлежит врачу." });
    }
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
    if (organization_id !== null && organization_id !== undefined) {
      const known = (ctx.auth.memberships || []).some((m) => m.organization_id === organization_id && m.status === "active");
      if (!known) return res.status(403).json({ ok: false, error: "Нет доступа к организации." });
    }
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

// ── Public slot computation moved to ./booking-utils.js (imported above) ──

// ── Booking actions ──
async function loadAvailabilityAndBookings(supabase, expertId, organizationId, day) {
  const isoWeekday = ((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
  // Expire stale holds before presenting availability. The DB constraint is
  // the final authority, but the patient must not see an already released slot
  // as busy while waiting for the next reservation attempt.
  await supabase.rpc("expire_practice_holds");
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
  // EXCLUDE protects the whole doctor, not one organization. Include all of
  // the doctor's active bookings so the public view cannot show a false free
  // slot when another workplace already occupies it.
  const { data: bk } = await bookingsQuery;
  return { windows, bookings: bk || [] };
}

async function verifyPracticeBookingOwnership(supabase, bookingId, { expertId, organizationId, ownerType, ownerId, sessionId } = {}) {
  const { data: b, error } = await supabase
    .from("practice_bookings")
    .select("id, expert_id, organization_id, owner_type, owner_id, session_id, status")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) return { error: { status: 503, message: "Хранилище недоступно." } };
  if (!b) return { error: { status: 404, message: "Запись не найдена." } };
  // doctor scope: only own bookings
  if (expertId && b.expert_id !== expertId) {
    return { error: { status: 403, message: "Нет доступа к записи." } };
  }
  if (expertId && organizationId !== undefined && organizationId !== null) {
    if ((b.organization_id || null) !== (organizationId || null)) {
      return { error: { status: 403, message: "Нет доступа к записи в этой организации." } };
    }
  }
  // patient scope: current owner must match booking owner
  if (!expertId && ownerType && ownerId) {
    if (b.owner_type !== ownerType || String(b.owner_id) !== String(ownerId)) {
      return { error: { status: 403, message: "Запись принадлежит другому пациенту." } };
    }
  }
  if (!expertId && sessionId) {
    if (b.session_id !== sessionId) {
      return { error: { status: 403, message: "Нет доступа к записи." } };
    }
  }
  return { booking: b };
}

export async function handlePracticeBooking(req, res, deps) {
  res.setHeader("Cache-Control", "no-store");
  if (!requireServerContext(res)) return;
  const { getSupabase } = deps;
  const body = req.body || {};
  const action = body.action;
  const supabase = getSupabase();

  // ── Public: patient identity is not needed (slot availability only) ──
  if (action === "getPracticeSlots") {
    const { service_id, day } = body;
    if (!service_id || !day) return res.status(400).json({ ok: false, error: "Нужны service_id и day." });
    const { data: service } = await supabase.from("practice_services").select("*").eq("id", service_id).eq("is_active", true).maybeSingle();
    if (!service) return res.status(404).json({ ok: false, error: "Услуга не найдена." });
    const { windows, bookings } = await loadAvailabilityAndBookings(supabase, service.expert_id, service.organization_id, day);
    const slots = slotsForServiceDay({ service, availabilityRows: windows, bookingsRows: bookings, day });
    return res.status(200).json({ ok: true, service: publicServiceView(service), free: slots });
  }

  // ── Public: list services for a doctor (no clinical data, only catalog) ──
  if (action === "listPracticeDoctorServices") {
    const { expert_id } = body;
    if (!expert_id) return res.status(400).json({ ok: false, error: "Нужен expert_id." });
    const { data, error } = await supabase.from("practice_services").select("id, name, format, price_kop, duration_min").eq("expert_id", expert_id).eq("is_active", true).order("name");
    if (error) return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    return res.status(200).json({ ok: true, services: (data || []).map(publicServiceView) });
  }

  if (action === "listPracticeBookingsPublic") {
    const owner = await resolvePatient(deps, req, supabase);
    if (!owner) return res.status(401).json({ ok: false, error: "Сессия пациента не проверена." });
    const { data, error } = await supabase
      .from("practice_bookings")
      .select("id, expert_id, organization_id, service_id, status, starts_at, ends_at, expires_at, created_at, practice_services(name, format, price_kop, duration_min)")
      .eq("owner_type", owner.ownerType)
      .eq("owner_id", owner.ownerId)
      .order("starts_at", { ascending: false })
      .limit(50);
    if (error) return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    return res.status(200).json({ ok: true, bookings: data || [] });
  }

  // ── Public: reserve (patient identity comes from verified session, not body) ──
  if (action === "reservePracticeBooking") {
    const { service_id, day, start_time, idempotency_key: idemKey } = body;
    if (!service_id || !day || !start_time || !idemKey) {
      return res.status(400).json({ ok: false, error: "Нужны service_id, day, start_time, idempotency_key." });
    }
    // Patient identity: resolve from existing session model, never trust body owner fields
    const owner = await resolvePatient(deps, req, supabase);
    if (!owner) return res.status(401).json({ ok: false, error: "Сессия пациента не проверена." });
    const { data: service } = await supabase.from("practice_services").select("*").eq("id", service_id).eq("is_active", true).maybeSingle();
    if (!service) return res.status(404).json({ ok: false, error: "Услуга не найдена." });
    const startsAt = new Date(`${day}T${start_time}:00Z`).toISOString();
    const { data, error } = await supabase.rpc("reserve_practice_booking", {
      p_expert_id: service.expert_id,
      p_organization_id: service.organization_id ?? null,
      p_place_id: service.place_id ?? null,
      p_service_id: service.id,
      p_owner_type: owner.ownerType,
      p_owner_id: owner.ownerId,
      p_session_id: owner.sessionId,
      p_starts_at: startsAt,
      p_ends_at: null,
      p_idempotency_key: String(idemKey).slice(0, 128),
      p_ttl_minutes: 10, // exactly 10 minutes
    });
    if (error) {
      const code = error.code || "";
      const msg = error.message || "";
      // slot conflicts incl. non-updatable EXCLUDE and availability guards
      if (code === "23P01" || /double|exclusion|duplicate key/i.test(msg) ||
          ["22023", "23505", "42501", "P0001", "P0002", "P0003", "P0004", "P0005"].includes(code) ||
          /slot|hold|idempotency|service context|outside working|past/i.test(msg)) {
        return res.status(409).json({ ok: false, error: "Это время уже занято." });
      }
      return res.status(503).json({ ok: false, error: "Не удалось зарезервировать." });
    }
    return res.status(200).json({ ok: true, booking_id: data.id, status: data.status, idempotent_replay: data.idempotent_replay === true });
  }

  // ── Confirm/ cancel require a verified patient session matched to the booking ──
  if (action === "confirmPracticeTestPayment") {
    const { booking_id } = body;
    if (!booking_id) return res.status(400).json({ ok: false, error: "Нужен booking_id." });
    const owner = await resolvePatient(deps, req, supabase);
    if (!owner) return res.status(401).json({ ok: false, error: "Сессия пациента не проверена." });
    // Owner check: booking must belong to the acting patient (verified session)
    const own = await verifyPracticeBookingOwnership(supabase, booking_id, {
      ownerType: owner.ownerType, ownerId: owner.ownerId, sessionId: owner.sessionId,
    });
    if (own.error) return res.status(own.error.status).json({ ok: false, error: own.error.message });
    const { data, error } = await supabase.rpc("confirm_practice_booking", {
      p_booking_id: booking_id,
      p_payment_idempotency_key: `test-${booking_id}`,
      p_actor: "patient_test",
    });
    if (error) return res.status(409).json({ ok: false, error: "Оплату нельзя продолжить." });
    if (data?.expired || data?.status === "expired") {
      return res.status(409).json({ ok: false, error: "Время удержания истекло. Выберите новый слот." });
    }
    return res.status(200).json({ ok: true, booking_id: data.booking_id, status: data.status });
  }

  if (action === "cancelPracticeBookingPublic") {
    const { booking_id } = body;
    if (!booking_id) return res.status(400).json({ ok: false, error: "Нужен booking_id." });
    const owner = await resolvePatient(deps, req, supabase);
    if (!owner) return res.status(401).json({ ok: false, error: "Сессия пациента не проверена." });
    const own = await verifyPracticeBookingOwnership(supabase, booking_id, {
      ownerType: owner.ownerType, ownerId: owner.ownerId, sessionId: owner.sessionId,
    });
    if (own.error) return res.status(own.error.status).json({ ok: false, error: own.error.message });
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
    if (!booking_id) return res.status(400).json({ ok: false, error: "Нужен booking_id." });
    const own = await verifyPracticeBookingOwnership(supabase, booking_id, { expertId: auth.expert.id, organizationId: body.organization_id ?? null });
    if (own.error) return res.status(own.error.status).json({ ok: false, error: own.error.message });
    const { data, error } = await supabase.rpc("complete_practice_booking", { p_booking_id: booking_id, p_actor: auth.expert.id });
    if (error) return res.status(409).json({ ok: false, error: "Завершить нельзя." });
    return res.status(200).json({ ok: true, booking_id: data.booking_id, status: data.status, commission_id: data.commission_id });
  }
  if (action === "getPracticeFinance") {
    // doctor-scoped only
    const { data, error } = await supabase.from("practice_commissions").select("*, practice_bookings!inner(expert_id, organization_id)")
      .eq("status", "payable").eq("practice_bookings.expert_id", auth.expert.id).order("created_at", { ascending: false }).limit(50);
    if (error) return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    const total = (data || []).reduce((s, c) => s + c.fee_kop, 0);
    return res.status(200).json({ ok: true, payable: data || [], payable_total_kop: total });
  }
  return res.status(400).json({ ok: false, error: "Некорректная операция." });
}
