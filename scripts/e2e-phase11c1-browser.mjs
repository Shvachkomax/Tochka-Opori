import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const BASE_URL = process.env.E2E_BASE_URL || "https://tochka-opori-test.vercel.app";
const ACCESS_CODE = process.env.E2E_SPECIALIST_ACCESS_CODE;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PROJECT_REF = "eehyehlhiyztciaezaus";

if (!ACCESS_CODE || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Set E2E_SPECIALIST_ACCESS_CODE, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for TEST E2E.");
}
if (!SUPABASE_URL.includes(TEST_PROJECT_REF)) {
  throw new Error("Refusing to run Phase 11C.1 E2E outside TEST Supabase project.");
}
if (!BASE_URL.includes("tochka-opori-test.vercel.app")) {
  throw new Error("Refusing to run this browser suite outside the TEST deployment.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const results = [];
const cleanup = { invitationIds: [], assignmentCodes: [], sessionIds: [], onboardingIds: [], legacyLinkIds: [] };

function assert(condition, message) {
  results.push({ message, ok: Boolean(condition) });
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

async function specialistPage(context) {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/specialist`, { waitUntil: "networkidle", timeout: 30000 });
  await page.fill('input[placeholder="Код специалиста"]', ACCESS_CODE);
  await page.click('button:has-text("Войти")');
  await page.waitForSelector('[data-testid="specialist-cabinet"]', { timeout: 15000 });
  return page;
}

async function createInvitation(page, patientLabel) {
  const response = await page.evaluate(async (label) => {
    const res = await fetch("/api/specialist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "createInvitation", module: "support", patient_label: label }),
    });
    return { status: res.status, data: await res.json() };
  }, patientLabel);
  assert(response.status === 200 && response.data.ok, "specialist creates new support invitation through API");
  cleanup.invitationIds.push(response.data.invitation.id);
  return response.data.invitation;
}

async function getSessionIdentity(page) {
  const local = await page.evaluate(() => ({
    sessionId: localStorage.getItem("support_last_session_id"),
    accessToken: localStorage.getItem("support_last_access_token"),
  }));
  assert(local.sessionId && local.accessToken, "patient identity credentials are persisted after explicit Accept");
  const { data: session } = await supabase
    .from("sessions")
    .select("session_id, public_code, anonymous_owner_id")
    .eq("session_id", local.sessionId)
    .single();
  assert(Boolean(session?.public_code && session?.anonymous_owner_id), "explicit Accept creates a canonical empty Support session");
  cleanup.sessionIds.push(session.session_id);
  cleanup.assignmentCodes.push(session.public_code);
  return session;
}

async function createEmptySupportSession(page) {
  const result = await page.evaluate(async () => {
    const tokenResponse = await fetch("/api/client-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "analyze", module: "support" }),
    });
    const tokenData = await tokenResponse.json();
    const sessionResponse = await fetch("/api/start-session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenData.token}` },
    });
    return sessionResponse.json();
  });
  assert(result.ok && result.session_id && result.access_token, "trusted start-session creates an empty support identity without analysis");
  const { data: session } = await supabase
    .from("sessions")
    .select("session_id, public_code, anonymous_owner_id")
    .eq("session_id", result.session_id)
    .single();
  cleanup.sessionIds.push(result.session_id);
  cleanup.assignmentCodes.push(session.public_code);
  return session;
}

