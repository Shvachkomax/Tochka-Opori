import { getSupabase } from "../lib/supabase.js";
import { getPrivacySafeMode } from "../lib/sanitize.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { action } = req.body || {};

  try {
    switch (action) {
      case "login":
        return await handleLogin(req, res);
      case "register":
        return await handleRegister(req, res);
      case "listRequests":
        return await handleListRequests(req, res);
      case "updateRequestStatus":
        return await handleUpdateRequestStatus(req, res);
      case "debug":
        return await handleDebug(req, res);
      // Organization actions
      case "listOrganizations":
        return await handleListOrganizations(req, res);
      case "createOrganization":
        return await handleCreateOrganization(req, res);
      case "updateOrganization":
        return await handleUpdateOrganization(req, res);
      case "listOrganizationExperts":
        return await handleListOrganizationExperts(req, res);
      case "addExpertToOrganization":
        return await handleAddExpertToOrganization(req, res);
      case "removeExpertFromOrganization":
        return await handleRemoveExpertFromOrganization(req, res);
      case "updateExpertOrganizationRole":
        return await handleUpdateExpertOrganizationRole(req, res);
      // Invite links
      case "createDoctorInviteLink":
        return await handleCreateDoctorInviteLink(req, res);
      case "listDoctorInviteLinks":
        return await handleListDoctorInviteLinks(req, res);
      case "disableDoctorInviteLink":
        return await handleDisableDoctorInviteLink(req, res);
      // Patient management
      case "listMyPatients":
        return await handleListMyPatients(req, res);
      case "assignPatientToExpert":
        return await handleAssignPatientToExpert(req, res);
      case "listAllExperts":
        return await handleListAllExperts(req, res);
      case "checkInviteToken":
        return await handleCheckInviteToken(req, res);
      default:
        return res.status(400).json({ ok: false, error: "Unknown experts action", action });
    }
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Internal error" });
  }
}

// ── Auth helpers ──────────────────────────────────────────

function authorizeAdmin(req) {
  const { admin_secret } = req.body || {};
  return admin_secret && process.env.ADMIN_SECRET && admin_secret === process.env.ADMIN_SECRET;
}

async function authorizeExpertById(expertId) {
  if (!expertId) return null;
  const { data } = await getSupabase()
    .from("experts")
    .select("id, name, role, specialty, city, organization")
    .eq("id", expertId)
    .eq("is_active", true)
    .maybeSingle();
  return data;
}

async function getExpertMembership(expertId) {
  if (!expertId) return null;
  const { data } = await getSupabase()
    .from("expert_organization_memberships")
    .select("id, organization_id, role, status, organizations(name, slug, type)")
    .eq("expert_id", expertId)
    .eq("status", "active")
    .maybeSingle();
  return data;
}

// ── Login (enhanced) ──────────────────────────────────────

