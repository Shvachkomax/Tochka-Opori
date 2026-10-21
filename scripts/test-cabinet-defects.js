import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  LEGACY_CONTINUATION_CODE_MESSAGE,
  getCurrentInvitationStatus,
  makeSessionSummary,
  normalizeInvitationStatuses,
} from "../lib/session/cabinet-presenters.js";
import {
  generateContinuationCredential,
  isLegacyShortCode,
  parseContinuationCredential,
  verifyContinuationSecret,
} from "../lib/session/continuation-credential.js";
import { rotateContinuationCredential } from "../lib/session/continuation-store.js";
import { buildSpecialistRequestContext } from "../lib/specialist/request-context.js";
import { isAnMedSupportFeatureEnabled } from "../lib/security/module-availability.js";

process.env.CONTINUATION_SECRET_PEPPER = "synthetic-test-pepper-only";

assert.equal(makeSessionSummary({ patient_text: "Последние недели плохо сплю и тревожусь. Дальше текст." }), "Последние недели плохо сплю и тревожусь");
assert.equal(makeSessionSummary({ patient_text: "", json_data: { isContinuation: true } }), "Продолжение разговора");
assert.equal(makeSessionSummary({ patient_text: "" }), "Первичный разговор");
assert.equal(isLegacyShortCode("ТОЧКА-ABCD-EFGH"), true);
assert.equal(parseContinuationCredential("ТОЧКА-ABCD-EFGH"), null, "a legacy short code never grants access alone");
assert.match(LEGACY_CONTINUATION_CODE_MESSAGE, /создайте новый код продолжения/iu);
assert.match(LEGACY_CONTINUATION_CODE_MESSAGE, /устройство, где беседа уже открывается/iu);
assert.equal(isAnMedSupportFeatureEnabled("support", { brand: "anmed", supportOnly: "false" }), true);
assert.equal(isAnMedSupportFeatureEnabled("body", { brand: "anmed", supportOnly: "false" }), false);
assert.equal(isAnMedSupportFeatureEnabled("support", { brand: "pneumointegration", supportOnly: "false" }), false);

const now = Date.parse("2026-10-20T12:00:00.000Z");
assert.equal(getCurrentInvitationStatus({ status: "pending", expires_at: "2026-10-20T11:59:59.000Z" }, now), "expired");
assert.equal(getCurrentInvitationStatus({ status: "pending", expires_at: "2026-10-20T12:00:01.000Z" }, now), "pending");
assert.equal(getCurrentInvitationStatus({ status: "accepted", expires_at: "2026-10-19T12:00:00.000Z" }, now), "accepted");
assert.deepEqual(normalizeInvitationStatuses([
  { id: "expired", status: "pending", expires_at: "2026-10-20T11:00:00.000Z" },
  { id: "active", status: "pending", expires_at: "2026-10-20T13:00:00.000Z" },
], now).map((invitation) => invitation.status), ["expired", "pending"]);

const original = generateContinuationCredential("support");
const originalRow = {
  id: "synthetic-credential-id",
  module: "support",
  owner_type: "anonymous_case",
  owner_id: "synthetic-owner-id",
  lookup_code: original.lookupCode,
  secret_hash: original.secretHash,
  secret_version: 1,
  revoked_at: null,
};
const credentialStore = {
  row: originalRow,
  from(table) {
    assert.equal(table, "continuation_credentials");
    const store = this;
    return {
      select() {
        const filters = {};
        const query = {
          eq(column, value) { filters[column] = value; return query; },
          order() { return query; },
          async maybeSingle() {
            const row = Object.entries(filters).every(([column, value]) => store.row[column] === value) ? store.row : null;
            return { data: row ? structuredClone(row) : null, error: null };
          },
          then(resolve, reject) {
            const row = Object.entries(filters).every(([column, value]) => store.row[column] === value) ? [structuredClone(store.row)] : [];
            return Promise.resolve({ data: row, error: null }).then(resolve, reject);
          },
        };
        return query;
      },
      update(patch) {
        let id = null;
        const update = {
          eq(column, value) { if (column === "id") id = value; return update; },
          select() { return update; },
          async single() {
            if (store.row.id !== id) return { data: null, error: new Error("not found") };
            Object.assign(store.row, structuredClone(patch));
            return { data: structuredClone(store.row), error: null };
          },
        };
        return update;
      },
    };
  },
};

const rotated = await rotateContinuationCredential({ module: "support", ownerId: originalRow.owner_id, supabase: credentialStore });
const parsedNewCode = parseContinuationCredential(rotated.combinedCode);
assert(parsedNewCode, "rotated continuation code parses for the same module");
assert.notEqual(parsedNewCode.lookupCode, original.lookupCode, "rotation issues a fresh lookup code");
assert.equal(credentialStore.row.owner_id, originalRow.owner_id, "rotating the code keeps the same patient owner and conversation access");
assert.equal(credentialStore.row.secret_version, 2, "rotation increments the credential version");
assert.equal(verifyContinuationSecret(parsedNewCode.secret, credentialStore.row.secret_hash), true, "the new code secret is accepted by the stored credential");
assert.equal(verifyContinuationSecret(original.secret, credentialStore.row.secret_hash), false, "the old code secret no longer restores access");

const requestContext = buildSpecialistRequestContext({
  session: {
    user_report: "Пациент описал бессонницу и частое сердцебиение.\nЧисловой балл риска: 8",
    doctor_report: "Маркеры риска: мысли о смерти, требуется уточнение\nМодифицирующие факторы: алкоголь и изоляция\nЧисловой балл риска: 8\nДиагноз: автоматический",
    created_at: "2026-10-20T10:00:00.000Z",
  },
});
assert.match(requestContext.preliminary_summary, /бессонницу и частое сердцебиение/);
assert.doesNotMatch(requestContext.preliminary_summary, /балл риска/iu);
assert.match(requestContext.signals_for_attention, /мысли о смерти/);
assert.match(requestContext.signals_for_attention, /алкоголь и изоляция/);
assert.doesNotMatch(JSON.stringify(requestContext), /Числовой балл|Диагноз/iu);
assert.equal(requestContext.session_date, "2026-10-20T10:00:00.000Z");

const migration = await readFile(new URL("../supabase/migrations/20261021000822_link_match_request_to_session.sql", import.meta.url), "utf8");
assert.match(migration, /GROUP BY session_id\s+HAVING count\(\*\) > 1/iu, "migration refuses ambiguous pre-existing session IDs");
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_session_id_unique/iu);
assert.match(migration, /ADD COLUMN IF NOT EXISTS session_id text/iu);
assert.match(migration, /REFERENCES public\.sessions\(session_id\) ON DELETE SET NULL/iu);
assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_specialist_match_requests_session/iu);
assert.match(migration, /WHERE session_id IS NOT NULL/iu);

console.log("Cabinet and request-context regression tests passed.");
