// A2 server-side booking for «Моя практика» (test contour only).
// Own tables (practice_places/services/availability/bookings/payments/commissions/events).
// Credit payments use the existing wallet and ledger with the practice_booking resource type.
// Authorization: doctor actions require specialist session + membership in the context.
// Patient public path exposes free slots only — no clinical data, no PII of others.
import { isMyPracticeServerEnabled } from "./workspace-handler.js";
import { freeSlotsForDay } from "./availability.js";
import { timeInMinutes } from "./schedule-draft.js";
import { addDaysUTC } from "./pilot-data.js";
import { slotsForServiceDay, publicServiceView } from "./booking-utils.js";
import {
  canLinkPracticeProfiles, changePracticeProfileLink, getPracticePatientOwners,
  getAttachedPracticeService, listPracticePatientSpecialists, samePracticeOwner,
} from "./patient-cabinet.js";

function creditPaymentError(res, error) {
  if (error.code === "P0010") {
    let amounts = {};
    try { amounts = JSON.parse(error.details || "{}"); } catch {}
    return res.status(402).json({
      ok: false, code: "INSUFFICIENT_CREDITS", error: "Недостаточно кредитов. Пополните баланс.",
      required_credits: amounts.required_credits, available_credits: amounts.available_credits,
      missing_credits: amounts.missing_credits,
    });
  }
  const messages = {
    P0011: "Цена или условия отмены изменились. Обновите кабинет и подтвердите запись заново.",
    P0012: "Кошелёк недоступен для оплаты. Проверьте баланс и статус счёта.",
    P0013: "Сумма удержания изменилась. Посмотрите новый расчёт отмены.",
  };
  if (messages[error.code]) return res.status(409).json({ ok: false, code: error.code, error: messages[error.code] });
  return null;
}

function requireServerContext(res) {
  if (!isMyPracticeServerEnabled(process.env)) {
    res.status(503).json({ ok: false, error: "Бронирование недоступно в этом окружении." });
    return false;
  }
  return true;
}

// Patient identity: resolve via existing session + access-token validation.
// Injected by deps.resolvePatient to keep this module light for tests.
async function resolvePatient(deps, req, supabase) {
  if (typeof deps?.resolvePatient === "function") {
    const r = await deps.resolvePatient(req.body?.session_id, req.body?.access_token, supabase);
    if (!r) return null;
    return { ownerId: r.ownerId, ownerType: r.ownerType, sessionId: r.sessionId, publicCode: r.publicCode, module: r.module };
  }
  return null;
}

function hasActiveOrganizationMembership(memberships, organizationId) {
  return memberships.some((membership) => membership.organization_id === organizationId
    && (membership.status === undefined || membership.status === "active"));
}

async function assertDoctorContext({ authorizeSpecialist, getSupabase, req }) {
  const auth = await authorizeSpecialist(req);
  if (auth.error) return { error: { status: auth.status || 401, message: auth.error } };
  const body = req.body || {};
  const orgId = body.organization_id ?? null;
  const memberships = auth.memberships || [];
  if (orgId !== null) {
    // Production authorization returns only active, normalized memberships and
    // intentionally omits status. Explicit non-active rows from injected/tests
    // still fail closed.
    const ok = hasActiveOrganizationMembership(memberships, orgId);
    if (!ok) return { error: { status: 403, message: "Нет доступа к организации." } };
  }
  return { auth, supabase: getSupabase(), orgId };
}