async function handleLogin(req, res) {
  try {
    const { access_code } = req.body || {};

    if (!access_code || typeof access_code !== "string") {
      return res.status(400).json({ ok: false, error: "Введите код специалиста" });
    }

    const trimmed = access_code.trim().toUpperCase();

    const { data, error } = await getSupabase()
      .from("experts")
      .select("id, name, role, specialty, city, organization")
      .eq("access_code", trimmed)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.error("Expert login error:", error);
      return res.status(500).json({ ok: false, error: "Ошибка проверки кода" });
    }

    if (!data) {
      return res.status(404).json({ ok: false, error: "Код специалиста не найден" });
    }

    const membership = await getExpertMembership(data.id);
    const orgInfo = membership
      ? {
          organization_id: membership.organization_id,
          organization_name: membership.organizations?.name || null,
          organization_slug: membership.organizations?.slug || null,
          organization_type: membership.organizations?.type || null,
          role_in_organization: membership.role,
        }
      : null;

    return res.status(200).json({
      ok: true,
      expert: {
        id: data.id,
        name: data.name,
        role: data.role,
        specialty: data.specialty,
        city: data.city,
        organization: data.organization,
        membership: orgInfo,
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Ошибка авторизации" });
  }
}

// ── Register (unchanged) ──────────────────────────────────

async function handleRegister(req, res) {
  try {
    const { name, role, specialty } = req.body || {};

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ ok: false, error: "Укажите имя (минимум 2 символа)" });
    }

    if (!role) {
      return res.status(400).json({ ok: false, error: "Укажите роль" });
    }

    const validRoles = ["psychiatrist", "psychologist", "psychotherapist", "clinical_psychologist", "other"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ ok: false, error: "Некорректная роль" });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing Supabase env vars",
        hasUrl: Boolean(process.env.SUPABASE_URL),
        hasServiceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      });
    }

    const { generateExpertCode } = await import("../lib/expertCode.js");
    const accessCode = generateExpertCode();

    const privacy = getPrivacySafeMode();

    const { data: newExpert, error } = await getSupabase()
      .from("experts")
      .insert({
        name: name.trim(),
        role,
        specialty: specialty?.trim() || null,
        email: privacy ? null : null,
        telegram: privacy ? null : null,
        city: privacy ? null : null,
        organization: privacy ? null : null,
        access_code: accessCode,
        is_active: true,
      })
      .select("id, name, role, specialty")
      .single();

    if (error) {
      console.error("Expert registration error:", error);
      return res.status(500).json({
        ok: false,
        error: "Ошибка регистрации. Попробуйте позже.",
        details: error.message,
        code: error.code || null,
        hint: error.hint || null,
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Регистрация прошла успешно!",
      expert: newExpert,
      access_code: accessCode,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка регистрации",
    });
  }
}

// ── List requests (unchanged) ─────────────────────────────

async function handleListRequests(req, res) {
  try {
    const params = req.body || {};
    const status = params.status || "pending";
    const limit = Math.min(parseInt(params.limit) || 50, 200);
    const offset = parseInt(params.offset) || 0;

    let query = getSupabase()
      .from("expert_requests")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error, count } = await query;

    if (error) {
      return res.status(500).json({ ok: false, error: "Ошибка загрузки заявок" });
    }

    return res.status(200).json({
      ok: true,
      requests: data || [],
      total: count || 0,
      status,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Ошибка загрузки заявок" });
  }
}

// ── Update request status (unchanged) ─────────────────────

async function handleUpdateRequestStatus(req, res) {
  try {
    const { request_id, status, reviewer_comment, admin_secret } = req.body || {};

    if (!admin_secret || admin_secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ ok: false, error: "Неверный пароль администратора" });
    }

    if (!request_id) {
      return res.status(400).json({ ok: false, error: "Не указан request_id" });
    }

    const ALLOWED = ["pending", "approved", "rejected"];
    if (!status || !ALLOWED.includes(status)) {
      return res.status(400).json({
        ok: false,
        error: `Недопустимый статус. Разрешены: ${ALLOWED.join(", ")}`,
      });
    }

    const updates = {
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: "Maxim",
    };

    if (reviewer_comment !== undefined) {
      updates.reviewer_comment = reviewer_comment;
    }

    const { error: updateError } = await getSupabase()
      .from("expert_requests")
      .update(updates)
      .eq("id", request_id);

    if (updateError) {
      return res.status(500).json({ ok: false, error: "Ошибка обновления статуса заявки" });
    }

    const label = { approved: "Одобрено", rejected: "Отклонено", pending: "Возвращено в ожидание" };

    return res.status(200).json({
      ok: true,
      message: `${label[status] || "Статус обновлён"}.`,
      request_id,
      status,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Ошибка обновления статуса заявки" });
  }
}

// ── Debug (unchanged) ─────────────────────────────────────

async function handleDebug(req, res) {
  return res.status(200).json({
    ok: true,
    hasUrl: Boolean(process.env.SUPABASE_URL),
    hasServiceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    privacySafeMode: getPrivacySafeMode(),
  });
}

// ═══════════════════════════════════════════════════════════
// ORGANIZATIONS
// ═══════════════════════════════════════════════════════════

async function handleListOrganizations(req, res) {
  if (!authorizeAdmin(req)) {
    return res.status(403).json({ ok: false, error: "Только администратор" });
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("organizations")
    .select(`
      *,
      expert_organization_memberships(count),
      patient_assignments(count)
    `)
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ ok: false, error: "Ошибка загрузки организаций" });
  }

  const orgs = (data || []).map((o) => ({
    ...o,
    expert_count: o.expert_organization_memberships?.[0]?.count || 0,
    patient_count: o.patient_assignments?.[0]?.count || 0,
    expert_organization_memberships: undefined,
    patient_assignments: undefined,
  }));

  return res.status(200).json({ ok: true, organizations: orgs });
}

