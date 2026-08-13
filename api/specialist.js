import crypto from "node:crypto";
import { getSupabase } from "../lib/supabase.js";
import { applyCors, handleOptions } from "../lib/security/cors.js";
import { rateLimit } from "../lib/security/rate-limit.js";
import { hashToken } from "../lib/security/council-token.js";

// ── Constants ─────────────────────────────────────────────

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const TOKEN_BYTES = 32; // 256-bit token
const GENERIC_AUTH_ERROR = "Неверный код специалиста";
const COOKIE_NAME = "tochka_specialist_session";
const COOKIE_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000); // seconds
const COOKIE_PATH = "/api/specialist";

// ── Allowed origins for cookie-authenticated requests ─────

const ALLOWED_ORIGINS = [
  "https://tochka-opori.online",
  "https://www.tochka-opori.online",
  "https://health.tochka-opori.online",
];

function isLocalhostOrigin(origin) {
  try {
    const u = new URL(origin);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch { return false; }
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (isLocalhostOrigin(origin)) return true;
  return false;
}

// LOGIN: always require a valid Origin — missing Origin must not be accepted.
function requireOrigin(req, res) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) return true;
  res.status(403).json({ ok: false, error: "Origin not allowed" });
  return false;
}

// LOGOUT: require Origin only when authenticating via cookie.
// Bearer-only API/testing clients without a cookie may proceed without Origin.
function assertCookieOrigin(req, res) {
  const cookies = parseCookies(req);
  const hasCookie = !!cookies[COOKIE_NAME];
  if (!hasCookie) return true; // Bearer-only path — no cookie to protect
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) return true;
  res.status(403).json({ ok: false, error: "Origin not allowed" });
  return false;
}

// ── Cookie helpers ────────────────────────────────────────

function isProduction() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

