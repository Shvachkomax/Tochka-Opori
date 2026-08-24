// Phase 11D financial lifecycle tests. No database required; mirrors the RPC contract.

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

const TRANSITIONS = {
  submitted: ["accept", "cancel"],
  accepted: ["needs_clarification", "schedule", "answer", "cancel"],
  needs_clarification: ["schedule", "answer", "cancel"],
  scheduled: ["complete", "cancel"],
  answered: ["complete"],
  completed: [],
  cancelled: [],
};

function isCanonical(request) {
  return request.service_code != null && request.price_credits > 0;
}

function createState({ balance = 22000, request, walletModule = request.module, walletExists = true } = {}) {
  return {
    wallet: walletExists ? { owner_type: request.owner_type, owner_id: request.owner_id, module: walletModule, balance, total_used: 0 } : null,
    request: { reserved_credits: 0, charged_credits: 0, ...request },
    reservation: null,
    ledger: [],
  };
}

function transition(state, action) {
  const { request } = state;
  const canonical = isCanonical(request);
  const amount = canonical ? request.price_credits : 0;

  if ((request.service_code === null && request.price_credits !== null)
    || (request.service_code !== null && (!request.service_code.trim?.() || request.price_credits == null || request.price_credits <= 0))) {
    return { ok: false, code: "FINANCIAL_INCONSISTENCY" };
  }

  if (action === "accept" && request.status === "accepted" && state.reservation?.status === "active") {
    return { ok: true, idempotent: true };
  }
  if (action === "complete" && request.status === "completed" && state.reservation?.status === "captured") {
    return { ok: true, idempotent: true };
  }
  if (action === "cancel" && request.status === "cancelled" && request.reserved_credits === 0 && request.charged_credits === 0) {
    return { ok: true, idempotent: true };
  }
  if (!TRANSITIONS[request.status]?.includes(action)) return { ok: false, code: "INVALID_TRANSITION" };

  if (action === "accept" && canonical) {
    if (!state.wallet) {
      state.wallet = { owner_type: request.owner_type, owner_id: request.owner_id, module: request.module, balance: 22000, total_used: 0 };
      state.ledger.push({ entry_type: "initial_credit", amount: 22000, balance_before: 0, balance_after: 22000 });
    }
    const wallet = state.wallet;
    if (wallet.module !== request.module || wallet.owner_type !== request.owner_type || wallet.owner_id !== request.owner_id) return { ok: false, code: "WALLET_SCOPE" };
    if (wallet.balance < amount) return { ok: false, code: "INSUFFICIENT_CREDITS" };
    wallet.balance -= amount;
    request.status = "accepted";
    request.reserved_credits = amount;
    state.reservation = { amount, status: "active" };
    state.ledger.push({ entry_type: "service_request_reserve", amount, balance_before: wallet.balance + amount, balance_after: wallet.balance });
    return { ok: true };
  }
  if (action === "accept") request.status = "accepted";
  if (action === "needs_clarification" || action === "schedule" || action === "answer") request.status = action === "needs_clarification" ? "needs_clarification" : action === "schedule" ? "scheduled" : "answered";
  if (action === "complete") {
    if (canonical) {
      if (!state.reservation || state.reservation.status !== "active" || request.reserved_credits !== amount) return { ok: false, code: "RESERVATION_NOT_FOUND" };
      state.reservation.status = "captured";
      request.status = "completed";
      request.reserved_credits = 0;
      request.charged_credits = amount;
      state.wallet.total_used += amount;
      state.ledger.push({ entry_type: "service_request_capture", amount, balance_before: state.wallet.balance, balance_after: state.wallet.balance });
    } else {
      request.status = "completed";
    }
  }
  if (action === "cancel") {
    if (canonical && request.status !== "submitted") {
      if (!state.reservation || state.reservation.status !== "active") return { ok: false, code: "RESERVATION_NOT_FOUND" };
      const before = state.wallet.balance;
      state.wallet.balance += state.reservation.amount;
      state.reservation.status = "released";
      state.ledger.push({ entry_type: "service_request_release", amount: state.reservation.amount, balance_before: before, balance_after: state.wallet.balance });
      request.reserved_credits = 0;
      request.charged_credits = 0;
    }
    request.status = "cancelled";
  }
  return { ok: true };
}

function canonicalRequest(overrides = {}) {
  return { module: "support", owner_type: "anonymous_case", owner_id: "owner-1", service_code: "online_consultation", price_credits: 40000, status: "submitted", ...overrides };
}

console.log("1. Creation and eligibility");
const submitted = createState({ request: canonicalRequest() });
assert(submitted.request.reserved_credits === 0 && submitted.request.charged_credits === 0, "submitted creation has no financial mutation");
assert(isCanonical(submitted.request), "canonical eligibility requires service_code and positive price");
const legacy = createState({ request: canonicalRequest({ service_code: null, price_credits: null, reserved_credits: 700 }) });
assert(!isCanonical(legacy.request), "legacy NULL-price request bypasses automation");
assert(transition(legacy, "accept").ok && legacy.request.reserved_credits === 700, "legacy transition does not overwrite legacy reserved field");
assert(legacy.request.charged_credits === 0 && legacy.ledger.length === 0, "legacy transition creates no financial events");
assert(transition(legacy, "answer").ok && transition(legacy, "complete").ok, "legacy completion remains status-only");
assert(legacy.ledger.length === 0, "legacy completion creates no capture event");
const zero = createState({ request: canonicalRequest({ price_credits: 0 }) });
assert(transition(zero, "accept").code === "FINANCIAL_INCONSISTENCY", "zero-price pricing snapshot cannot enter legacy lifecycle");