async function handleCreateOrganization(req, res) {
  if (!authorizeAdmin(req)) {
    return res.status(403).json({ ok: false, error: "Только администратор" });
  }

  const { name, slug, type, city, comment, settings } = req.body || {};
  if (!name || typeof name !== "string" || name.trim().length < 2) {
    return res.status(400).json({ ok: false, error: "Укажите название организации" });
  }

  const supabase = getSupabase();
  let finalSlug = slug?.trim() || null;

  if (!finalSlug) {
    finalSlug = name.trim()
      .toLowerCase()
      .replace(/[^a-zа-яё0-9\s-]/g, "")
      .replace(/[а-яё]/g, (c) => ({ а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ы: "y", э: "e", ю: "yu", я: "ya" }[c] || c)
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "org";

    // ensure uniqueness — append -2, -3, etc.
    const existing = await supabase
      .from("organizations")
      .select("slug")
      .like("slug", `${finalSlug}%`);
    if (!existing.error && existing.data?.length > 0) {
      const slugs = new Set(existing.data.map((r) => r.slug));
      let counter = 2;
      while (slugs.has(`${finalSlug}-${counter}`)) counter++;
      finalSlug = `${finalSlug}-${counter}`;
    }
  }

  const payload = {
    name: name.trim(),
    slug: finalSlug,
    type: type || "private_clinic",
    city: city?.trim() || null,
    comment: comment?.trim() || null,
    settings: settings || {},
  };

  const { data, error } = await supabase
    .from("organizations")
    .insert(payload)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ ok: false, error: "Организация с таким slug уже существует" });
    }
    return res.status(500).json({ ok: false, error: "Ошибка создания организации" });
  }

  return res.status(200).json({ ok: true, organization: data });
}

async function handleUpdateOrganization(req, res) {
  if (!authorizeAdmin(req)) {
    return res.status(403).json({ ok: false, error: "Только администратор" });
  }

  const { id, name, type, status, city, comment, settings } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Не указан id организации" });
  }

  const supabase = getSupabase();
  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (type !== undefined) updates.type = type;
  if (status !== undefined) updates.status = status;
  if (city !== undefined) updates.city = city?.trim() || null;
  if (comment !== undefined) updates.comment = comment?.trim() || null;
  if (settings !== undefined) updates.settings = settings;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("organizations")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ ok: false, error: "Ошибка обновления организации" });
  }

  return res.status(200).json({ ok: true, organization: data });
}

async function handleListOrganizationExperts(req, res) {
  if (!authorizeAdmin(req)) {
    return res.status(403).json({ ok: false, error: "Только администратор" });
  }

  const { organization_id } = req.body || {};
  if (!organization_id) {
    return res.status(400).json({ ok: false, error: "Не указан organization_id" });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("expert_organization_memberships")
    .select(`
      id,
      role,
      status,
      created_at,
      expert_id,
      experts(id, name, role, specialty, access_code, is_active)
    `)
    .eq("organization_id", organization_id)
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ ok: false, error: "Ошибка загрузки специалистов организации" });
  }

  return res.status(200).json({ ok: true, members: data || [] });
}

