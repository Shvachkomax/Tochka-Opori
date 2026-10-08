import crypto from "node:crypto";
import { getSupabase } from "../supabase.js";
import { authorizeSpecialist } from "../../api/specialist.js";
import { timingSafeEqual } from "./cors.js";

const EXPERT_ACTIONS = new Set([
  "listTrainingSessions", "saveTrainingSession", "updateTrainingSession",
  "createTrainingFromReview", "exportTrainingCsv", "getSessionTimeline",
  "getSessionTimelineDetails",
]);
const SECRET_FIELDS = new Set([
  "admin_secret", "password", "expert_code", "access_code", "access_token",
  "access_token_hash", "continuation_code", "token", "token_hash",
]);
const PUBLIC_CODE = /^(?:ТОЧКА|HEALTH)-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export function stripReviewCredentials(value) {
  if (Array.isArray(value)) return value.map(stripReviewCredentials);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SECRET_FIELDS.has(key))
    .map(([key, item]) => [key, stripReviewCredentials(item)]));
}

function deny(status = 403) {
  const error = new Error(status === 401 ? "Требуется вход" : "Доступ запрещён");
  error.status = status;
  throw error;
}

async function readOne(table, key, value) {
  const { data, error } = await getSupabase().from(table).select("*").eq(key, value).maybeSingle();
  if (error) throw new Error("Не удалось проверить доступ");
  return data;
}

async function loadGrants(auth) {
  const db = getSupabase();
  const results = await Promise.all([
    db.from("patient_assignments").select("public_code, organization_id, module")
      .eq("primary_expert_id", auth.expertId).eq("status", "active").eq("module", "support"),
    db.from("patient_access").select("public_code, organization_id, module, access_role")
      .eq("expert_id", auth.expertId).eq("status", "active").eq("module", "support"),
  ]);
  if (results.some(result => result.error)) throw new Error("Не удалось проверить доступ");
  const organizations = new Set(auth.memberships.map(item => item.organization_id));
  auth.grants = [
    ...(results[0].data || []).map(item => ({ ...item, writable: true })),
    ...(results[1].data || []).map(item => ({ ...item, writable: ["owner", "editor"].includes(item.access_role) })),
  ].filter(item => PUBLIC_CODE.test(item.public_code || "")
    && (!item.organization_id || organizations.has(item.organization_id)));
}

// Patient-linked rows require a CURRENT grant in the same module and organization.
// Historical expert_id/primary_expert_id fields and org membership alone are not grants.
export function canAccessReviewRecord(auth, row, { write = false, training = false } = {}) {
  if (!row) return false;
  if (auth.isAdmin) return true;
  if (!auth.expertId || !auth.expert.allowed_modules.includes("support")) return false;
  if ((row.module && row.module !== "support") || row.public_code?.startsWith("HEALTH-")) return false;
  if (row.public_code) {
    return auth.grants.some(grant => grant.public_code === row.public_code
      && (grant.organization_id || null) === (row.organization_id || null)
      && (!write || grant.writable));
  }
  // A standalone training exercise has no patient or organization attached.
  return training && row.expert_id === auth.expertId && !row.session_id
    && !row.case_review_id && !row.organization_id;
}

export function scopeTrainingQuery(query, auth) {
  if (auth.isAdmin) return query;
  const codes = [...new Set(auth.grants.map(grant => grant.public_code))];
  const ownExercise = `and(expert_id.eq.${auth.expertId},public_code.is.null,session_id.is.null,case_review_id.is.null,organization_id.is.null)`;
  return query.or(codes.length ? `public_code.in.(${codes.join(",")}),${ownExercise}` : ownExercise);
}

async function requireRecord(auth, table, key, value, write = false) {
  const row = await readOne(table, key, value);
  if (!canAccessReviewRecord(auth, row, { write, training: table === "training_sessions" })) deny();
  return row;
}