function buildCookie(name, value, maxAge) {
  const parts = [
    `${name}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    `Path=${COOKIE_PATH}`,
    `Max-Age=${maxAge}`,
  ];
  if (isProduction()) parts.push("Secure");
  return parts.join("; ");
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const cookies = {};
  for (const pair of header.split(";")) {
    const [key, ...rest] = pair.split("=");
    const name = key?.trim();
    if (name) cookies[name] = rest.join("=").trim();
  }
  return cookies;
}

// ── Rate limiters ─────────────────────────────────────────

// Strict login brute-force protection: 10 attempts / 15 min per IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  prefix: "specialist_login:",
  message: "Слишком много попыток. Попробуйте позже.",
});

// ── Handler ───────────────────────────────────────────────

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { action } = req.body || {};

  try {
    switch (action) {
      case "login":
        return await handleLogin(req, res);
      case "me":
        return await handleMe(req, res);
      case "logout":
        return await handleLogout(req, res);
      case "listClients":
        return await handleListClients(req, res);
      case "getClientOverview":
        return await handleGetClientOverview(req, res);
      case "getClientProfessionalAnalysis":
        return await handleGetClientProfessionalAnalysis(req, res);
      case "getBodyClientOverview":
        return await handleGetBodyClientOverview(req, res);
      default:
        return res.status(400).json({ ok: false, error: "Unknown action" });
    }
  } catch (error) {
    console.error("[specialist] error:", error);
    return res.status(500).json({ ok: false, error: "Внутренняя ошибка сервера" });
  }
}

// ── LOGIN ─────────────────────────────────────────────────

async function handleLogin(req, res) {
  // Login always requires a valid Origin — missing Origin must not be accepted
  if (!requireOrigin(req, res)) return;

  const limited = await loginLimiter(req, res);
  if (limited) return;

  const { access_code } = req.body || {};

  if (!access_code || typeof access_code !== "string") {
    return res.status(401).json({ ok: false, error: GENERIC_AUTH_ERROR });
  }

  const trimmed = access_code.trim().toUpperCase();
  if (trimmed.length < 5) {
    return res.status(401).json({ ok: false, error: GENERIC_AUTH_ERROR });
  }

  const supabase = getSupabase();

  // Find active expert by access_code
  const { data: expert, error: expertError } = await supabase
    .from("experts")
    .select("id, name, role, specialty, city, is_active")
    .eq("access_code", trimmed)
    .maybeSingle();

  if (expertError) {
    console.error("[specialist:login] expert lookup error:", expertError);
    return res.status(500).json({ ok: false, error: "Ошибка сервера" });
  }

  // Generic error — do not reveal whether code exists
  if (!expert || !expert.is_active) {
    return res.status(401).json({ ok: false, error: GENERIC_AUTH_ERROR });
  }

  // Generate opaque token
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(rawToken);

  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  // Store hashed token
  const { error: insertError } = await supabase
    .from("specialist_sessions")
    .insert({
      expert_id: expert.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      metadata: {
        ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null,
        user_agent: req.headers["user-agent"] || null,
      },
    });

  if (insertError) {
    console.error("[specialist:login] session insert error:", insertError);
    return res.status(500).json({ ok: false, error: "Ошибка сервера" });
  }

  // Fetch all active memberships
  const { data: memberships } = await supabase
    .from("expert_organization_memberships")
    .select("id, organization_id, role, status, organizations(name, slug, type)")
    .eq("expert_id", expert.id)
    .eq("status", "active");

  const membershipsList = (memberships || []).map((m) => ({
    membership_id: m.id,
    organization_id: m.organization_id,
    organization_name: m.organizations?.name || null,
    organization_slug: m.organizations?.slug || null,
    organization_type: m.organizations?.type || null,
    role_in_organization: m.role,
  }));

  // Set HttpOnly cookie — raw token never exposed to JavaScript
  res.setHeader("Set-Cookie", buildCookie(COOKIE_NAME, rawToken, COOKIE_MAX_AGE));

  return res.status(200).json({
    ok: true,
    expires_at: expiresAt,
    expert: {
      id: expert.id,
      name: expert.name,
      role: expert.role,
      specialty: expert.specialty,
      city: expert.city,
    },
    memberships: membershipsList,
  });
}

// ── ME ────────────────────────────────────────────────────

async function handleMe(req, res) {
  const authResult = await authorizeSpecialist(req);
  if (authResult.error) {
    return res.status(authResult.status).json({ ok: false, error: authResult.error });
  }

  const { expert, memberships } = authResult;

  return res.status(200).json({
    ok: true,
    expert: {
      id: expert.id,
      name: expert.name,
      role: expert.role,
      specialty: expert.specialty,
      city: expert.city,
    },
    memberships,
    requires_context_selection: memberships.length > 1,
  });
}

// ── LOGOUT ────────────────────────────────────────────────

async function handleLogout(req, res) {
  // Logout requires Origin only when using cookie auth; Bearer-only may skip
  if (!assertCookieOrigin(req, res)) return;

  const authResult = await authorizeSpecialist(req);

  // Clear cookie regardless of auth result
  res.setHeader("Set-Cookie", buildCookie(COOKIE_NAME, "", 0));

  if (authResult.error) {
    // Even if session was already invalid, cookie is cleared — treat as success
    return res.status(200).json({ ok: true, message: "Выход выполнен" });
  }

  const supabase = getSupabase();

  // Revoke the current session
  const { error } = await supabase
    .from("specialist_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", authResult.tokenHash)
    .is("revoked_at", null);

  if (error) {
    console.error("[specialist:logout] revoke error:", error);
    // Cookie already cleared — still report success to client
  }

  return res.status(200).json({ ok: true, message: "Выход выполнен" });
}

// ── LIST CLIENTS ──────────────────────────────────────────

async function handleListClients(req, res) {
  const authResult = await authorizeSpecialist(req);
  if (authResult.error) {
    return res.status(authResult.status).json({ ok: false, error: authResult.error });
  }

  const { expert, memberships } = authResult;
  const { organization_id: orgId, module } = req.body || {};

  // Validate working context
  const ctx = validateSpecialistContext({ memberships, organizationId: orgId, module });
  if (!ctx.ok) {
    return res.status(400).json({ ok: false, error: ctx.error });
  }

  const supabase = getSupabase();
  const clients = new Map(); // key → client registry item

  // ── 1. Primary assignments ──────────────────────────────
  let assignQuery = supabase
    .from("patient_assignments")
    .select("id, public_code, owner_type, owner_id, organization_id, primary_expert_id, status, module, patient_label, updated_at")
    .eq("primary_expert_id", expert.id)
    .eq("module", module)
    .eq("status", "active");

  // organization_id: NULL means private practice — use .is() for NULL
  if (orgId === null) {
    assignQuery = assignQuery.is("organization_id", null);
  } else {
    assignQuery = assignQuery.eq("organization_id", orgId);
  }

  const { data: assignments } = await assignQuery;

  for (const a of assignments || []) {
    const key = module === "body"
      ? `body:${a.owner_type}:${a.owner_id}`
      : `support:${a.public_code}`;
    clients.set(key, {
      client_ref: `assignment:${a.id}`,
      module,
      _publicCode: a.public_code,
      _ownerType: a.owner_type,
      _ownerId: a.owner_id,
      relationship: "primary",
      access_role: "owner",
      status: a.status,
      last_activity_at: a.updated_at,
      _patientLabel: a.patient_label,
    });
  }

  // ── 2. Shared access ────────────────────────────────────
  let accessQuery = supabase
    .from("patient_access")
    .select("id, public_code, owner_type, owner_id, organization_id, expert_id, access_role, status, module")
    .eq("expert_id", expert.id)
    .eq("module", module)
    .eq("status", "active");

  if (orgId === null) {
    accessQuery = accessQuery.is("organization_id", null);
  } else {
    accessQuery = accessQuery.eq("organization_id", orgId);
  }

  const { data: accessRows } = await accessQuery;

  for (const acc of accessRows || []) {
    const key = module === "body"
      ? `body:${acc.owner_type}:${acc.owner_id}`
      : `support:${acc.public_code}`;
    if (!clients.has(key)) {
      clients.set(key, {
        client_ref: `access:${acc.id}`,
        module,
        _publicCode: acc.public_code,
        _ownerType: acc.owner_type,
        _ownerId: acc.owner_id,
        relationship: "shared",
        access_role: acc.access_role,
        status: acc.status,
        last_activity_at: null,
        _patientLabel: null,
      });
    }
  }

  // ── 3. Resolve display names (batch) ────────────────────
  // Support: only patient_label (explicit non-clinical pseudonym).
  // Body: body_clients.display_name (user-provided, non-clinical).
  // Never read session text, AI content, clinical data.

  // Batch-fetch all body_clients display names for authorized owner IDs
  const bodyOwnerIds = [...clients.values()]
    .filter((c) => c._ownerId)
    .map((c) => c._ownerId);
  const bodyDisplayNames = new Map(); // owner_id → display_name
  if (bodyOwnerIds.length > 0) {
    const { data: bcRows } = await supabase
      .from("body_clients")
      .select("anonymous_owner_id, display_name, created_at")
      .in("anonymous_owner_id", bodyOwnerIds)
      .order("created_at", { ascending: false });
    // Pick the first (most recent) row per owner_id
    for (const bc of bcRows || []) {
      if (!bodyDisplayNames.has(bc.anonymous_owner_id) && bc.display_name) {
        bodyDisplayNames.set(bc.anonymous_owner_id, bc.display_name);
      }
    }
  }

  const result = [];
  for (const c of clients.values()) {
    let display_name = "Клиент без имени";

    if (module === "support" && c._patientLabel) {
      display_name = c._patientLabel;
    } else if (module === "body" && c._ownerId) {
      const name = bodyDisplayNames.get(c._ownerId);
      if (name) display_name = name;
    }

    result.push({
      client_ref: c.client_ref,
      module: c.module,
      display_name,
      relationship: c.relationship,
      access_role: c.access_role,
      status: c.status,
      last_activity_at: c.last_activity_at,
    });
  }

  return res.status(200).json({ ok: true, clients: result });
}

// ── CLIENT REF RESOLUTION ─────────────────────────────────

async function resolveAuthorizedSpecialistClient({ expert, memberships, clientRef, organizationId, module }) {
  const supabase = getSupabase();
  let publicCode = null;
  let ownerType = null;
  let ownerId = null;
  let relationship = null;
  let accessRole = null;

  if (clientRef.startsWith("assignment:")) {
    const assignmentId = clientRef.slice("assignment:".length);
    const { data: assignment } = await supabase
      .from("patient_assignments")
      .select("id, public_code, owner_type, owner_id, status, module, organization_id, primary_expert_id")
      .eq("id", assignmentId)
      .maybeSingle();

    if (!assignment || assignment.status !== "active") {
      return { ok: false, error: "Назначение не найдено или неактивно", status: 404 };
    }
    if (assignment.module !== module) {
      return { ok: false, error: "Несоответствие модуля", status: 403 };
    }
    // Organization context must match exactly
    if (organizationId === null) {
      if (assignment.organization_id !== null) {
        return { ok: false, error: "Несоответствие контекста организации", status: 403 };
      }
    } else {
      if (assignment.organization_id !== organizationId) {
        return { ok: false, error: "Несоответствие контекста организации", status: 403 };
      }
    }
    if (assignment.primary_expert_id !== expert.id) {
      return { ok: false, error: "Доступ запрещён", status: 403 };
    }
    // Body module requires anonymous_profile owner
    if (module === "body") {
      if (assignment.owner_type !== "anonymous_profile" || !assignment.owner_id) {
        return { ok: false, error: "Некорректный владелец", status: 403 };
      }
      ownerType = assignment.owner_type;
      ownerId = assignment.owner_id;
    } else {
      publicCode = assignment.public_code;
    }
    relationship = "primary";
    accessRole = "owner";
  } else if (clientRef.startsWith("access:")) {
    const accessId = clientRef.slice("access:".length);
    const { data: accessRow } = await supabase
      .from("patient_access")
      .select("id, public_code, owner_type, owner_id, status, module, organization_id, expert_id, access_role")
      .eq("id", accessId)
      .maybeSingle();

    if (!accessRow || accessRow.status !== "active") {
      return { ok: false, error: "Доступ не найден или неактивен", status: 404 };
    }
    if (accessRow.module !== module) {
      return { ok: false, error: "Несоответствие модуля", status: 403 };
    }
    if (organizationId === null) {
      if (accessRow.organization_id !== null) {
        return { ok: false, error: "Несоответствие контекста организации", status: 403 };
      }
    } else {
      if (accessRow.organization_id !== organizationId) {
        return { ok: false, error: "Несоответствие контекста организации", status: 403 };
      }
    }
    if (accessRow.expert_id !== expert.id) {
      return { ok: false, error: "Доступ запрещён", status: 403 };
    }
    // Body module requires anonymous_profile owner
    if (module === "body") {
      if (accessRow.owner_type !== "anonymous_profile" || !accessRow.owner_id) {
        return { ok: false, error: "Некорректный владелец", status: 403 };
      }
      ownerType = accessRow.owner_type;
      ownerId = accessRow.owner_id;
    } else {
      publicCode = accessRow.public_code;
    }
    relationship = "shared";
    accessRole = accessRow.access_role;
  } else {
    return { ok: false, error: "Некорректный client_ref", status: 400 };
  }

  return { ok: true, publicCode, ownerType, ownerId, relationship, accessRole };
}

// ── GET CLIENT OVERVIEW ───────────────────────────────────

async function handleGetClientOverview(req, res) {
  const authResult = await authorizeSpecialist(req);
  if (authResult.error) {
    return res.status(authResult.status).json({ ok: false, error: authResult.error });
  }

  const { expert, memberships } = authResult;
  const { client_ref, organization_id: orgId, module } = req.body || {};

  if (!client_ref) {
    return res.status(400).json({ ok: false, error: "Укажите client_ref" });
  }

  // Body module has its own endpoint
  if (module === "body") {
    return res.status(400).json({ ok: false, error: "Используйте getBodyClientOverview" });
  }

  // Validate context
  const ctx = validateSpecialistContext({ memberships, organizationId: orgId, module });
  if (!ctx.ok) {
    return res.status(400).json({ ok: false, error: ctx.error });
  }

  // Resolve and authorize client
  const resolved = await resolveAuthorizedSpecialistClient({ expert, memberships, clientRef: client_ref, organizationId: orgId, module });
  if (!resolved.ok) {
    return res.status(resolved.status || 403).json({ ok: false, error: resolved.error });
  }

  const { publicCode, relationship, accessRole } = resolved;
  const supabase = getSupabase();

  // Resolve display name from assignment (no N+1 — single query)
  let display_name = "Клиент без имени";
  const { data: assignmentLabel } = await supabase
    .from("patient_assignments")
    .select("patient_label")
    .eq("public_code", publicCode)
    .eq("module", "support")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (assignmentLabel?.patient_label) {
    display_name = assignmentLabel.patient_label;
  }

  // Find the anonymous_owner_id from the session with this public_code
  const { data: ownerSession } = await supabase
    .from("sessions")
    .select("anonymous_owner_id")
    .eq("public_code", publicCode)
    .eq("module", "support")
    .limit(1)
    .maybeSingle();

  // Query ALL sessions for this owner (supports follow-up sessions with different public_codes)
  const ownerId = ownerSession?.anonymous_owner_id;
  const { data: sessions } = ownerId
    ? await supabase
        .from("sessions")
        .select("id, created_at, updated_at, care_recommendation, doctor_report, report_generation_status")
        .eq("anonymous_owner_id", ownerId)
        .eq("module", "support")
        .order("created_at", { ascending: false })
    : { data: [] };

  // Zero sessions is valid — return empty card
  const sessionList = (sessions || []).map((s) => {
    const careRec = s.care_recommendation;
    const raw = s.doctor_report || "";
    const clean = raw.replace(/\s+/g, " ").trim();
    const summary = clean.length > 200 ? clean.slice(0, 197) + "..." : clean || null;
    return {
      session_ref: `support-session:${s.id}`,
      started_at: s.created_at,
      updated_at: s.updated_at,
      status: s.report_generation_status || "unknown",
      short_summary: summary,
      safety_level: careRec?.level || null,
    };
  });

  // Safety: overview reflects LATEST session (or null if no sessions)
  const latestSession = sessions?.[0] || null;
  const latestCareRec = latestSession?.care_recommendation || null;
  const safetyLevel = latestCareRec?.level || null;
  const hasActiveFlags = ["urgent_help", "professional_contact", "medical_consultation"].includes(safetyLevel);

  return res.status(200).json({
    ok: true,
    client: {
      client_ref,
      display_name,
      relationship,
      access_role: accessRole,
    },
    overview: {
      first_activity_at: sessions?.length > 0 ? sessions[sessions.length - 1].created_at : null,
      last_activity_at: latestSession?.created_at || null,
      session_count: sessions?.length || 0,
      latest_session_at: latestSession?.created_at || null,
      safety: {
        level: safetyLevel,
        has_active_flags: hasActiveFlags,
        reasons: latestCareRec?.reasons || [],
      },
    },
    sessions: sessionList,
  });
}

// ── GET CLIENT PROFESSIONAL ANALYSIS ──────────────────────

async function handleGetClientProfessionalAnalysis(req, res) {
  const authResult = await authorizeSpecialist(req);
  if (authResult.error) {
    return res.status(authResult.status).json({ ok: false, error: authResult.error });
  }

  const { expert, memberships } = authResult;
  const { client_ref, organization_id: orgId, module } = req.body || {};

  if (!client_ref) {
    return res.status(400).json({ ok: false, error: "Укажите client_ref" });
  }

  if (module !== "support") {
    return res.status(400).json({ ok: false, error: "Модуль пока не поддерживается" });
  }

  const ctx = validateSpecialistContext({ memberships, organizationId: orgId, module });
  if (!ctx.ok) {
    return res.status(400).json({ ok: false, error: ctx.error });
  }

  const resolved = await resolveAuthorizedSpecialistClient({ expert, memberships, clientRef: client_ref, organizationId: orgId, module });
  if (!resolved.ok) {
    return res.status(resolved.status || 403).json({ ok: false, error: resolved.error });
  }

  const { publicCode } = resolved;
  const supabase = getSupabase();

  // Find owner from public_code
  const { data: ownerSession } = await supabase
    .from("sessions")
    .select("anonymous_owner_id")
    .eq("public_code", publicCode)
    .eq("module", "support")
    .limit(1)
    .maybeSingle();

  const ownerId = ownerSession?.anonymous_owner_id;
  if (!ownerId) {
    return res.status(200).json({ ok: true, latest_analysis: null, dynamics: { session_count: 0, points: [] }, voice_observations: [] });
  }

  // Query sessions — professional fields only, voice observations via JSON path projection
  // Do NOT fetch full json_data; only extract the voiceObservations subtree.
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, created_at, care_recommendation, doctor_report, report_generation_status, voiceObs:json_data->>voiceObservations")
    .eq("anonymous_owner_id", ownerId)
    .eq("module", "support")
    .order("created_at", { ascending: false });

  if (!sessions || sessions.length === 0) {
    return res.status(200).json({ ok: true, latest_analysis: null, dynamics: { session_count: 0, points: [] }, voice_observations: [] });
  }

  // Build dynamics timeline (all sessions, chronological)
  const dynamicsPoints = sessions.map((s) => {
    const careRec = s.care_recommendation;
    const raw = s.doctor_report || "";
    const clean = raw.replace(/\s+/g, " ").trim();
    const summary = clean.length > 150 ? clean.slice(0, 147) + "..." : clean || null;
    return {
      session_ref: `support-session:${s.id}`,
      date: s.created_at,
      safety_level: careRec?.level || null,
      summary,
      status: s.report_generation_status || "unknown",
    };
  }).reverse(); // chronological order

  // Latest session = most recent
  const latest = sessions[0];
  const latestCareRec = latest.care_recommendation;
  const latestReport = latest.doctor_report || "";
  const latestStatus = latest.report_generation_status;

  // Extract voice observations from json_data (batch — all sessions)
  // Voice observations — whitelist only approved professional fields
  const VOICE_FIELD_WHITELIST = ["tempo", "pauses", "volume", "prosody", "tension", "stability"];
  const voiceObs = [];
  for (const s of sessions) {
    // voiceObs is the projected json_data->>voiceObservations (JSON string or null)
    let vo = null;
    try { vo = typeof s.voiceObs === "string" ? JSON.parse(s.voiceObs) : s.voiceObs; } catch {}
    if (vo && vo.status === "completed" && vo.speech_features) {
      const features = {};
      for (const field of VOICE_FIELD_WHITELIST) {
        features[field] = vo.speech_features[field]?.value || null;
      }
      voiceObs.push({
        session_ref: `support-session:${s.id}`,
        date: s.created_at,
        ...features,
        summary: vo.summary || null,
      });
    }
  }

  // Build latest analysis
  const latestAnalysis = {
    session_ref: `support-session:${latest.id}`,
    date: latest.created_at,
    status: latestStatus,
    doctor_report: latestReport || null,
    care_recommendation: latestCareRec || null,
    safety: {
      level: latestCareRec?.level || null,
      reasons: latestCareRec?.reasons || [],
    },
  };

  return res.status(200).json({
    ok: true,
    latest_analysis: latestAnalysis,
    dynamics: {
      session_count: sessions.length,
      points: dynamicsPoints,
    },
    voice_observations: voiceObs,
  });
}

// ── GET BODY CLIENT OVERVIEW ──────────────────────────────

async function handleGetBodyClientOverview(req, res) {
  const authResult = await authorizeSpecialist(req);
  if (authResult.error) {
    return res.status(authResult.status).json({ ok: false, error: authResult.error });
  }

  const { expert, memberships } = authResult;
  const { client_ref, organization_id: orgId, module } = req.body || {};

  if (!client_ref) {
    return res.status(400).json({ ok: false, error: "Укажите client_ref" });
  }
  if (module !== "body") {
    return res.status(400).json({ ok: false, error: "Некорректный модуль" });
  }

  const ctx = validateSpecialistContext({ memberships, organizationId: orgId, module });
  if (!ctx.ok) {
    return res.status(400).json({ ok: false, error: ctx.error });
  }

  const resolved = await resolveAuthorizedSpecialistClient({ expert, memberships, clientRef: client_ref, organizationId: orgId, module });
  if (!resolved.ok) {
    return res.status(resolved.status || 403).json({ ok: false, error: resolved.error });
  }

  const { ownerType, ownerId, relationship, accessRole } = resolved;
  if (!ownerId) {
    return res.status(403).json({ ok: false, error: "Владелец не определён" });
  }

  const supabase = getSupabase();

  // ── Batch 1: body_clients for this owner ───────────────
  const { data: bcRows } = await supabase
    .from("body_clients")
    .select("id, session_id, display_name, goal, status, created_at")
    .eq("anonymous_owner_id", ownerId)
    .order("created_at", { ascending: false });

  const bodyClient = bcRows?.[0] || null;
  const sessionIds = (bcRows || []).map((r) => r.session_id).filter(Boolean);

  // ── Batch 2: recent daily logs (30 days, authorized sessions only) ──
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sinceDate = thirtyDaysAgo.toISOString().slice(0, 10);

  let dailyLogs = [];
  if (sessionIds.length > 0) {
    const { data: logs } = await supabase
      .from("body_daily_logs")
      .select("log_date, weight_kg, waist_cm, steps, sleep_hours, sleep_quality, mood_level, energy_level, workout_done, workout_type, workout_minutes, meals_count, calories, water_l, ai_day_summary, ai_positive_observation, created_at")
      .in("session_id", sessionIds)
      .gte("log_date", sinceDate)
      .order("log_date", { ascending: false });
    dailyLogs = logs || [];
  }

  // Deduplicate by date (keep most recent per date)
  const seenDates = new Set();
  const dedupedLogs = [];
  for (const log of dailyLogs) {
    if (!seenDates.has(log.log_date)) {
      seenDates.add(log.log_date);
      dedupedLogs.push(log);
    }
  }

  // ── Batch 3: plate history (owner_id direct) ──────────
  const { data: plateRows } = await supabase
    .from("body_plate_history")
    .select("log_date, meal_type, balance_summary, vegetables_assessment, protein_assessment, carbohydrate_assessment, gentle_suggestion, confidence")
    .eq("owner_id", ownerId)
    .gte("log_date", sinceDate)
    .order("log_date", { ascending: false });

  // ── Batch 4: weekly summaries (owner_id direct) ───────
  // JSON-path projection: fetch only approved keys from summary_json, not the full blob.
  const { data: weeklyRows } = await supabase
    .from("body_weekly_summaries")
    .select("period_start, period_end, user_summary, source_days, source_plate_count, positive_changes:summary_json->positive_changes, patterns:summary_json->patterns, nutrition_observations:summary_json->nutrition_observations, activity_observations:summary_json->activity_observations, sleep_observations:summary_json->sleep_observations, next_week_focus:summary_json->next_week_focus, questions_for_specialist:summary_json->questions_for_specialist")
    .eq("owner_id", ownerId)
    .eq("summary_type", "weekly")
    .order("period_start", { ascending: false })
    .limit(5);

  // ── Batch 5: active insights (owner_id direct) ────────
  const { data: insightRows } = await supabase
    .from("body_insights")
    .select("insight_type, title, insight_text, priority, insight_date")
    .eq("owner_id", ownerId)
    .eq("status", "active")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(5);

  // ── Batch 6: service requests (owner_id direct) ───────
  const { data: srRows } = await supabase
    .from("service_requests")
    .select("id, request_type, status, created_at, due_at, scheduled_at")
    .eq("owner_id", ownerId)
    .eq("module", "body")
    .order("created_at", { ascending: false })
    .limit(10);

  // ── Compute overview stats ─────────────────────────────
  const latestLog = dedupedLogs[0] || null;
  const firstLog = dedupedLogs.length > 0 ? dedupedLogs[dedupedLogs.length - 1] : null;
  const activeRequestCount = (srRows || []).filter((r) => ["submitted", "accepted", "needs_clarification", "scheduled"].includes(r.status)).length;

  // ── Build response (no owner_id, no session_id, no secrets) ──

  return res.status(200).json({
    ok: true,
    client: {
      client_ref,
      module: "body",
      display_name: bodyClient?.display_name || "Клиент без имени",
      relationship,
      access_role: accessRole,
    },
    overview: {
      goal: bodyClient?.goal || null,
      status: bodyClient?.status || null,
      first_activity_at: firstLog?.created_at || bodyClient?.created_at || null,
      last_activity_at: latestLog?.created_at || null,
      diary_days: dedupedLogs.length,
      latest_weight_kg: latestLog?.weight_kg || null,
      latest_steps: latestLog?.steps || null,
      latest_sleep_hours: latestLog?.sleep_hours || null,
      latest_mood_level: latestLog?.mood_level || null,
      latest_energy_level: latestLog?.energy_level || null,
      active_request_count: activeRequestCount,
    },
    recent_days: dedupedLogs.map((l) => ({
      log_date: l.log_date,
      weight_kg: l.weight_kg,
      waist_cm: l.waist_cm,
      steps: l.steps,
      sleep_hours: l.sleep_hours,
      sleep_quality: l.sleep_quality,
      mood_level: l.mood_level,
      energy_level: l.energy_level,
      workout_done: l.workout_done,
      workout_type: l.workout_type,
      workout_minutes: l.workout_minutes,
      meals_count: l.meals_count,
      calories: l.calories,
      water_l: l.water_l,
      ai_day_summary: l.ai_day_summary || null,
      ai_positive_observation: l.ai_positive_observation || null,
    })),
    plate_summary: {
      total_plates: (plateRows || []).length,
      recent_plates: (plateRows || []).slice(0, 20).map((p) => ({
        log_date: p.log_date,
        meal_type: p.meal_type,
        balance_summary: p.balance_summary || null,
        vegetables_assessment: p.vegetables_assessment || null,
        protein_assessment: p.protein_assessment || null,
        carbohydrate_assessment: p.carbohydrate_assessment || null,
        gentle_suggestion: p.gentle_suggestion || null,
      })),
    },
    weekly_summaries: (weeklyRows || []).map((w) => ({
      period_start: w.period_start,
      period_end: w.period_end,
      user_summary: w.user_summary || null,
      source_days: w.source_days,
      source_plate_count: w.source_plate_count,
      positive_changes: w.positive_changes || [],
      patterns: w.patterns || [],
      nutrition_observations: w.nutrition_observations || [],
      activity_observations: w.activity_observations || [],
      sleep_observations: w.sleep_observations || [],
      next_week_focus: w.next_week_focus || [],
      questions_for_specialist: w.questions_for_specialist || [],
    })),
    insights: (insightRows || []).map((i) => ({
      insight_type: i.insight_type,
      title: i.title || null,
      insight_text: i.insight_text,
      priority: i.priority,
      insight_date: i.insight_date,
    })),
    // request_ref is opaque to React — never parse back to UUID on client.
    // Future Phase 5: React sends request_ref unchanged → server parses →
    // server re-authorizes specialist → validates module/context/owner/request.
    service_requests: (srRows || []).map((sr) => ({
      request_ref: `service-request:${sr.id}`,
      request_type: sr.request_type,
      status: sr.status,
      created_at: sr.created_at,
      due_at: sr.due_at || null,
      scheduled_at: sr.scheduled_at || null,
    })),
  });
}

// ── AUTHORIZATION HELPER ──────────────────────────────────

export async function authorizeSpecialist(req) {
  // 1. Try HttpOnly cookie (preferred browser path)
  // 2. Fallback to Authorization Bearer header (testing/compatibility)
  let rawToken = null;

  const cookies = parseCookies(req);
  if (cookies[COOKIE_NAME]) {
    rawToken = cookies[COOKIE_NAME];
  }

  if (!rawToken) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      rawToken = authHeader.slice(7).trim();
    }
  }

  if (!rawToken || rawToken.length < 10) {
    return { status: 401, error: "Требуется авторизация" };
  }

  const tokenHash = hashToken(rawToken);
  const supabase = getSupabase();

  // Find non-revoked, non-expired session
  const { data: session, error: sessionError } = await supabase
    .from("specialist_sessions")
    .select("id, expert_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (sessionError) {
    console.error("[specialist:auth] session lookup error:", sessionError);
    return { status: 500, error: "Ошибка сервера" };
  }

  if (!session) {
    return { status: 401, error: "Сессия недействительна" };
  }

  if (session.revoked_at) {
    return { status: 401, error: "Сессия отозвана" };
  }

  // Application-layer expiration check (not an index predicate)
  if (new Date(session.expires_at) <= new Date()) {
    return { status: 401, error: "Сессия истекла" };
  }

  // Verify expert is still active
  const { data: expert, error: expertError } = await supabase
    .from("experts")
    .select("id, name, role, specialty, city, is_active")
    .eq("id", session.expert_id)
    .maybeSingle();

  if (expertError || !expert || !expert.is_active) {
    return { status: 401, error: "Специалист не найден или неактивен" };
  }

  // Update last_seen_at (non-blocking, don't fail auth if this errors)
  supabase
    .from("specialist_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", session.id)
    .then(() => {})
    .catch(() => {});

  // Fetch memberships
  const { data: memberships } = await supabase
    .from("expert_organization_memberships")
    .select("id, organization_id, role, status, organizations(name, slug, type)")
    .eq("expert_id", expert.id)
    .eq("status", "active");

  const membershipsList = (memberships || []).map((m) => ({
    membership_id: m.id,
    organization_id: m.organization_id,
    organization_name: m.organizations?.name || null,
    organization_slug: m.organizations?.slug || null,
    organization_type: m.organizations?.type || null,
    role_in_organization: m.role,
  }));

  return {
    expert,
    memberships: membershipsList,
    tokenHash,
    sessionId: session.id,
  };
}

// ── CONTEXT VALIDATION (for future patient queries) ───────

export function validateSpecialistContext({ memberships, organizationId, module }) {
  const validModules = ["support", "body"];
  if (!validModules.includes(module)) {
    return { ok: false, error: "Некорректный модуль" };
  }

  // Private practice: organization_id is null
  if (organizationId === null || organizationId === undefined) {
    return { ok: true };
  }

  // Clinic context: must be in active memberships
  const isMember = memberships.some((m) => m.organization_id === organizationId);
  if (!isMember) {
    return { ok: false, error: "Нет доступа к указанной организации" };
  }

  return { ok: true };
}