async function handleAddExpertToOrganization(req, res) {
  if (!authorizeAdmin(req)) {
    return res.status(403).json({ ok: false, error: "Только администратор" });
  }

  const { organization_id, expert_id, role } = req.body || {};
  if (!organization_id || !expert_id) {
    return res.status(400).json({ ok: false, error: "Укажите organization_id и expert_id" });
  }

  const supabase = getSupabase();

  const { data: existing } = await supabase
    .from("expert_organization_memberships")
    .select("id, status")
    .eq("organization_id", organization_id)
    .eq("expert_id", expert_id)
    .maybeSingle();

  if (existing) {
    if (existing.status === "active") {
      return res.status(409).json({ ok: false, error: "Специалист уже в организации" });
    }
    const { error: reactErr } = await supabase
      .from("expert_organization_memberships")
      .update({ status: "active", role: role || "doctor" })
      .eq("id", existing.id);
    if (reactErr) {
      return res.status(500).json({ ok: false, error: "Ошибка восстановления членства" });
    }
    return res.status(200).json({ ok: true, message: "Членство восстановлено" });
  }

  const { error } = await supabase
    .from("expert_organization_memberships")
    .insert({ organization_id, expert_id, role: role || "doctor" });

  if (error) {
    return res.status(500).json({ ok: false, error: "Ошибка добавления специалиста" });
  }

  return res.status(200).json({ ok: true, message: "Специалист добавлен в организацию" });
}

async function handleRemoveExpertFromOrganization(req, res) {
  if (!authorizeAdmin(req)) {
    return res.status(403).json({ ok: false, error: "Только администратор" });
  }

  const { organization_id, expert_id } = req.body || {};
  if (!organization_id || !expert_id) {
    return res.status(400).json({ ok: false, error: "Укажите organization_id и expert_id" });
  }

  const supabase = getSupabase();

  // Soft remove — set status to "removed"
  const { error } = await supabase
    .from("expert_organization_memberships")
    .update({ status: "removed" })
    .eq("organization_id", organization_id)
    .eq("expert_id", expert_id);

  if (error) {
    return res.status(500).json({ ok: false, error: "Ошибка удаления специалиста из организации" });
  }

  return res.status(200).json({ ok: true, message: "Специалист удалён из организации" });
}

async function handleUpdateExpertOrganizationRole(req, res) {
  if (!authorizeAdmin(req)) {
    return res.status(403).json({ ok: false, error: "Только администратор" });
  }

  const { organization_id, expert_id, role } = req.body || {};
  if (!organization_id || !expert_id || !role) {
    return res.status(400).json({ ok: false, error: "Укажите organization_id, expert_id и role" });
  }

  const validRoles = ["owner", "admin", "supervisor", "doctor", "assistant", "observer"];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ ok: false, error: "Некорректная роль" });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("expert_organization_memberships")
    .update({ role })
    .eq("organization_id", organization_id)
    .eq("expert_id", expert_id);

  if (error) {
    return res.status(500).json({ ok: false, error: "Ошибка обновления роли" });
  }

  return res.status(200).json({ ok: true, message: "Роль обновлена" });
}

// ═══════════════════════════════════════════════════════════
// INVITE LINKS
// ═══════════════════════════════════════════════════════════

