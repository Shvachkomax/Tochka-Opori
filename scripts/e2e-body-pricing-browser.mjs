import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const BASE_URL = process.env.E2E_BASE_URL || "https://tochka-opori-test.vercel.app";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PROJECT_REF = "eehyehlhiyztciaezaus";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Set TEST Supabase environment variables.");
if (!SUPABASE_URL.includes(TEST_PROJECT_REF) || !BASE_URL.includes("tochka-opori-test.vercel.app")) {
  throw new Error("Refusing to run Body pricing E2E outside TEST.");
}

process.env.SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const results = [];
const cleanup = { requestIds: [], serviceCodes: [], assignmentId: null, bodyClientId: null, onboardingId: null, sessionId: null, ownerId: null, expertId: null, specialistSessionId: null, walletId: null };

function assert(condition, message) {
  results.push({ message, ok: Boolean(condition) });
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

async function waitForRequest(id, expectedStatus) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = await supabase.from("service_requests").select("*").eq("id", id).single();
    if (current.data?.status === expectedStatus) return current.data;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return (await supabase.from("service_requests").select("*").eq("id", id).single()).data;
}

async function createRequest(page, topicLabel, serviceLabel, message, serviceCode) {
  const open = page.getByRole("button", { name: "Открыть" });
  if (await open.count()) await open.click();
  await page.getByRole("button", { name: "Новый запрос" }).click();
  await page.getByRole("button", { name: topicLabel, exact: true }).click();
  const service = page.getByRole("button", { name: new RegExp(serviceLabel) }).first();
  await service.click();
  await page.getByPlaceholder("Опишите вопрос своими словами...").fill(message);
  await page.getByRole("button", { name: "Отправить запрос" }).click();
  await page.waitForTimeout(500);
  await page.getByText(serviceLabel, { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });

  let ownerRequests = [];
  let error = null;
  let request = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await supabase
      .from("service_requests")
      .select("id, service_code, service_topic, meeting_format, price_credits, reserved_credits, charged_credits, title, status")
      .eq("owner_id", cleanup.ownerId)
      .eq("module", "body")
      .order("created_at", { ascending: false });
    ownerRequests = result.data || [];
    error = result.error;
    request = ownerRequests.find((row) => row.status === "submitted" && row.service_code === serviceCode);
    if (request || error) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (error || !request) {
    throw new Error(`Could not resolve created request: ${error?.message || "not found"}; rows=${JSON.stringify(ownerRequests || [])}`);
  }
  cleanup.requestIds.push(request.id);
  return request;
}

async function callCreateBody(page, body) {
  return page.evaluate(async (payload) => {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: response.status, data: await response.json() };
  }, body);
}