async function authorizePatientSave(req) {
  const body = req.body || {};
  const sessionId = body.sessionId || body.session_id;
  if (!sessionId || typeof body.access_token !== "string" || !body.access_token) deny(401);
  const session = await readOne("sessions", "session_id", sessionId);
  const hash = crypto.createHash("sha256").update(body.access_token).digest("hex");
  // Do not inherit validateSessionAccess's legacy bypass for review writes.
  if (!session || session.legacy_access || !session.access_token_hash
    || !timingSafeEqual(hash, session.access_token_hash)) deny(403);
  if ((body.sessionId && body.session_id && body.sessionId !== body.session_id)
    || (body.publicCode && body.publicCode !== session.public_code)
    || (body.module && body.module !== session.module)) deny();
  req.body = stripReviewCredentials(body);
  Object.assign(req.body, {
    case_id: session.session_id, sessionId: session.session_id,
    publicCode: session.public_code, module: session.module,
    expert_id: null, expert_name: null, expert_role: null, expert_specialty: null,
    organization_id: session.organization_id || null,
    primary_expert_id: session.primary_expert_id || null,
  });
  return { isAdmin: false, expertId: null, patientSession: session };
}

export async function prepareReviewsAccess(req) {
  const body = req.body || {};
  if (typeof body.admin_secret === "string" && process.env.ADMIN_SECRET
    && timingSafeEqual(body.admin_secret, process.env.ADMIN_SECRET)) {
    req.body = stripReviewCredentials(body);
    return { isAdmin: true, expertId: null };
  }
  if (body.action === "save") return authorizePatientSave(req);

  const result = await authorizeSpecialist(req);
  if (result.error) {
    if (result.status === 500) throw new Error("Не удалось проверить вход");
    deny(401);
  }
  if (!EXPERT_ACTIONS.has(body.action)) deny();
  if (!result.expert.allowed_modules.includes("support")) deny();
  const auth = { isAdmin: false, expertId: result.expert.id, expert: result.expert, memberships: result.memberships };
  await loadGrants(auth);
  req.body = stripReviewCredentials(body);
  req.body.expert_id = auth.expertId;

  if (body.action === "getSessionTimeline") {
    if (!PUBLIC_CODE.test(body.public_code || "")) deny();
    if (!auth.grants.some(grant => grant.public_code === body.public_code)) deny();
  }
  if (body.action === "getSessionTimelineDetails") {
    for (const [field, table, key] of [
      ["case_review_id", "case_reviews", "id"], ["session_id", "sessions", "session_id"],
      ["training_session_id", "training_sessions", "id"],
    ]) {
      if (body[field]) await requireRecord(auth, table, key, body[field]);
    }
  }
  if (body.action === "updateTrainingSession") {
    const row = await requireRecord(auth, "training_sessions", "id", body.id, true);
    if (row.expert_id !== auth.expertId) deny();
    // Editing feedback must not reassign the record to another patient.
    for (const field of ["public_code", "previous_public_code"]) {
      if (Object.hasOwn(body.updates || {}, field) && body.updates[field] !== row[field]) deny();
    }
  }
  if (body.action === "createTrainingFromReview") {
    const row = await requireRecord(auth, "case_reviews", "id", body.review_id, true);
    if (body.public_code && body.public_code !== row.public_code) deny();
  }
  if (body.action === "saveTrainingSession") {
    const references = [];
    if (body.case_review_id) references.push(await requireRecord(auth, "case_reviews", "id", body.case_review_id, true));
    if (body.session_id) references.push(await requireRecord(auth, "sessions", "session_id", body.session_id, true));
    const code = body.public_code || references[0]?.public_code || null;
    const org = body.organization_id || references[0]?.organization_id || null;
    if (references.some(row => row.public_code !== code || (row.organization_id || null) !== org)) deny();
    const row = { ...req.body, public_code: code, organization_id: org };
    if (!canAccessReviewRecord(auth, row, { write: true, training: true })) deny();
    if (body.previous_public_code && !auth.grants.some(grant => grant.public_code === body.previous_public_code)) deny();
    Object.assign(req.body, { public_code: code, organization_id: org,
      primary_expert_id: null, expert_name: auth.expert.name, expert_role: auth.expert.role });
  }
  return auth;
}