async function handleCreateDoctorInviteLink(req, res) {
  const { expert_id, expert_code, admin_secret, organization_id, label, max_uses } = req.body || {};
  const isAdmin = authorizeAdmin(req);

  let expert = null;
  if (isAdmin && expert_id) {
    expert = await authorizeExpertById(expert_id);
  } else if (expert_code) {
    const trimmed = expert_code.trim().toUpperCase();
    const { data } = await getSupabase()
      .from("experts")
      .select("id, name")
      .eq("access_code", trimmed)
      .eq("is_active", true)
      .maybeSingle();
    expert = data;
  }

  if (!expert) {
    return res.status(403).json({ ok: false, error: "Специалист не найден или неактивен" });
  }

  // Determine organization: prefer provided org_id, otherwise use expert's membership
  let orgId = organization_id || null;
  if (!orgId) {
    const membership = await getExpertMembership(expert.id);
    orgId = membership?.organization_id || null;
  }

  const { generateExpertCode } = await import("../lib/expertCode.js");
  // Use expert code generator for invite token as well (cryptographically random)
  const token = generateExpertCode().toLowerCase().replace(/-/g, "").slice(0, 32);

  const supabase = getSupabase();
  const payload = {
    token,
    organization_id: orgId,
    expert_id: expert.id,
    label: label?.trim() || null,
    max_uses: max_uses ? parseInt(max_uses) : null,
    status: "active",
    expires_at: null, // no expiry by default
  };

  const { data, error } = await supabase
    .from("doctor_invite_links")
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error("createInviteLink error:", error);
    return res.status(500).json({ ok: false, error: "Ошибка создания ссылки" });
  }

  return res.status(200).json({
    ok: true,
    invite_link: {
      ...data,
      url: `https://tochka-opori.online/start/${data.token}`,
    },
  });
}

async function handleListDoctorInviteLinks(req, res) {
  const { expert_id, expert_code, organization_id, admin_secret } = req.body || {};
  const isAdmin = authorizeAdmin(req);

  const supabase = getSupabase();
  let query = supabase
    .from("doctor_invite_links")
    .select(`
      *,
      experts(id, name),
      organizations(name)
    `)
    .order("created_at", { ascending: false });

  if (isAdmin) {
    if (organization_id) {
      query = query.eq("organization_id", organization_id);
    }
  } else if (expert_code) {
    const trimmed = expert_code.trim().toUpperCase();
    const { data: expert } = await supabase
      .from("experts")
      .select("id")
      .eq("access_code", trimmed)
      .eq("is_active", true)
      .maybeSingle();
    if (!expert) {
      return res.status(403).json({ ok: false, error: "Специалист не найден" });
    }
    query = query.eq("expert_id", expert.id);
  } else {
    return res.status(403).json({ ok: false, error: "Доступ запрещён" });
  }

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ ok: false, error: "Ошибка загрузки ссылок" });
  }

  return res.status(200).json({
    ok: true,
    invite_links: (data || []).map((l) => ({
      ...l,
      url: `https://tochka-opori.online/start/${l.token}`,
    })),
  });
}

async function handleDisableDoctorInviteLink(req, res) {
  const { link_id, expert_code, admin_secret } = req.body || {};
  const isAdmin = authorizeAdmin(req);

  if (!link_id) {
    return res.status(400).json({ ok: false, error: "Не указан link_id" });
  }

  const supabase = getSupabase();

  if (!isAdmin) {
    if (!expert_code) {
      return res.status(403).json({ ok: false, error: "Доступ запрещён" });
    }
    const trimmed = expert_code.trim().toUpperCase();
    const { data: expert } = await supabase
      .from("experts")
      .select("id")
      .eq("access_code", trimmed)
      .eq("is_active", true)
      .maybeSingle();
    if (!expert) {
      return res.status(403).json({ ok: false, error: "Специалист не найден" });
    }
    // Verify the link belongs to this expert
    const { data: link } = await supabase
      .from("doctor_invite_links")
      .select("expert_id")
      .eq("id", link_id)
      .single();
    if (!link || link.expert_id !== expert.id) {
      return res.status(403).json({ ok: false, error: "Это не ваша ссылка" });
    }
  }

  const { error } = await supabase
    .from("doctor_invite_links")
    .update({ status: "disabled" })
    .eq("id", link_id);

  if (error) {
    return res.status(500).json({ ok: false, error: "Ошибка отключения ссылки" });
  }

  return res.status(200).json({ ok: true, message: "Ссылка отключена" });
}

// ═══════════════════════════════════════════════════════════
// PATIENT MANAGEMENT
// ═══════════════════════════════════════════════════════════