async function main() {
  const { generateSessionAccessToken } = await import("../lib/security/access-token.js");
  const { ensureWallet } = await import("../lib/usage/wallet.js");

  cleanup.ownerId = crypto.randomUUID();
  cleanup.sessionId = `e2e-body-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const publicCode = `E2E-BODY-${Date.now()}`;
  const expertCode = `E2E-BODY-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

  const { data: expert, error: expertError } = await supabase
    .from("experts")
    .insert({ name: "TEST Body specialist", role: "doctor", specialty: "Health test", access_code: expertCode, is_active: true, allowed_modules: ["body"] })
    .select("id")
    .single();
  if (expertError) throw expertError;
  cleanup.expertId = expert.id;

  const specialistRawToken = crypto.randomBytes(32).toString("hex");
  const specialistTokenHash = crypto.createHash("sha256").update(specialistRawToken).digest("hex");
  const { data: specialistSession, error: specialistSessionError } = await supabase
    .from("specialist_sessions")
    .insert({ expert_id: expert.id, token_hash: specialistTokenHash, expires_at: new Date(Date.now() + 3600000).toISOString() })
    .select("id")
    .single();
  if (specialistSessionError) throw specialistSessionError;
  cleanup.specialistSessionId = specialistSession.id;

  const { error: sessionError } = await supabase.from("sessions").insert({
    session_id: cleanup.sessionId,
    module: "body",
    anonymous_owner_id: cleanup.ownerId,
    public_code: publicCode,
    patient_text: "",
    conversation_history: [],
    json_data: {},
    legacy_access: false,
  });
  if (sessionError) throw sessionError;
  const accessToken = await generateSessionAccessToken(cleanup.sessionId, { module: "body", anonymousOwnerId: cleanup.ownerId, publicCode });
  if (!accessToken) throw new Error("Could not generate TEST Body access token");

  const { data: bodyClient, error: bodyClientError } = await supabase
    .from("body_clients")
    .insert({ session_id: cleanup.sessionId, anonymous_owner_id: cleanup.ownerId, display_name: "TEST Body patient", source: "e2e_phase11e", status: "active" })
    .select("id")
    .single();
  if (bodyClientError) throw bodyClientError;
  cleanup.bodyClientId = bodyClient.id;

  const { data: onboarding, error: onboardingError } = await supabase
    .from("body_onboarding")
    .insert({ owner_type: "anonymous_profile", owner_id: cleanup.ownerId, intro_completed: true, intro_completed_at: new Date().toISOString() })
    .select("id")
    .single();
  if (onboardingError) throw onboardingError;
  cleanup.onboardingId = onboarding.id;

  const { data: assignment, error: assignmentError } = await supabase
    .from("patient_assignments")
    .insert({ owner_type: "anonymous_profile", owner_id: cleanup.ownerId, primary_expert_id: expert.id, module: "body", status: "active", source: "e2e_phase11e", patient_label: "TEST Body patient" })
    .select("id")
    .single();
  if (assignmentError) throw assignmentError;
  cleanup.assignmentId = assignment.id;

  const wallet = await ensureWallet({ ownerType: "anonymous_profile", ownerId: cleanup.ownerId, module: "body" });
  cleanup.walletId = wallet?.id || null;
  if (cleanup.walletId) {
    await supabase.from("usage_wallets").update({ balance: 100000, total_refilled: 100000, refill_mode: "disabled" }).eq("id", cleanup.walletId);
  }
  const walletBeforeRow = cleanup.walletId
    ? await supabase.from("usage_wallets").select("balance, total_used").eq("id", cleanup.walletId).single()
    : { data: null };
  const walletBefore = walletBeforeRow.data;

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const patientContext = await browser.newContext();
    await patientContext.addInitScript(({ sessionId, accessToken }) => {
      localStorage.setItem("body_last_session_id", sessionId);
      localStorage.setItem("body_last_access_token", accessToken);
    }, { sessionId: cleanup.sessionId, accessToken });
    const patient = await patientContext.newPage();
    await patient.goto(`${BASE_URL}/?module=body`, { waitUntil: "networkidle", timeout: 30000 });
    await patient.getByText("Связаться со специалистом", { exact: true }).waitFor({ state: "visible", timeout: 20000 });

    const labs = await createRequest(patient, "Анализы", "Расшифровка анализов", "Проверка расшифровки анализов", "labs_review_written");
    const medications = await createRequest(patient, "Лекарства и БАДы", "Разбор принимаемых препаратов и БАДов", "Проверка безопасного разбора препаратов и БАДов", "medications_supplements_review");
    const online = await createRequest(patient, "Анализы", "Онлайн-консультация", "Проверка онлайн консультации по анализам", "health_online_consultation");
    for (const [request, expected] of [
      [labs, { code: "labs_review_written", topic: "labs", format: "text", price: 15000 }],
      [medications, { code: "medications_supplements_review", topic: "medications_supplements", format: "text", price: 20000 }],
      [online, { code: "health_online_consultation", topic: "labs", format: "video", price: 40000 }],
    ]) {
      assert(request.service_code === expected.code, `${expected.code}: service_code snapshot`);
      assert(request.service_topic === expected.topic, `${expected.code}: service_topic snapshot`);
      assert(request.meeting_format === expected.format, `${expected.code}: meeting_format snapshot`);
      assert(request.price_credits === expected.price, `${expected.code}: price_credits snapshot`);
      assert(request.reserved_credits === 0, `${expected.code}: reserved_credits is zero`);
      assert(request.charged_credits === 0, `${expected.code}: charged_credits is zero`);
    }
    const patientText = await patient.textContent("body");
    assert(!patientText.includes("300") && !patientText.includes("500") && !patientText.includes("700") && !patientText.includes("1500"), "new Body UI does not show legacy prices");
    assert(!/назначить лекарство|назначение лечения|изменение дозировки|коррекция дозировки/i.test(patientText), "Body UI has no prescribing promises");

    const specialistContext = await browser.newContext();
    await specialistContext.addCookies([{
      name: "tochka_specialist_session",
      value: specialistRawToken,
      domain: "tochka-opori-test.vercel.app",
      path: "/api/specialist",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    }]);
    const specialist = await specialistContext.newPage();
    await specialist.goto(`${BASE_URL}/specialist`, { waitUntil: "networkidle", timeout: 30000 });
    await specialist.waitForSelector('[data-testid="specialist-cabinet"]', { timeout: 15000 });

    for (const request of [labs, medications, online]) {
      const card = specialist.locator('[data-testid="service-request-card"]').filter({ hasText: request.title }).first();
      await card.waitFor({ state: "visible", timeout: 15000 });
      assert((await card.textContent()).includes(request.service_topic === "labs" ? "Анализы" : "Лекарства и БАДы"), `${request.service_code}: specialist sees topic`);
      assert((await card.textContent()).includes(request.price_credits.toLocaleString("ru-RU")), `${request.service_code}: specialist sees snapshot price`);
      assert((await card.textContent()).includes(request.meeting_format === "video" ? "Онлайн" : "Письменно"), `${request.service_code}: specialist sees format`);
    }

    for (const request of [labs, medications, online]) {
      const card = specialist.locator('[data-testid="service-request-card"]').filter({ hasText: request.title }).first();
      await card.getByRole("button", { name: "Принять" }).click();
      await waitForRequest(request.id, "accepted");
      const reservation = await supabase.from("usage_reservations").select("amount, status").eq("service_request_id", request.id).single();
      assert(reservation.data?.amount === request.price_credits && reservation.data.status === "active", `${request.service_code}: active reserve created`);
      pagePrompt(specialist, `Ответ по запросу ${request.service_code}`);
      await card.getByRole("button", { name: "Ответить" }).click();
      await waitForRequest(request.id, "answered");
      const currentCard = specialist.locator('[data-testid="service-request-card"]').filter({ hasText: request.title }).first();
      await currentCard.getByRole("button", { name: "Завершить" }).click();
      await waitForRequest(request.id, "completed");
      const completed = await supabase.from("service_requests").select("reserved_credits, charged_credits").eq("id", request.id).single();
      const captured = await supabase.from("usage_reservations").select("status").eq("service_request_id", request.id).single();
      assert(completed.data?.reserved_credits === 0 && completed.data?.charged_credits === request.price_credits, `${request.service_code}: completion captures exact price`);
      assert(captured.data?.status === "captured", `${request.service_code}: reservation captured`);
    }

    await patient.reload({ waitUntil: "networkidle" });
    await patient.getByText("Связаться со специалистом", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
    await patient.getByRole("button", { name: "Открыть" }).click();
    await patient.getByText("Расшифровка анализов", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
    assert((await patient.textContent("body")).includes("Завершён"), "patient sees synchronized completed request state");

    const legacyAttempt = await callCreateBody(patient, {
      action: "createBodyServiceRequest",
      session_id: cleanup.sessionId,
      access_token: accessToken,
      request_type: "text_question",
      message: "legacy action omitted service code",
    });
    assert(legacyAttempt.status === 400 && !legacyAttempt.data.ok, "normal Body action rejects missing canonical service_code");
    const explicitLegacy = await callCreateBody(patient, {
      action: "createLegacyBodyServiceRequest",
      session_id: cleanup.sessionId,
      access_token: accessToken,
      request_type: "text_question",
      message: "explicit legacy compatibility request",
    });
    assert(explicitLegacy.status === 200 && explicitLegacy.data.ok, "explicit legacy Body action remains available for compatibility");
    if (explicitLegacy.data.request?.id) {
      cleanup.requestIds.push(explicitLegacy.data.request.id);
      const { data: legacyRow } = await supabase.from("service_requests").select("service_code, price_credits, reserved_credits").eq("id", explicitLegacy.data.request.id).single();
      assert(legacyRow?.service_code === null && legacyRow.price_credits === null, "explicit legacy request keeps NULL canonical pricing");
    }

    const pricingBeforeNegative = await supabase.from("service_pricing").insert({ service_code: `e2e_inactive_${Date.now()}`, module: "body", label: "TEST inactive", service_topic: "labs", meeting_format: "text", credits: 1, active: false }).select("service_code").single();
    if (pricingBeforeNegative.data) cleanup.serviceCodes.push(pricingBeforeNegative.data.service_code);
    const negativeCases = [
      [{ service_code: "short_followup", service_topic: "labs", message: "cross module" }, "Body rejects Support service_code"],
      [{ service_code: "unknown_body_code", service_topic: "labs", message: "unknown" }, "Body rejects unknown service_code"],
      [{ service_code: pricingBeforeNegative.data?.service_code, service_topic: "labs", message: "inactive" }, "Body rejects inactive tariff"],
      [{ service_code: "labs_review_written", service_topic: "medications_supplements", message: "wrong topic" }, "Body rejects invalid topic/product pair"],
    ];
    for (const [extra, label] of negativeCases) {
      const result = await callCreateBody(patient, { action: "createBodyServiceRequest", session_id: cleanup.sessionId, access_token: accessToken, ...extra });
      assert(result.status === 400 && !result.data.ok, label);
    }

    const override = await callCreateBody(patient, {
      action: "createBodyServiceRequest",
      session_id: cleanup.sessionId,
      access_token: accessToken,
      service_code: "labs_review_written",
      service_topic: "labs",
      message: "override attempt",
      price_credits: 1,
      credits: 1,
      reserved_credits: 999,
      charged_credits: 999,
      meeting_format: "offline",
    });
    assert(override.status === 200 && override.data.ok, "canonical Body request accepts valid service despite override fields");
    const overrideId = override.data.request.id;
    cleanup.requestIds.push(overrideId);
    const { data: overrideRow } = await supabase.from("service_requests").select("service_code, service_topic, meeting_format, price_credits, reserved_credits, charged_credits").eq("id", overrideId).single();
    assert(overrideRow?.service_code === "labs_review_written" && overrideRow.service_topic === "labs", "override attempt keeps canonical code/topic");
    assert(overrideRow?.meeting_format === "text" && overrideRow.price_credits === 15000, "override attempt keeps canonical format/price");
    assert(overrideRow?.reserved_credits === 0 && overrideRow.charged_credits === 0, "override attempt keeps zero financial fields");

    const { data: walletAfter } = cleanup.walletId
      ? await supabase.from("usage_wallets").select("balance, total_used").eq("id", cleanup.walletId).single()
      : { data: null };
    const capturedAmount = 15000 + 20000 + 40000;
    assert(walletAfter?.balance === (walletBefore?.balance || 0) - capturedAmount && walletAfter?.total_used === capturedAmount, "wallet reflects captures without reserve double-charge");

    await specialistContext.close();
    await patientContext.close();
  } finally {
    await browser.close();
    if (cleanup.walletId) await supabase.from("usage_reservations").delete().eq("wallet_id", cleanup.walletId);
    if (cleanup.walletId) await supabase.from("usage_ledger").delete().eq("wallet_id", cleanup.walletId);
    for (const id of cleanup.requestIds) await supabase.from("service_requests").delete().eq("id", id);
    for (const code of cleanup.serviceCodes) await supabase.from("service_pricing").delete().eq("service_code", code);
    if (cleanup.assignmentId) await supabase.from("patient_assignments").delete().eq("id", cleanup.assignmentId);
    if (cleanup.onboardingId) await supabase.from("body_onboarding").delete().eq("id", cleanup.onboardingId);
    if (cleanup.bodyClientId) await supabase.from("body_clients").delete().eq("id", cleanup.bodyClientId);
    if (cleanup.sessionId) await supabase.from("sessions").delete().eq("session_id", cleanup.sessionId);
    if (cleanup.walletId) await supabase.from("usage_wallets").delete().eq("id", cleanup.walletId);
    if (cleanup.specialistSessionId) await supabase.from("specialist_sessions").delete().eq("id", cleanup.specialistSessionId);
    if (cleanup.expertId) {
      await supabase.from("specialist_sessions").delete().eq("expert_id", cleanup.expertId);
      await supabase.from("experts").delete().eq("id", cleanup.expertId);
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`Body pricing browser E2E: ${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) process.exitCode = 1;
}

function pagePrompt(page, value) {
  page.once("dialog", (dialog) => dialog.accept(value));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