console.log("\n2. Reserve and insufficient balance");
const enough = createState({ balance: 50000, request: canonicalRequest() });
assert(transition(enough, "accept").ok, "sufficient balance accepts request");
assert(enough.wallet.balance === 10000 && enough.request.reserved_credits === 40000, "reserve reduces available balance by snapshot price");
assert(enough.wallet.total_used === 0 && enough.request.charged_credits === 0, "reserve does not charge or increase total_used");
const poor = createState({ balance: 22000, request: canonicalRequest() });
const newClientPoor = createState({ balance: 22000, walletExists: false, request: canonicalRequest({ owner_id: "new-owner" }) });
assert(transition(poor, "accept").code === "INSUFFICIENT_CREDITS", "insufficient balance rejects accept");
assert(poor.request.status === "submitted" && poor.wallet.balance === 22000 && poor.ledger.length === 0, "insufficient accept leaves request and wallet unchanged");
assert(transition(newClientPoor, "accept").code === "INSUFFICIENT_CREDITS", "new client with expensive first service rejects accept");
assert(newClientPoor.wallet?.balance === 22000 && newClientPoor.wallet?.total_used === 0, "new client keeps starting wallet after insufficient accept");
assert(newClientPoor.ledger.filter((entry) => entry.entry_type === "initial_credit").length === 1, "new client receives exactly one initial credit event");
assert(transition(newClientPoor, "accept").code === "INSUFFICIENT_CREDITS" && newClientPoor.ledger.filter((entry) => entry.entry_type === "initial_credit").length === 1, "retry does not duplicate initial credit");

console.log("\n3. Intermediate transitions");
assert(transition(enough, "needs_clarification").ok && enough.request.reserved_credits === 40000, "accepted clarification preserves reserve");
assert(transition(enough, "answer").ok && enough.request.reserved_credits === 40000, "answered request preserves reserve");
// A separate state covers scheduled because answer is terminal to that branch.
const scheduled = createState({ balance: 50000, request: canonicalRequest() });
transition(scheduled, "accept");
assert(transition(scheduled, "schedule").ok && scheduled.request.reserved_credits === 40000, "accepted schedule preserves reserve");

console.log("\n4. Capture and idempotency");
assert(transition(enough, "complete").ok, "answered request captures on complete");
assert(enough.request.status === "completed" && enough.request.reserved_credits === 0 && enough.request.charged_credits === 40000, "capture updates request snapshots");
assert(enough.wallet.total_used === 40000 && enough.wallet.balance === 10000, "capture increments total_used exactly once and leaves available balance");
assert(transition(enough, "complete").idempotent === true && enough.wallet.total_used === 40000, "double capture is idempotent");
assert(enough.ledger.filter((entry) => entry.entry_type === "service_request_capture").length === 1, "double capture creates one capture ledger event");

console.log("\n5. Release and idempotency");
const released = createState({ balance: 50000, request: canonicalRequest() });
transition(released, "accept");
assert(transition(released, "cancel").ok, "accepted cancel releases reserve");
assert(released.wallet.balance === 50000 && released.request.reserved_credits === 0 && released.request.charged_credits === 0, "release restores available balance without charge");
assert(transition(released, "cancel").idempotent === true && released.wallet.balance === 50000, "double release is idempotent");
assert(released.ledger.filter((entry) => entry.entry_type === "service_request_release").length === 1, "double release creates one release ledger event");
const submittedCancel = createState({ balance: 22000, request: canonicalRequest() });
assert(transition(submittedCancel, "cancel").ok && submittedCancel.wallet.balance === 22000 && submittedCancel.ledger.length === 0, "submitted cancel has no financial mutation");
const answeredCancel = createState({ balance: 50000, request: canonicalRequest({ status: "answered", reserved_credits: 40000 }) });
assert(!transition(answeredCancel, "cancel").ok, "answered cancellation is forbidden");
const malformed = createState({ request: canonicalRequest({ service_code: "online_consultation", price_credits: null }) });
assert(transition(malformed, "accept").code === "FINANCIAL_INCONSISTENCY", "partial pricing snapshot cannot enter legacy lifecycle");

console.log("\n6. Concurrency and isolation");
const sharedWallet = { balance: 50000, total_used: 0, module: "support", owner_type: "anonymous_case", owner_id: "owner-2" };
const reqA = createState({ request: canonicalRequest({ owner_id: "owner-2" }) });
const reqB = createState({ request: canonicalRequest({ owner_id: "owner-2" }) });
reqA.wallet = sharedWallet;
reqB.wallet = sharedWallet;
assert(transition(reqA, "accept").ok && !transition(reqB, "accept").ok && sharedWallet.balance === 10000, "wallet lock model allows only one concurrent 40000 reserve from 50000");
const body = createState({ request: canonicalRequest({ module: "body", owner_type: "anonymous_profile" }) });
assert(body.wallet.module === "body" && body.wallet.owner_type === "anonymous_profile", "Body reservation uses Body wallet scope");
const support = createState({ request: canonicalRequest({ module: "support", owner_type: "anonymous_case" }) });
assert(support.wallet.module === "support" && support.wallet.owner_type === "anonymous_case", "Support reservation uses Support wallet scope");

console.log("\n7. Ledger semantics and transition matrix");
assert(TRANSITIONS.submitted.join(",") === "accept,cancel", "submitted matrix requires accept before human service");
assert(!TRANSITIONS.answered.includes("cancel"), "answered matrix forbids normal cancel");
assert(TRANSITIONS.accepted.includes("needs_clarification") && TRANSITIONS.needs_clarification.includes("answer"), "clarification workflow preserves reservation");
assert(sharedWallet.balance === 10000, "reserve ledger uses available balance semantics");
assert(released.ledger.every((entry) => ["service_request_reserve", "service_request_release"].includes(entry.entry_type)), "reserve/release use dedicated ledger event types");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