async function handleListMyPatients(req, res) {
  const { expert_id, expert_code, organization_id: reqOrgId } = req.body || {};
  const isAdmin = authorizeAdmin(req);

  const supabase = getSupabase();

  let expert = null;
  if (isAdmin && expert_id) {
    expert = await authorizeExpertById(expert_id);
  } else if (expert_code) {
    const trimmed = expert_code.trim().toUpperCase();
    const { data } = await supabase
      .from("experts")
      .select("id, name")
      .eq("access_code", trimmed)
      .eq("is_active", true)
      .maybeSingle();
    expert = data;
  }

  if (!expert && !isAdmin) {
    return res.status(403).json({ ok: false, error: "Специалист не найден" });
  }

  // Build the patient list
  // Patients accessible via: patient_assignments (primary) OR patient_access
  const expertId = expert?.id;
  const membership = expertId ? await getExpertMembership(expertId) : null;
  const orgId = reqOrgId || membership?.organization_id;

  let query = supabase
    .from("patient_assignments")
    .select(`
      *,
      primary_expert:primary_expert_id(id, name),
      organization:organization_id(id, name)
    `)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (isAdmin && !expertId && !orgId) {
    // Admin sees all
  } else if (expertId) {
    // Expert sees patients where they are primary OR have access
    // For simplicity, we do two queries and combine
    // First: patients where this expert is primary
    // Second: patients where this expert has access via patient_access
    const { data: assigned, error: err1 } = await supabase
      .from("patient_assignments")
      .select(`
        *,
        primary_expert:primary_expert_id(id, name),
        organization:organization_id(id, name)
      `)
      .eq("status", "active")
      .eq("primary_expert_id", expertId)
      .order("created_at", { ascending: false });

    const { data: accessed, error: err2 } = await supabase
      .from("patient_access")
      .select(`
        public_code,
        access_role,
        status,
        patient_assignments!inner(
          *,
          primary_expert:primary_expert_id(id, name),
          organization:organization_id(id, name)
        )
      `)
      .eq("expert_id", expertId)
      .eq("status", "active");

    if (err1 || err2) {
      return res.status(500).json({ ok: false, error: "Ошибка загрузки пациентов" });
    }

    // Merge: accessed patients that might overlap with assigned
    const seenCodes = new Set();
    const patients = [];

    for (const p of assigned || []) {
      seenCodes.add(p.public_code);
      patients.push(p);
    }
    for (const a of accessed || []) {
      if (!seenCodes.has(a.public_code)) {
        const pa = a.patient_assignments;
        if (pa) {
          patients.push({
            ...pa,
            access_role: a.access_role,
            _access_via: "patient_access",
          });
          seenCodes.add(a.public_code);
        }
      } else {
        // Add access_role to existing
        const existing = patients.find((p) => p.public_code === a.public_code);
        if (existing) {
          existing.access_role = a.access_role;
        }
      }
    }

    // Enrich with session info
    const enriched = await enrichPatientsWithSessionData(supabase, patients);
    return res.status(200).json({ ok: true, patients: enriched });
  } else if (orgId && isAdmin) {
    query = query.eq("organization_id", orgId);
  } else {
    return res.status(403).json({ ok: false, error: "Доступ запрещён" });
  }

  const { data: patientsData, error } = await query;
  if (error) {
    return res.status(500).json({ ok: false, error: "Ошибка загрузки пациентов" });
  }

  const enriched = await enrichPatientsWithSessionData(supabase, patientsData || []);
  return res.status(200).json({ ok: true, patients: enriched });
}