async function main() {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });

  try {
    // A. Dedicated specialist auth and legacy localStorage isolation.
    const authContext = await browser.newContext();
    const authPage = await specialistPage(authContext);
    assert(await authPage.evaluate(() => location.pathname) === "/specialist", "specialist login stays on /specialist");
    assert(await authPage.locator('[data-testid="specialist-cabinet"]').count() === 1, "authenticated shell is SpecialistCabinet");
    assert(await authPage.locator("text=Найдём точку опоры").count() === 0, "ordinary landing is absent from specialist shell");
    await authPage.reload({ waitUntil: "networkidle" });
    await authPage.waitForSelector('[data-testid="specialist-cabinet"]', { timeout: 15000 });
    assert(true, "refresh restores SpecialistCabinet through HttpOnly cookie");
    await authPage.click('button:has-text("Выйти")');
    await authPage.waitForSelector('[data-testid="specialist-login"]', { timeout: 15000 });
    assert(true, "logout returns to specialist login form");
    await authContext.close();

    const legacyContext = await browser.newContext();
    await legacyContext.addInitScript(() => {
      localStorage.setItem("tochka_expert", JSON.stringify({ id: "legacy-only", name: "Legacy", role: "doctor" }));
    });
    const legacyPage = await legacyContext.newPage();
    await legacyPage.goto(`${BASE_URL}/specialist`, { waitUntil: "networkidle", timeout: 30000 });
    assert(await legacyPage.locator('input[placeholder="Код специалиста"]').count() > 0, "legacy localStorage alone does not grant SpecialistCabinet access");
    await legacyContext.close();

    // B/C. New specialist → patient invitation in a fresh context and existing session.
    const specialistContext = await browser.newContext();
    const specialist = await specialistPage(specialistContext);
    const { data: specialistExpert } = await supabase
      .from("experts")
      .select("id")
      .eq("access_code", ACCESS_CODE)
      .single();
    assert(Boolean(specialistExpert?.id), "TEST specialist fixture resolves to an expert identity");
    const firstInvitation = await createInvitation(specialist, `E2E-${Date.now()}`);
    const patientContext = await browser.newContext();
    const patient = await patientContext.newPage();
    await patient.goto(firstInvitation.url, { waitUntil: "networkidle", timeout: 30000 });
    await patient.waitForSelector("text=Вас приглашает специалист", { timeout: 15000 });
    assert(await patient.locator("text=Вы открыли ссылку специалиста").count() === 0, "new invitation never renders legacy UI");
    assert(await patient.locator('button:has-text("Принять")').count() > 0, "new specialist invitation exposes Accept action");
    assert(await patient.locator("text=Рассказать голосом").count() === 0, "opening linking invitation does not expose conversation start UI");
    await patient.click('button:has-text("Принять")');
    await patient.waitForTimeout(2500);
    const firstSession = await getSessionIdentity(patient);
    const { data: acceptedFirst } = await supabase
      .from("patient_specialist_invitations")
      .select("status")
      .eq("id", firstInvitation.id)
      .single();
    assert(acceptedFirst?.status === "accepted", "fresh Accept accepts new invitation");
    const { data: assignmentFirst } = await supabase
      .from("patient_assignments")
      .select("organization_id, primary_expert_id, module, source")
      .eq("public_code", firstSession.public_code)
      .eq("module", "support")
      .eq("status", "active")
      .maybeSingle();
    assert(assignmentFirst?.primary_expert_id && assignmentFirst.source === "patient_invitation_accept", "fresh Accept creates canonical patient_assignment");

    const secondInvitation = await createInvitation(specialist, `E2E-existing-${Date.now()}`);
    await patient.goto(secondInvitation.url, { waitUntil: "networkidle", timeout: 30000 });
    await patient.waitForSelector("text=Вас приглашает специалист", { timeout: 15000 });
    await patient.click('button:has-text("Принять")');
    await patient.waitForTimeout(1500);
    const { data: acceptedSecond } = await supabase
      .from("patient_specialist_invitations")
      .select("status")
      .eq("id", secondInvitation.id)
      .single();
    assert(acceptedSecond?.status === "accepted", "existing Support session accepts a second invitation idempotently");

    // E. Patient → specialist onboarding does not expose clinical data.
    const onboardingOwner = await createEmptySupportSession(patient);
    const onboardingToken = crypto.randomBytes(32).toString("hex");
    const onboardingHash = crypto.createHash("sha256").update(onboardingToken).digest("hex");
    const { data: onboardingInvitation, error: onboardingError } = await supabase
      .from("patient_specialist_invitations")
      .insert({
        token_hash: onboardingHash,
        direction: "patient_to_specialist",
        module: "support",
        inviter_owner_type: "anonymous_case",
        inviter_owner_id: onboardingOwner.anonymous_owner_id,
        status: "pending",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      })
      .select("id")
      .single();
    if (onboardingError) throw onboardingError;
    cleanup.invitationIds.push(onboardingInvitation.id);

    const onboardingPage = await browser.newContext().then((context) => context.newPage());
    await onboardingPage.goto(`${BASE_URL}/invite/${onboardingToken}`, { waitUntil: "networkidle", timeout: 30000 });
    await onboardingPage.waitForSelector("text=Подключиться как специалист", { timeout: 15000 });
    const onboardingText = await onboardingPage.textContent("body");
    assert(!onboardingText.includes("patient_text") && !onboardingText.includes("clinical"), "unknown doctor receives no clinical data");
    await onboardingPage.fill('input[placeholder="Имя специалиста"]', "E2E Доктор");
    await onboardingPage.click('button:has-text("Подключиться как специалист")');
    await onboardingPage.waitForTimeout(1200);
    const { data: onboardingRequest } = await supabase
      .from("specialist_onboarding_requests")
      .select("id, status")
      .eq("invitation_id", onboardingInvitation.id)
      .maybeSingle();
    if (onboardingRequest) cleanup.onboardingIds.push(onboardingRequest.id);
    assert(onboardingRequest?.status === "submitted", "unknown doctor submits onboarding request");

    const { error: approvalInvitationError } = await supabase
      .from("patient_specialist_invitations")
      .update({ target_expert_id: specialistExpert.id, updated_at: new Date().toISOString() })
      .eq("id", onboardingInvitation.id)
      .eq("status", "pending");
    if (approvalInvitationError) throw approvalInvitationError;
    const { error: approvalRequestError } = await supabase
      .from("specialist_onboarding_requests")
      .update({ status: "approved", expert_id: specialistExpert.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", onboardingRequest.id);
    if (approvalRequestError) throw approvalRequestError;

    const { data: beforeExpertAccept } = await supabase
      .from("patient_assignments")
      .select("id")
      .eq("public_code", onboardingOwner.public_code)
      .eq("module", "support")
      .eq("status", "active");
    assert((beforeExpertAccept || []).length === 0, "admin onboarding approval does not create patient_assignment");

    await specialist.goto(`${BASE_URL}/invite/${onboardingToken}`, { waitUntil: "networkidle", timeout: 30000 });
    await specialist.waitForSelector('button:has-text("Принять")', { timeout: 15000 });
    assert(await specialist.locator("text=Пациент приглашает специалиста подключиться").count() > 0, "authenticated specialist sees approved incoming invitation");
    await specialist.click('button:has-text("Принять")');
    await specialist.waitForTimeout(1500);
    const { data: acceptedByExpert } = await supabase
      .from("patient_specialist_invitations")
      .select("status")
      .eq("id", onboardingInvitation.id)
      .single();
    const { data: expertAssignment } = await supabase
      .from("patient_assignments")
      .select("primary_expert_id, source")
      .eq("public_code", onboardingOwner.public_code)
      .eq("module", "support")
      .eq("status", "active")
      .maybeSingle();
    assert(acceptedByExpert?.status === "accepted", "approved patient invitation is accepted by authenticated specialist");
    assert(expertAssignment?.primary_expert_id === specialistExpert.id && expertAssignment.source === "patient_invitation_accept", "specialist acceptance creates canonical assignment");

    // D. Legacy route remains separate when a legacy token is provided explicitly.
    let legacyToken = process.env.E2E_LEGACY_INVITE_TOKEN || null;
    let legacyFixture = null;
    if (!legacyToken) {
      const legacyResponse = await specialist.evaluate(async (code) => {
        const res = await fetch("/api/experts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "createDoctorInviteLink", expert_code: code, label: `E2E-legacy-${Date.now()}` }),
        });
        return { status: res.status, data: await res.json() };
      }, ACCESS_CODE);
      assert(legacyResponse.status === 200 && legacyResponse.data.ok, "legacy invite backend remains available for compatibility");
      legacyFixture = legacyResponse.data.invite_link;
      cleanup.legacyLinkIds.push(legacyFixture.id);
      legacyToken = legacyFixture.token;
    }
    if (legacyToken) {
      const legacyPage = await browser.newContext().then((context) => context.newPage());
      await legacyPage.goto(`${BASE_URL}/start/${legacyToken}`, { waitUntil: "networkidle", timeout: 30000 });
      assert(await legacyPage.locator("text=Вы открыли ссылку специалиста").count() > 0, "legacy /start token keeps legacy UI");
      assert(await legacyPage.locator('button:has-text("Принять")').count() === 0, "legacy invite has no new linking Accept action");
    } else {
      console.log("SKIP legacy browser assertion: set E2E_LEGACY_INVITE_TOKEN for a TEST legacy fixture.");
    }

    await patientContext.close();
    await specialistContext.close();
  } finally {
    for (const id of cleanup.onboardingIds) await supabase.from("specialist_onboarding_requests").delete().eq("id", id);
    for (const id of cleanup.invitationIds) await supabase.from("patient_specialist_invitations").delete().eq("id", id);
    for (const id of cleanup.legacyLinkIds) await supabase.from("doctor_invite_links").delete().eq("id", id);
    for (const code of cleanup.assignmentCodes) await supabase.from("patient_assignments").delete().eq("public_code", code);
    for (const id of cleanup.sessionIds) await supabase.from("sessions").delete().eq("session_id", id);
    await browser.close();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`Browser E2E: ${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