export function selectVisibleAvailability(rows = []) {
  const visible = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const entries = rows.filter((row) => row.weekday === weekday && !row.exception_date);
    const active = entries.filter((row) => row.is_active !== false);
    if (active.length) {
      visible.push(...active);
    } else if (entries.length) {
      const latest = entries.slice().sort((left, right) =>
        String(right.created_at || "").localeCompare(String(left.created_at || "")))[0];
      visible.push(latest);
    }
  }
  visible.push(...rows.filter((row) => row.exception_date && row.is_active !== false));
  return visible;
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
    let query = supabase.from("practice_services").select("*").eq("expert_id", auth.expert.id);
    query = ctx.orgId === null ? query.is("organization_id", null) : query.eq("organization_id", ctx.orgId);
    const { data, error } = await query.order("created_at");
    if (error) return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    return res.status(200).json({ ok: true, services: data || [] });
  }
  if (action === "savePracticeService") {
    const { id, organization_id, place_id, name, format, price_kop, duration_min, is_active } = body;
    if (!name || !String(name).trim()) return res.status(400).json({ ok: false, error: "Название обязательно." });
    if (!Number.isSafeInteger(price_kop) || price_kop < 0) return res.status(400).json({ ok: false, error: "Некорректная цена." });
    if (!Number.isInteger(duration_min) || duration_min < 15 || duration_min > 240) return res.status(400).json({ ok: false, error: "Длительность 15–240 минут." });
    const defaultModules = ["support", "body"].includes(body.module)
      ? [body.module]
      : (Array.isArray(auth.expert.allowed_modules) && auth.expert.allowed_modules.length
        ? auth.expert.allowed_modules
        : ["support", "body"]);
    const modules = body.modules === undefined
      ? (id ? null : defaultModules)
      : [...new Set(Array.isArray(body.modules) ? body.modules : [])];
    if (modules && (!modules.length || modules.some((module) => !["support", "body"].includes(module)))) {
      return res.status(400).json({ ok: false, error: "Выберите Support, Health или оба раздела." });
    }
    if (modules && Array.isArray(auth.expert.allowed_modules)
      && modules.some((module) => !auth.expert.allowed_modules.includes(module))) {
      return res.status(403).json({ ok: false, error: "Нет доступа к выбранному разделу." });
    }
    // Context validation: organization must be one the doctor supports (or null for private).
    if (organization_id !== null && organization_id !== undefined) {
      const known = hasActiveOrganizationMembership(ctx.auth.memberships || [], organization_id);
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
      price_kop, duration_min, is_active: is_active === true,
    };
    if (modules) payload.modules = modules;
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
    const initialized = await supabase.rpc("ensure_default_practice_availability", {
      p_expert_id: auth.expert.id,
      p_organization_id: ctx.orgId,
    });
    if (initialized.error) return res.status(503).json({ ok: false, error: "Не удалось подготовить расписание." });
    let query = supabase.from("practice_availability").select("*").eq("expert_id", auth.expert.id);
    query = ctx.orgId === null ? query.is("organization_id", null) : query.eq("organization_id", ctx.orgId);
    const { data, error } = await query.order("weekday").order("created_at");
    if (error) return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    return res.status(200).json({
      ok: true,
      availability: selectVisibleAvailability(data || []),
      initialized: Number(initialized.data || 0) > 0,
    });
  }
  if (action === "savePracticeAvailability") {
    const { id, organization_id, weekday, exception_date, start_time, end_time, note } = body;
    const exceptionDate = exception_date || null;
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 7) return res.status(400).json({ ok: false, error: "Выберите день недели." });
    if (exceptionDate && (weekday !== 0 || !/^\d{4}-\d{2}-\d{2}$/.test(exceptionDate))) {
      return res.status(400).json({ ok: false, error: "Укажите корректную дату исключения." });
    }
    if (!exceptionDate && weekday === 0) return res.status(400).json({ ok: false, error: "Укажите дату исключения." });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start_time || "") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end_time || "")) {
      return res.status(400).json({ ok: false, error: "Укажите время в формате ЧЧ:ММ." });
    }
    if (start_time >= end_time) return res.status(400).json({ ok: false, error: "Конец должен быть позже начала." });
    if (organization_id !== null && organization_id !== undefined) {
      const known = hasActiveOrganizationMembership(ctx.auth.memberships || [], organization_id);
      if (!known) return res.status(403).json({ ok: false, error: "Нет доступа к организации." });
    }
    const payload = {
      expert_id: auth.expert.id, organization_id: organization_id ?? null,
      weekday, exception_date: exceptionDate,
      start_time, end_time, note: note ? String(note).slice(0, 300) : null, is_active: true,
    };
    let result;
    if (id) {
      let update = supabase.from("practice_availability").update(payload).eq("id", id).eq("expert_id", auth.expert.id);
      update = ctx.orgId === null ? update.is("organization_id", null) : update.eq("organization_id", ctx.orgId);
      result = await update.select().maybeSingle();
    } else result = await supabase.from("practice_availability").insert(payload).select().maybeSingle();
    if (result.error) return res.status(503).json({ ok: false, error: "Не удалось сохранить." });
    return res.status(200).json({ ok: true, entry: result.data });
  }
  if (action === "setPracticeAvailabilityStatus" || action === "deletePracticeAvailability") {
    if (!body.id) return res.status(400).json({ ok: false, error: "Интервал не указан." });
    const active = action === "setPracticeAvailabilityStatus" ? body.is_active === true : false;
    let update = supabase.from("practice_availability").update({ is_active: active }).eq("id", body.id).eq("expert_id", auth.expert.id);
    update = ctx.orgId === null ? update.is("organization_id", null) : update.eq("organization_id", ctx.orgId);
    const { error } = await update;
    if (error) return res.status(503).json({ ok: false, error: "Ошибка." });
    return res.status(200).json({ ok: true });
  }
  if (action === "resetPracticeAvailabilityDefaults") {
    if (body.confirmed !== true) return res.status(400).json({ ok: false, error: "Подтвердите восстановление расписания." });
    const { data, error } = await supabase.rpc("reset_default_practice_availability", {
      p_expert_id: auth.expert.id,
      p_organization_id: ctx.orgId,
    });
    if (error || Number(data || 0) !== 7) return res.status(503).json({ ok: false, error: "Не удалось восстановить расписание." });
    return res.status(200).json({ ok: true, restored: 7 });
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
  let availabilityQuery = supabase
    .from("practice_availability")
    .select("*")
    .eq("expert_id", expertId)
    .eq("is_active", true);
  availabilityQuery = organizationId === null
    ? availabilityQuery.is("organization_id", null)
    : availabilityQuery.eq("organization_id", organizationId);
  const { data: av } = await availabilityQuery;
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

async function verifyPracticeBookingOwnership(supabase, bookingId, { expertId, organizationId, ownerType, ownerId } = {}) {
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
  if (!expertId && ownerType && ownerId) {
    const owner = { ownerType, ownerId, module: ownerType === "anonymous_case" ? "support" : "body" };
    const bookedBy = { ownerType: b.owner_type, ownerId: b.owner_id };
    if (!samePracticeOwner(owner, bookedBy)) {
      const result = await getPracticePatientOwners(supabase, owner);
      if (result.error) return { error: { status: 503, message: "Хранилище недоступно." } };
      if (!result.owners.some((candidate) => samePracticeOwner(candidate, bookedBy))) {
        return { error: { status: 403, message: "Запись принадлежит другому пациенту." } };
      }
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

  if (["getPracticePatientCabinet", "unlinkPracticePatientProfiles", "revokePracticeSpecialist"].includes(action)) {
    const owner = await resolvePatient(deps, req, supabase);
    if (!owner) return res.status(401).json({ ok: false, error: "Войдите снова по коду продолжения." });
    const linkingAvailable = canLinkPracticeProfiles();

    try {
      if (action === "unlinkPracticePatientProfiles") {
        if (!linkingAvailable) return res.status(403).json({ ok: false, error: "Привязка профилей здесь недоступна." });
        const result = await changePracticeProfileLink(supabase, owner, null);
        if (result.error) throw result.error;
        return res.status(200).json({ ok: true });
      }
      if (action === "revokePracticeSpecialist") {
        if (!body.expert_id || typeof body.expert_id !== "string") {
          return res.status(400).json({ ok: false, error: "Не указан специалист." });
        }
        const result = await supabase.rpc("revoke_patient_specialist_link", {
          p_owner_type: owner.ownerType,
          p_owner_id: owner.ownerId,
          p_public_code: owner.publicCode || null,
          p_module: owner.module,
          p_expert_id: body.expert_id,
          p_organization_id: body.organization_id ?? null,
        });
        if (result.error) throw result.error;
        if (!result.data?.ok) {
          return res.status(400).json({ ok: false, error: result.data?.error || "Не удалось отозвать доступ." });
        }
        return res.status(200).json({ ok: true, revoked: Number(result.data.revoked || 0) });
      }

      const { owners, error } = await getPracticePatientOwners(supabase, owner);
      if (error) throw error;
      const bookingOwners = owners.map(({ ownerType, ownerId }) =>
        `and(owner_type.eq.${ownerType},owner_id.eq.${ownerId})`).join(",");
      const [specialists, bookings, wallet] = await Promise.all([
        listPracticePatientSpecialists(supabase, [owner], owner.module),
        supabase.from("practice_bookings")
          .select("id, status, starts_at, ends_at, expires_at, experts(name), organizations(name), practice_places(name), practice_services(name, format, price_credits), practice_booking_credits(charged_credits, refunded_credits, cancellation_fee_credits)")
          .or(bookingOwners).order("starts_at", { ascending: false }).limit(50),
        supabase.rpc("ensure_usage_wallet", { p_owner_type: owner.ownerType, p_owner_id: owner.ownerId, p_module: owner.module }),
      ]);
      if (bookings.error || wallet.error || !wallet.data) throw bookings.error || wallet.error || new Error("Wallet unavailable");
      return res.status(200).json({
        ok: true, specialists, bookings: bookings.data || [],
        linked: owners.length > 1, linking_available: linkingAvailable,
        available_credits: Number(wallet.data?.balance || 0), wallet_status: wallet.data?.status,
        credits_per_ruble: 10, cancellation_policy: { version: "12h-20-v1", hours: 12, fee_percent: 20 },
      });
    } catch {
      return res.status(500).json({ ok: false, error: "Не удалось обновить кабинет. Попробуйте ещё раз." });
    }
  }

  if (["reservePracticeBooking", "payPracticeBookingCredits", "confirmPracticeTestPayment"].includes(action)
    && (!Number.isSafeInteger(body.expected_price_credits) || body.expected_price_credits < 0
      || body.cancellation_policy_version !== "12h-20-v1")) {
    return res.status(400).json({ ok: false, error: "Подтвердите стоимость и условия отмены записи." });
  }

  // Patient-visible catalog and slots are available only for an attached
  // specialist in the current Support / Health module.
  if (action === "getPracticeSlots") {
    const { service_id, day } = body;
    if (!service_id || !day) return res.status(400).json({ ok: false, error: "Нужны service_id и day." });
    const owner = await resolvePatient(deps, req, supabase);
    if (!owner) return res.status(401).json({ ok: false, error: "Сессия пациента не проверена." });
    const attached = await getAttachedPracticeService(supabase, owner, service_id);
    if (attached.error) return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    const service = attached.service;
    if (!service) return res.status(404).json({ ok: false, error: "Услуга недоступна." });
    const { windows, bookings } = await loadAvailabilityAndBookings(supabase, service.expert_id, service.organization_id ?? null, day);
    const slots = slotsForServiceDay({ service, availabilityRows: windows, bookingsRows: bookings, day });
    return res.status(200).json({ ok: true, service: publicServiceView(service), free: slots });
  }

  // List only the current patient's attached, published services.
  if (action === "listPracticeDoctorServices") {
    const { expert_id } = body;
    if (!expert_id) return res.status(400).json({ ok: false, error: "Нужен expert_id." });
    const owner = await resolvePatient(deps, req, supabase);
    if (!owner) return res.status(401).json({ ok: false, error: "Сессия пациента не проверена." });
    try {
      const specialists = await listPracticePatientSpecialists(supabase, [owner], owner.module);
      const services = specialists.filter((specialist) => specialist.expert_id === expert_id)
        .flatMap((specialist) => specialist.services || []);
      if (!services.length) return res.status(404).json({ ok: false, error: "Услуги недоступны." });
      return res.status(200).json({ ok: true, services });
    } catch {
      return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    }
  }

  if (action === "listPracticeBookingsPublic") {
    const owner = await resolvePatient(deps, req, supabase);
    if (!owner) return res.status(401).json({ ok: false, error: "Сессия пациента не проверена." });
    const { data, error } = await supabase
      .from("practice_bookings")
      .select("id, expert_id, organization_id, service_id, status, starts_at, ends_at, expires_at, created_at, practice_services(name, format, price_kop, duration_min, price_credits), practice_booking_credits(charged_credits, refunded_credits, cancellation_fee_credits)")
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
    const attached = await getAttachedPracticeService(supabase, owner, service_id);
    if (attached.error) return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    const service = attached.service;
    if (!service) return res.status(404).json({ ok: false, error: "Услуга недоступна." });
    const start = new Date(`${day}T${start_time}:00Z`);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ ok: false, error: "Выберите дату и время приёма." });
    }
    const startsAt = start.toISOString();
    const { data, error } = await supabase.rpc("reserve_practice_booking_with_credits", {
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
      p_expected_credits: body.expected_price_credits,
      p_policy_version: body.cancellation_policy_version,
    });
    if (error) {
      const paymentError = creditPaymentError(res, error);
      if (paymentError) return paymentError;
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
  if (action === "confirmPracticeTestPayment" || action === "payPracticeBookingCredits") {
    const { booking_id } = body;
    if (!booking_id) return res.status(400).json({ ok: false, error: "Нужен booking_id." });
    const owner = await resolvePatient(deps, req, supabase);
    if (!owner) return res.status(401).json({ ok: false, error: "Сессия пациента не проверена." });
    // Owner check: booking must belong to the acting patient (verified session)
    const own = await verifyPracticeBookingOwnership(supabase, booking_id, {
      ownerType: owner.ownerType, ownerId: owner.ownerId,
    });
    if (own.error) return res.status(own.error.status).json({ ok: false, error: own.error.message });
    const { data, error } = await supabase.rpc("pay_practice_booking_credits", {
      p_booking_id: booking_id,
      p_expected_credits: body.expected_price_credits,
      p_policy_version: body.cancellation_policy_version,
    });
    if (error) return creditPaymentError(res, error) || res.status(409).json({ ok: false, error: "Оплату нельзя продолжить." });
    if (data?.expired || data?.status === "expired") {
      return res.status(409).json({ ok: false, error: "Время удержания истекло. Выберите новый слот." });
    }
    return res.status(200).json({ ok: true, booking_id: data.booking_id, status: data.status });
  }

  if (action === "cancelPracticeBookingPublic" || action === "quotePracticeCancellation") {
    const { booking_id } = body;
    if (!booking_id) return res.status(400).json({ ok: false, error: "Нужен booking_id." });
    const owner = await resolvePatient(deps, req, supabase);
    if (!owner) return res.status(401).json({ ok: false, error: "Сессия пациента не проверена." });
    const own = await verifyPracticeBookingOwnership(supabase, booking_id, {
      ownerType: owner.ownerType, ownerId: owner.ownerId,
    });
    if (own.error) return res.status(own.error.status).json({ ok: false, error: own.error.message });
    if (action === "quotePracticeCancellation") {
      const { data, error } = await supabase.rpc("quote_practice_booking_cancellation", { p_booking_id: booking_id });
      if (error) return res.status(409).json({ ok: false, error: "Не удалось рассчитать возврат." });
      return res.status(200).json({ ok: true, ...data });
    }
    const { data, error } = await supabase.rpc("cancel_practice_booking_with_credits", {
      p_booking_id: booking_id, p_actor: owner.ownerId,
      p_expected_fee_credits: body.expected_fee_credits,
    });
    if (error) return creditPaymentError(res, error) || res.status(409).json({ ok: false, error: "Отменить нельзя." });
    return res.status(200).json({ ok: true, ...data });
  }

  // ── Doctor side ──
  const ctx = await assertDoctorContext({ ...deps, req });
  if (ctx.error) return res.status(ctx.error.status).json({ ok: false, error: ctx.error.message });
  const { auth } = ctx;

  if (action === "listPracticeBookings") {
    let q = supabase.from("practice_bookings").select("*, practice_services(name)")
      .eq("expert_id", auth.expert.id);
    q = ctx.orgId === null ? q.is("organization_id", null) : q.eq("organization_id", ctx.orgId);
    q = q.order("starts_at", { ascending: false }).limit(100);
    const { data, error } = await q;
    if (error) return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    return res.status(200).json({ ok: true, bookings: data || [] });
  }
  if (action === "completePracticeBooking") {
    const { booking_id } = body;
    if (!booking_id) return res.status(400).json({ ok: false, error: "Нужен booking_id." });
    const own = await verifyPracticeBookingOwnership(supabase, booking_id, { expertId: auth.expert.id, organizationId: body.organization_id ?? null });
    if (own.error) return res.status(own.error.status).json({ ok: false, error: own.error.message });
    const { data, error } = await supabase.rpc("complete_practice_booking_with_credits", { p_booking_id: booking_id, p_actor: auth.expert.id });
    if (error) return res.status(409).json({ ok: false, error: "Завершить нельзя." });
    return res.status(200).json({ ok: true, booking_id: data.booking_id, status: data.status, commission_id: data.commission_id, service_fee_credits: data.service_fee_credits });
  }
  if (action === "getPracticeFinance") {
    // doctor-scoped only
    const { data, error } = await supabase.from("practice_commissions").select("*, practice_bookings!inner(expert_id, organization_id)")
      .eq("status", "payable").eq("practice_bookings.expert_id", auth.expert.id).order("created_at", { ascending: false }).limit(50);
    if (error) return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    const credits = await supabase.from("practice_booking_credits")
      .select("charged_credits, refunded_credits, cancellation_fee_credits, service_fee_credits, settled_at, practice_bookings!inner(expert_id)")
      .eq("practice_bookings.expert_id", auth.expert.id);
    if (credits.error) return res.status(503).json({ ok: false, error: "Хранилище недоступно." });
    const settled = (credits.data || []).filter((payment) => payment.settled_at);
    const total = (data || []).reduce((sum, commission) => sum + commission.fee_kop, 0);
    return res.status(200).json({
      ok: true, payable: data || [], payable_total_kop: total,
      specialist_credits: settled.reduce((sum, payment) => sum + Number(payment.charged_credits) - Number(payment.service_fee_credits), 0),
      service_fee_credits: settled.reduce((sum, payment) => sum + Number(payment.service_fee_credits), 0),
      cancellation_fee_credits: (credits.data || []).reduce((sum, payment) => sum + Number(payment.cancellation_fee_credits), 0),
    });
  }
  return res.status(400).json({ ok: false, error: "Некорректная операция." });
}