async function enrichPatientsWithSessionData(supabase, patients) {
  if (patients.length === 0) return [];

  const codes = patients.map((p) => p.public_code);
  const { data: sessions } = await supabase
    .from("sessions")
    .select("public_code, risk_level, json_data, created_at")
    .in("public_code", codes)
    .order("created_at", { ascending: false });

  const sessionMap = {};
  for (const s of sessions || []) {
    if (!sessionMap[s.public_code]) {
      sessionMap[s.public_code] = [];
    }
    sessionMap[s.public_code].push(s);
  }

  return patients.map((p) => {
    const patientSessions = sessionMap[p.public_code] || [];
    const lastSession = patientSessions[0] || null;
    return {
      ...p,
      session_count: patientSessions.length,
      last_session_at: lastSession?.created_at || null,
      last_risk_level: lastSession?.risk_level || null,
      last_care_recommendation: lastSession?.json_data?.care_recommendation || null,
    };
  });
}

async function handleAssignPatientToExpert(req, res) {
  const { public_code, expert_id, organization_id, source, patient_label, admin_secret, expert_code, assigned_by_expert_name } = req.body || {};
  const isAdmin = authorizeAdmin(req);

  if (!public_code) {
    return res.status(400).json({ ok: false, error: "Укажите public_code" });
  }

  const normalizedCode = public_code.trim().toUpperCase();
  const supabase = getSupabase();

  // Determine who is assigning
  let assignerExpertId = null;
  let assignerName = null;

  if (isAdmin) {
    assignerExpertId = expert_id || null;
    assignerName = assigned_by_expert_name || "Admin";
  } else if (expert_code) {
    const trimmed = expert_code.trim().toUpperCase();
    const { data: expert } = await supabase
      .from("experts")
      .select("id, name")
      .eq("access_code", trimmed)
      .eq("is_active", true)
      .maybeSingle();
    if (!expert) {
      return res.status(403).json({ ok: false, error: "Специалист не найден" });
    }
    assignerExpertId = expert.id;
    assignerName = expert.name;
  } else {
    return res.status(403).json({ ok: false, error: "Доступ запрещён" });
  }

  // Find target expert
  const targetExpertId = isAdmin ? (expert_id || assignerExpertId) : assignerExpertId;
  if (!targetExpertId) {
    return res.status(400).json({ ok: false, error: "Не указан специалист для назначения" });
  }

  // Get target expert info
  const { data: targetExpert } = await supabase
    .from("experts")
    .select("id, name")
    .eq("id", targetExpertId)
    .maybeSingle();
  if (!targetExpert) {
    return res.status(404).json({ ok: false, error: "Целевой специалист не найден" });
  }

  // Find or determine organization
  let orgId = organization_id || null;
  if (!orgId) {
    const membership = await getExpertMembership(targetExpertId);
    orgId = membership?.organization_id || null;
  }

  // Check if there's already a patient_assignment for this code
  const { data: existingAssignment } = await supabase
    .from("patient_assignments")
    .select("id, primary_expert_id, organization_id, status")
    .eq("public_code", normalizedCode)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingAssignment) {
    if (existingAssignment.status === "active" && existingAssignment.primary_expert_id === targetExpertId && existingAssignment.organization_id === orgId) {
      return res.status(409).json({ ok: false, error: "Пациент уже назначен этому специалисту" });
    }
    // Update existing
    const { error: updErr } = await supabase
      .from("patient_assignments")
      .update({
        primary_expert_id: targetExpertId,
        organization_id: orgId,
        assigned_by_expert_id: assignerExpertId,
        assigned_by_expert_name: assignerName,
        source: source || "manual",
        status: "active",
        patient_label: patient_label?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingAssignment.id);

    if (updErr) {
      return res.status(500).json({ ok: false, error: "Ошибка обновления назначения" });
    }
  } else {
    // Create new
    const { error: insErr } = await supabase
      .from("patient_assignments")
      .insert({
        public_code: normalizedCode,
        organization_id: orgId,
        primary_expert_id: targetExpertId,
        assigned_by_expert_id: assignerExpertId,
        assigned_by_expert_name: assignerName,
        source: source || "manual",
        status: "active",
        patient_label: patient_label?.trim() || null,
      });

    if (insErr) {
      return res.status(500).json({ ok: false, error: "Ошибка назначения пациента" });
    }
  }

  // Ensure patient_access exists for the target expert
  const { data: existingAccess } = await supabase
    .from("patient_access")
    .select("id")
    .eq("public_code", normalizedCode)
    .eq("organization_id", orgId)
    .eq("expert_id", targetExpertId)
    .maybeSingle();

  if (!existingAccess) {
    await supabase
      .from("patient_access")
      .insert({
        public_code: normalizedCode,
        organization_id: orgId,
        expert_id: targetExpertId,
        access_role: "owner",
        granted_by_expert_id: assignerExpertId,
        granted_by_expert_name: assignerName,
      })
      .then(() => {});
  }

  // Update existing sessions/reviews with org and expert
  await supabase
    .from("sessions")
    .update({ organization_id: orgId, primary_expert_id: targetExpertId })
    .eq("public_code", normalizedCode)
    .is("organization_id", null)
    .then(() => {});

  await supabase
    .from("case_reviews")
    .update({ organization_id: orgId, primary_expert_id: targetExpertId })
    .eq("public_code", normalizedCode)
    .is("organization_id", null)
    .then(() => {});

  return res.status(200).json({ ok: true, message: "Пациент назначен специалисту" });
}

