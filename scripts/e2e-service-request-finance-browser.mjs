import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const BASE_URL = process.env.E2E_BASE_URL || "https://tochka-opori-test.vercel.app";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PROJECT_REF = "eehyehlhiyztciaezaus";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Set TEST Supabase environment variables.");
if (!SUPABASE_URL.includes(TEST_PROJECT_REF) || !BASE_URL.includes("tochka-opori-test.vercel.app")) {
  throw new Error("Refusing to run service-request finance E2E outside TEST.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const cleanup = { requestIds: [], ownerIds: [], ledgerWalletId: null, walletId: null, sessionId: null, bodyClientId: null, onboardingId: null, assignmentId: null, expertId: null, specialistSessionId: null };
const results = [];

function assert(condition, message) {
  results.push({ message, ok: Boolean(condition) });
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

async function waitForRequest(id, expectedStatus) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await supabase.from("service_requests").select("*").eq("id", id).single();
    if (result.data?.status === expectedStatus) return result.data;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return (await supabase.from("service_requests").select("*").eq("id", id).single()).data;
}

async function specialistAction(page, title, buttonName, promptValue) {
  await page.getByTestId("service-requests-section").getByRole("button", { name: "Обновить" }).click();
  const card = page.locator('[data-testid="service-request-card"]').filter({ hasText: title }).first();
  await card.waitFor({ state: "visible", timeout: 15000 });
  if (promptValue) page.once("dialog", (dialog) => dialog.accept(promptValue));
  await card.getByRole("button", { name: buttonName }).click();
  return card;
}

async function createRequest({ title, price, ownerId, sessionId, specialistId, module = "body", ownerType = "anonymous_profile", serviceCode = "health_online_consultation", serviceTopic = "labs", meetingFormat = "video", requestType = "video_call", reservedCredits = 0 }) {
  const { data, error } = await supabase.from("service_requests").insert({
    owner_type: ownerType,
    owner_id: ownerId,
    module,
    session_id: sessionId,
    specialist_id: specialistId,
    specialist_name: "TEST finance specialist",
    request_type: requestType,
    service_code: serviceCode,
    service_topic: serviceTopic,
    meeting_format: meetingFormat,
    title,
    message: "TEST financial lifecycle request",
    status: "submitted",
    price_credits: price,
    reserved_credits: reservedCredits,
    charged_credits: 0,
    client_contact: {},
  }).select("id").single();
  if (error) throw error;
  cleanup.requestIds.push(data.id);
  return data.id;
}

async function transitionRequest(requestId, transition, extra = {}) {
  const { data, error } = await supabase.rpc("transition_service_request", {
    p_request_id: requestId,
    p_transition: transition,
    ...extra,
  });
  if (error) throw error;
  return data;
}

async function main() {
  cleanup.sessionId = `e2e-finance-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const ownerId = crypto.randomUUID();
  cleanup.ownerIds.push(ownerId);
  const expertCode = `E2E-FINANCE-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const publicCode = `E2E-FINANCE-${Date.now()}`;

  const { data: expert, error: expertError } = await supabase.from("experts").insert({
    name: "TEST finance specialist",
    role: "doctor",
    specialty: "TEST",
    access_code: expertCode,
    is_active: true,
    allowed_modules: ["body"],
  }).select("id").single();
  if (expertError) throw expertError;
  cleanup.expertId = expert.id;

  const specialistRawToken = crypto.randomBytes(32).toString("hex");
  const specialistHash = crypto.createHash("sha256").update(specialistRawToken).digest("hex");
  const { data: specialistSession, error: specialistSessionError } = await supabase.from("specialist_sessions").insert({
    expert_id: expert.id,
    token_hash: specialistHash,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  }).select("id").single();
  if (specialistSessionError) throw specialistSessionError;
  cleanup.specialistSessionId = specialistSession.id;

  const { error: sessionError } = await supabase.from("sessions").insert({
    session_id: cleanup.sessionId,
    module: "body",
    anonymous_owner_id: ownerId,
    public_code: publicCode,
    patient_text: "",
    conversation_history: [],
    json_data: {},
    legacy_access: false,
  });
  if (sessionError) throw sessionError;
  const { generateSessionAccessToken } = await import("../lib/security/access-token.js");
  const accessToken = await generateSessionAccessToken(cleanup.sessionId, { module: "body", anonymousOwnerId: ownerId, publicCode });
  if (!accessToken) throw new Error("Could not generate Body access token");

  const { data: bodyClient, error: bodyClientError } = await supabase.from("body_clients").insert({
    session_id: cleanup.sessionId,
    anonymous_owner_id: ownerId,
    display_name: "TEST finance patient",
    source: "e2e_phase11d",
    status: "active",
  }).select("id").single();
  if (bodyClientError) throw bodyClientError;
  cleanup.bodyClientId = bodyClient.id;

  const { data: onboarding, error: onboardingError } = await supabase.from("body_onboarding").insert({ owner_type: "anonymous_profile", owner_id: ownerId, intro_completed: true }).select("id").single();
  if (onboardingError) throw onboardingError;
  cleanup.onboardingId = onboarding.id;
  const { data: assignment, error: assignmentError } = await supabase.from("patient_assignments").insert({ owner_type: "anonymous_profile", owner_id: ownerId, primary_expert_id: expert.id, module: "body", status: "active", source: "e2e_phase11d" }).select("id").single();
  if (assignmentError) throw assignmentError;
  cleanup.assignmentId = assignment.id;

  const { ensureWallet, getWallet } = await import("../lib/usage/wallet.js");
  const wallet = await ensureWallet({ ownerType: "anonymous_profile", ownerId, module: "body" });
  if (!wallet) throw new Error("Could not create test wallet");
  cleanup.walletId = wallet.id;
  cleanup.ledgerWalletId = wallet.id;
  await supabase.from("usage_wallets").update({ balance: 22000, refill_mode: "disabled" }).eq("id", wallet.id);

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const specialistContext = await browser.newContext();
    await specialistContext.addCookies([{ name: "tochka_specialist_session", value: specialistRawToken, domain: "tochka-opori-test.vercel.app", path: "/api/specialist", httpOnly: true, secure: true, sameSite: "Lax" }]);
    const specialist = await specialistContext.newPage();
    await specialist.goto(`${BASE_URL}/specialist`, { waitUntil: "networkidle", timeout: 30000 });
    await specialist.waitForSelector('[data-testid="specialist-cabinet"]', { timeout: 15000 });

    const insufficientId = await createRequest({ title: "TEST insufficient request", price: 40000, ownerId, sessionId: cleanup.sessionId, specialistId: expert.id });
    const insufficientCard = await specialistAction(specialist, "TEST insufficient request", "Принять");
    const insufficientFeedback = insufficientCard.getByTestId("service-request-feedback");
    await insufficientFeedback.getByText("Недостаточно кредитов у клиента", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
    assert(true, "insufficient accept shows readable card feedback");
    const insufficient = await waitForRequest(insufficientId, "submitted");
    const insufficientWallet = await getWallet({ ownerType: "anonymous_profile", ownerId, module: "body" });
    const insufficientReservation = await supabase.from("usage_reservations").select("id").eq("service_request_id", insufficientId).maybeSingle();
    assert(insufficient.status === "submitted", "insufficient accept keeps request submitted");
    assert(insufficientWallet.balance === 22000 && insufficientReservation.data === null, "insufficient accept leaves wallet and reservation unchanged");

    // First-wallet initialization is committed even when the reserve is
    // rejected, and a retry cannot create another starting grant.
    const firstWalletOwnerId = crypto.randomUUID();
    cleanup.ownerIds.push(firstWalletOwnerId);
    const firstWalletRequestId = await createRequest({ title: "TEST first wallet request A", price: 40000, ownerId: firstWalletOwnerId, sessionId: cleanup.sessionId, specialistId: expert.id });
    const secondWalletRequestId = await createRequest({ title: "TEST first wallet request B", price: 40000, ownerId: firstWalletOwnerId, sessionId: cleanup.sessionId, specialistId: expert.id });
    const firstWalletResults = await Promise.all([
      transitionRequest(firstWalletRequestId, "accept"),
      transitionRequest(secondWalletRequestId, "accept"),
    ]);
    const firstWallet = await supabase.from("usage_wallets").select("id, balance, total_used").eq("owner_id", firstWalletOwnerId).eq("module", "body").single();
    const firstInitialLedger = firstWallet.data
      ? await supabase.from("usage_ledger").select("id").eq("wallet_id", firstWallet.data.id).eq("entry_type", "initial_credit")
      : { data: [] };
    const firstFinancialLedger = firstWallet.data
      ? await supabase.from("usage_ledger").select("entry_type").eq("wallet_id", firstWallet.data.id).in("entry_type", ["service_request_reserve", "service_request_capture", "service_request_release"])
      : { data: [] };
    assert(firstWalletResults.every((result) => result.code === "INSUFFICIENT_CREDITS"), "concurrent first requests return insufficient credits");
    assert(firstWallet.data?.balance === 22000 && firstWallet.data?.total_used === 0, "first expensive request preserves initialized wallet");
    assert((firstInitialLedger.data || []).length === 1, "first wallet has exactly one initial credit event");
    assert((firstFinancialLedger.data || []).length === 0, "insufficient accept creates no service financial events");
    const firstReservations = await supabase.from("usage_reservations").select("id", { count: "exact", head: true }).in("service_request_id", [firstWalletRequestId, secondWalletRequestId]);
    assert(firstReservations.count === 0, "concurrent insufficient accepts create no reservations");
    await transitionRequest(firstWalletRequestId, "accept");
    const firstInitialRetry = await supabase.from("usage_ledger").select("id").eq("wallet_id", firstWallet.data.id).eq("entry_type", "initial_credit");
    assert((firstInitialRetry.data || []).length === 1, "retry does not duplicate initial credit");

    await supabase.from("usage_wallets").update({ balance: 60000 }).eq("id", wallet.id);
    const reserveId = await createRequest({ title: "TEST reserve request", price: 40000, ownerId, sessionId: cleanup.sessionId, specialistId: expert.id });
    await specialistAction(specialist, "TEST reserve request", "Принять");
    const reserved = await waitForRequest(reserveId, "accepted");
    const reserveRow = await supabase.from("usage_reservations").select("id, amount, status").eq("service_request_id", reserveId).single();
    assert(reserved.reserved_credits === 40000 && reserved.charged_credits === 0, "successful accept stores request reserve snapshot");
    assert(reserveRow.data?.amount === 40000 && reserveRow.data.status === "active", "successful accept creates active reservation");
    assert((await getWallet({ ownerType: "anonymous_profile", ownerId, module: "body" })).balance === 20000, "reserve reduces available wallet balance");
    assert((await transitionRequest(reserveId, "accept")).idempotent_replay === true, "double accept is idempotent");

    const clientContext = await browser.newContext();
    await clientContext.addInitScript(({ sessionId, accessToken }) => {
      localStorage.setItem("body_last_session_id", sessionId);
      localStorage.setItem("body_last_access_token", accessToken);
    }, { sessionId: cleanup.sessionId, accessToken });
    const client = await clientContext.newPage();
    await client.goto(`${BASE_URL}/?module=body`, { waitUntil: "networkidle", timeout: 30000 });
    await client.getByText("Баланс", { exact: false }).waitFor({ state: "visible", timeout: 15000 });
    const walletText = await client.textContent("body");
    assert(walletText.includes("Доступно") && walletText.includes("Резерв"), "client wallet UI displays balance, reserved and available credits");
    const cancelClientRequest = (requestId) => client.evaluate(async ({ sessionId, accessToken, requestId: id }) => {
      const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancelBodyServiceRequest", session_id: sessionId, access_token: accessToken, request_id: id }) });
      return { status: response.status, data: await response.json() };
    }, { sessionId: cleanup.sessionId, accessToken, requestId });
    const cancelResult = await cancelClientRequest(reserveId);
    assert(cancelResult.status === 200 && cancelResult.data.ok, "client cancellation uses canonical release transition");
    await waitForRequest(reserveId, "cancelled");
    assert((await getWallet({ ownerType: "anonymous_profile", ownerId, module: "body" })).balance === 60000, "release restores available wallet balance");
    assert((await supabase.from("usage_reservations").select("status").eq("service_request_id", reserveId).single()).data?.status === "released", "release marks reservation released");
    assert((await transitionRequest(reserveId, "cancel")).idempotent_replay === true, "double cancel is idempotent");

    const submittedClientCancelId = await createRequest({ title: "TEST submitted client cancel", price: 40000, ownerId, sessionId: cleanup.sessionId, specialistId: expert.id });
    const submittedCancelResult = await client.evaluate(async ({ sessionId, accessToken, requestId }) => {
      const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancelBodyServiceRequest", session_id: sessionId, access_token: accessToken, request_id: requestId }) });
      return { status: response.status, data: await response.json() };
    }, { sessionId: cleanup.sessionId, accessToken, requestId: submittedClientCancelId });
    const submittedClientCancel = await waitForRequest(submittedClientCancelId, "cancelled");
    const submittedClientReservation = await supabase.from("usage_reservations").select("id").eq("service_request_id", submittedClientCancelId).maybeSingle();
    assert(submittedCancelResult.status === 200 && submittedCancelResult.data.ok, "client can cancel an owned submitted request");
    assert(submittedClientCancel.status === "cancelled" && submittedClientReservation.data === null, "submitted client cancellation has no financial mutation");

    const clarificationCancelId = await createRequest({ title: "TEST clarification client cancel", price: 40000, ownerId, sessionId: cleanup.sessionId, specialistId: expert.id });
    await transitionRequest(clarificationCancelId, "accept");
    await transitionRequest(clarificationCancelId, "needs_clarification", { p_specialist_response: "TEST clarification" });
    const clarificationCancelResult = await cancelClientRequest(clarificationCancelId);
    const clarificationCancelled = await waitForRequest(clarificationCancelId, "cancelled");
    const clarificationReservation = await supabase.from("usage_reservations").select("status").eq("service_request_id", clarificationCancelId).single();
    assert(clarificationCancelResult.status === 200 && clarificationCancelled.status === "cancelled" && clarificationReservation.data?.status === "released", "client cancellation releases a clarification reservation");

    const scheduledCancelId = await createRequest({ title: "TEST scheduled client cancel", price: 40000, ownerId, sessionId: cleanup.sessionId, specialistId: expert.id });
    await transitionRequest(scheduledCancelId, "accept");
    await transitionRequest(scheduledCancelId, "schedule", { p_scheduled_at: new Date(Date.now() + 86400000).toISOString() });
    const scheduledCancelResult = await cancelClientRequest(scheduledCancelId);
    const scheduledCancelled = await waitForRequest(scheduledCancelId, "cancelled");
    const scheduledReservation = await supabase.from("usage_reservations").select("status").eq("service_request_id", scheduledCancelId).single();
    assert(scheduledCancelResult.status === 200 && scheduledCancelled.status === "cancelled" && scheduledReservation.data?.status === "released", "client cancellation releases a scheduled reservation");

    const answeredCancelId = await createRequest({ title: "TEST answered cancel", price: 40000, ownerId, sessionId: cleanup.sessionId, specialistId: expert.id });
    await transitionRequest(answeredCancelId, "accept");
    await transitionRequest(answeredCancelId, "answer", { p_specialist_response: "TEST answered response" });
    const answeredCancelResult = await cancelClientRequest(answeredCancelId);
    const answeredReservation = await supabase.from("usage_reservations").select("status").eq("service_request_id", answeredCancelId).single();
    assert(answeredCancelResult.status === 400 && answeredReservation.data?.status === "active", "answered client cancellation is rejected and keeps reservation active");
    assert((await transitionRequest(answeredCancelId, "complete")).ok, "answered request completes after rejected cancellation");

    // Support and Body wallets remain separate even when an owner UUID is
    // deliberately reused across the two canonical owner namespaces.
    const isolationOwnerId = crypto.randomUUID();
    cleanup.ownerIds.push(isolationOwnerId);
    const supportWallet = await ensureWallet({ ownerType: "anonymous_case", ownerId: isolationOwnerId, module: "support" });
    const bodyWallet = await ensureWallet({ ownerType: "anonymous_profile", ownerId: isolationOwnerId, module: "body" });
    const supportRequestId = await createRequest({ title: "TEST support isolation", price: 10000, ownerId: isolationOwnerId, sessionId: cleanup.sessionId, specialistId: expert.id, module: "support", ownerType: "anonymous_case", serviceCode: "short_followup", serviceTopic: null, meetingFormat: "text", requestType: "question" });
    const supportAccepted = await transitionRequest(supportRequestId, "accept");
    const supportAfterAccept = await getWallet({ ownerType: "anonymous_case", ownerId: isolationOwnerId, module: "support" });
    const bodyAfterSupportAccept = await getWallet({ ownerType: "anonymous_profile", ownerId: isolationOwnerId, module: "body" });
    assert(supportWallet.id !== bodyWallet.id, "Support and Body use distinct wallets for the same UUID");
    assert(supportAccepted.ok && supportAfterAccept.balance === 12000 && bodyAfterSupportAccept.balance === 22000, "Support reserve cannot debit the Body wallet");
    await transitionRequest(supportRequestId, "cancel");
    assert((await getWallet({ ownerType: "anonymous_case", ownerId: isolationOwnerId, module: "support" })).balance === 22000, "Support release restores only the Support wallet");

    await supabase.from("usage_wallets").update({ balance: 60000 }).eq("id", wallet.id);
    const snapshotId = await createRequest({ title: "TEST price snapshot", price: 40001, ownerId, sessionId: cleanup.sessionId, specialistId: expert.id });
    assert((await transitionRequest(snapshotId, "accept")).ok, "price snapshot request accepts");
    const snapshotReservation = await supabase.from("usage_reservations").select("amount").eq("service_request_id", snapshotId).single();
    assert(snapshotReservation.data?.amount === 40001, "reserve uses request price snapshot, not current tariff");
    await transitionRequest(snapshotId, "cancel");

    const legacyId = await createRequest({ title: "TEST legacy request", price: null, ownerId, sessionId: cleanup.sessionId, specialistId: expert.id, serviceCode: null, serviceTopic: null, meetingFormat: "text", requestType: "text_question", reservedCredits: 700 });
    assert((await transitionRequest(legacyId, "accept")).ok, "legacy request keeps status-only accept behavior");
    assert((await transitionRequest(legacyId, "answer", { p_specialist_response: "TEST legacy answer" })).ok, "legacy request supports status-only answer");
    assert((await transitionRequest(legacyId, "complete")).ok, "legacy request supports status-only completion");
    const legacyReservation = await supabase.from("usage_reservations").select("id").eq("service_request_id", legacyId).maybeSingle();
    const legacyEvents = await supabase.from("usage_ledger").select("id").eq("wallet_id", wallet.id).in("entry_type", ["service_request_reserve", "service_request_capture", "service_request_release"]).like("request_id", `service-request-${legacyId}:%`);
    assert(legacyReservation.data === null && (legacyEvents.data || []).length === 0, "legacy lifecycle creates no reservation or financial event");

    const zeroPriceId = await createRequest({ title: "TEST zero price request", price: 0, ownerId, sessionId: cleanup.sessionId, specialistId: expert.id, serviceCode: "zero_price_fixture" });
    const zeroPriceResult = await transitionRequest(zeroPriceId, "accept");
    const zeroPriceReservation = await supabase.from("usage_reservations").select("id").eq("service_request_id", zeroPriceId).maybeSingle();
    assert(zeroPriceResult.code === "FINANCIAL_INCONSISTENCY" && zeroPriceReservation.data === null, "zero-price pricing snapshot is rejected without financial mutation");

    // Two concurrent reserves against 50,000 available credits must serialize
    // on the wallet row: one succeeds and one returns insufficient credits.
    await supabase.from("usage_wallets").update({ balance: 50000 }).eq("id", wallet.id);
    const concurrentA = await createRequest({ title: "TEST concurrent A", price: 40000, ownerId, sessionId: cleanup.sessionId, specialistId: expert.id });
    const concurrentB = await createRequest({ title: "TEST concurrent B", price: 40000, ownerId, sessionId: cleanup.sessionId, specialistId: expert.id });
    const concurrentResults = await Promise.all([transitionRequest(concurrentA, "accept"), transitionRequest(concurrentB, "accept")]);
    assert(concurrentResults.filter((result) => result.ok).length === 1, "concurrent expensive requests have one successful reserve");
    assert(concurrentResults.filter((result) => result.code === "INSUFFICIENT_CREDITS").length === 1, "concurrent expensive requests reject the second reserve");
    assert((await getWallet({ ownerType: "anonymous_profile", ownerId, module: "body" })).balance === 10000, "concurrent reserves never make balance negative");
    const concurrentReservations = await supabase.from("usage_reservations").select("id", { count: "exact", head: true }).in("service_request_id", [concurrentA, concurrentB]);
    assert(concurrentReservations.count === 1, "concurrent requests create exactly one reservation");
    const concurrentAcceptedId = concurrentResults[0].ok ? concurrentA : concurrentB;
    await transitionRequest(concurrentAcceptedId, "cancel");
    assert((await supabase.from("usage_reservations").select("id", { count: "exact", head: true }).eq("service_request_id", concurrentAcceptedId)).count === 1, "concurrent winner has one reservation");

    const captureId = await createRequest({ title: "TEST capture request", price: 40000, ownerId, sessionId: cleanup.sessionId, specialistId: expert.id });
    await specialistAction(specialist, "TEST capture request", "Принять");
    await waitForRequest(captureId, "accepted");
    await specialistAction(specialist, "TEST capture request", "Ответить", "TEST capture answer");
    await waitForRequest(captureId, "answered");
    await specialistAction(specialist, "TEST capture request", "Завершить");
    const captured = await waitForRequest(captureId, "completed");
    const captureReservation = await supabase.from("usage_reservations").select("status, amount").eq("service_request_id", captureId).single();
    const capturedWallet = await getWallet({ ownerType: "anonymous_profile", ownerId, module: "body" });
    assert(captured.reserved_credits === 0 && captured.charged_credits === 40000, "capture updates request financial snapshots");
    assert(captureReservation.data?.status === "captured" && captureReservation.data.amount === 40000, "capture marks reservation captured");
    assert(capturedWallet.total_used === 80000 && capturedWallet.balance === 10000, "capture increments total_used once and leaves available balance");
    assert((await transitionRequest(captureId, "complete")).idempotent_replay === true, "double complete is idempotent");
    const captureEvents = await supabase.from("usage_ledger").select("id").eq("wallet_id", wallet.id).eq("entry_type", "service_request_capture").eq("request_id", `service-request-${captureId}:capture`);
    assert((captureEvents.data || []).length === 1, "double complete creates one capture ledger event");

    await clientContext.close();
    await specialistContext.close();
  } finally {
    await browser.close();
    if (cleanup.ledgerWalletId) await supabase.from("usage_reservations").delete().eq("wallet_id", cleanup.ledgerWalletId);
    if (cleanup.ledgerWalletId) await supabase.from("usage_ledger").delete().eq("wallet_id", cleanup.ledgerWalletId);
    for (const ownerId of cleanup.ownerIds.slice(1)) {
      const { data: wallets } = await supabase.from("usage_wallets").select("id").eq("owner_id", ownerId);
      for (const extraWallet of wallets || []) {
        await supabase.from("usage_reservations").delete().eq("wallet_id", extraWallet.id);
        await supabase.from("usage_ledger").delete().eq("wallet_id", extraWallet.id);
      }
    }
    for (const id of cleanup.requestIds) await supabase.from("service_requests").delete().eq("id", id);
    if (cleanup.assignmentId) await supabase.from("patient_assignments").delete().eq("id", cleanup.assignmentId);
    if (cleanup.onboardingId) await supabase.from("body_onboarding").delete().eq("id", cleanup.onboardingId);
    if (cleanup.bodyClientId) await supabase.from("body_clients").delete().eq("id", cleanup.bodyClientId);
    if (cleanup.sessionId) await supabase.from("sessions").delete().eq("session_id", cleanup.sessionId);
    if (cleanup.walletId) await supabase.from("usage_wallets").delete().eq("id", cleanup.walletId);
    for (const ownerId of cleanup.ownerIds.slice(1)) {
      const { data: wallets } = await supabase.from("usage_wallets").select("id").eq("owner_id", ownerId);
      for (const extraWallet of wallets || []) {
        await supabase.from("usage_wallets").delete().eq("id", extraWallet.id);
      }
    }
    if (cleanup.specialistSessionId) await supabase.from("specialist_sessions").delete().eq("id", cleanup.specialistSessionId);
    if (cleanup.expertId) await supabase.from("experts").delete().eq("id", cleanup.expertId);
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`Service request finance browser E2E: ${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