// ═══════════════════════════════════════════════════════════
// LIST ALL EXPERTS (for admin UI dropdowns)
// ═══════════════════════════════════════════════════════════

async function handleListAllExperts(req, res) {
  if (!authorizeAdmin(req)) {
    return res.status(403).json({ ok: false, error: "Только администратор" });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("experts")
    .select("id, name, role, specialty, city, organization, access_code, is_active")
    .order("name", { ascending: true });

  if (error) {
    return res.status(500).json({ ok: false, error: "Ошибка загрузки специалистов" });
  }

  return res.status(200).json({ ok: true, experts: data || [] });
}

// ═══════════════════════════════════════════════════════════
// CHECK INVITE TOKEN (used by session.js too)
// ═══════════════════════════════════════════════════════════

async function handleCheckInviteToken(req, res) {
  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ ok: false, error: "Укажите token" });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("doctor_invite_links")
    .select(`
      id, token, organization_id, expert_id, status, max_uses, used_count, expires_at,
      organizations(name),
      experts(id, name)
    `)
    .eq("token", token)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ ok: false, error: "Ошибка проверки токена" });
  }

  if (!data) {
    return res.status(200).json({ ok: false, valid: false, error: "Ссылка недействительна" });
  }

  if (data.status !== "active") {
    return res.status(200).json({ ok: false, valid: false, error: "Ссылка отключена" });
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return res.status(200).json({ ok: false, valid: false, error: "Срок действия ссылки истёк" });
  }

  if (data.max_uses && data.used_count >= data.max_uses) {
    return res.status(200).json({ ok: false, valid: false, error: "Ссылка использована максимальное количество раз" });
  }

  return res.status(200).json({
    ok: true,
    valid: true,
    invite: {
      id: data.id,
      token: data.token,
      organization_id: data.organization_id,
      organization_name: data.organizations?.name || null,
      expert_id: data.expert_id,
      expert_name: data.experts?.name || null,
    },
  });
}

// Export for use by other modules
export async function validateInviteToken(token) {
  if (!token) return null;
  const supabase = getSupabase();
  const { data } = await supabase
    .from("doctor_invite_links")
    .select("id, organization_id, expert_id, status, max_uses, used_count, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!data) return null;
  if (data.status !== "active") return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  if (data.max_uses && data.used_count >= data.max_uses) return null;

  return data;
}

export async function useInviteToken(token) {
  if (!token) return null;
  const supabase = getSupabase();
  const { data: current } = await supabase
    .from("doctor_invite_links")
    .select("id, organization_id, expert_id, used_count")
    .eq("token", token)
    .single();
  if (!current) return null;
  const { data } = await supabase
    .from("doctor_invite_links")
    .update({ used_count: (current.used_count || 0) + 1 })
    .eq("id", current.id)
    .select("id, organization_id, expert_id")
    .single();
  return data;
}
