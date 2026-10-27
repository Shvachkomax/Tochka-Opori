// Pure accounting foundation. Inputs must come from verified server-side records.
// Not connected to wallets or payouts until transactional persistence is installed.
export const DEFAULT_PARTNER_RATE_BPS = 2500;

function integer(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}`);
  return BigInt(value);
}

function ratio(amount, numerator, denominator) {
  return Number(amount * numerator / denominator);
}

// Cumulative allocation avoids losing fractions on many small debits. A package
// stores its actual price after discounts, never a mutable global token/RUB rate.
export function allocatedRevenueKopecks({ paidKopecks, packageCredits, consumedCredits }) {
  const price = integer(paidKopecks, "paidKopecks");
  const total = integer(packageCredits, "packageCredits");
  const used = integer(consumedCredits, "consumedCredits");
  if (!total || used > total) throw new Error("Invalid package consumption");
  return ratio(price, used, total);
}

// One bucket per attachment + rate version + funding kind + module + pilot.
// The persisted cumulative base must already include any reversals.
export function calculatePartnerAccrual({ fundingKind, previousBase, nextBase, rateBps = DEFAULT_PARTNER_RATE_BPS }) {
  if (!["test", "paid", "bonus"].includes(fundingKind)) throw new Error("Unknown funding kind");
  const before = integer(previousBase, "previousBase");
  const after = integer(nextBase, "nextBase");
  const rate = integer(rateBps, "rateBps");
  if (rate > 10000n) throw new Error("Rate exceeds 100%");
  const delta = fundingKind === "bonus" ? 0 : ratio(after, rate, 10000n) - ratio(before, rate, 10000n);
  return {
    rateBps,
    testCredits: fundingKind === "test" ? delta : 0,
    pendingKopecks: fundingKind === "paid" ? delta : 0,
    // Even paid accruals are pending; this module never authorizes a payout.
    availableKopecks: 0,
  };
}

// An attachment is snapshotted at debit time, not looked up at report time.
export function selectPartnerAttachment({ attachments, ownerId, module, pilotId, occurredAt }) {
  if (!ownerId || !["support", "body"].includes(module) || typeof pilotId !== "string" || !pilotId) {
    throw new Error("Explicit owner, module and pilot scope required");
  }
  const at = Date.parse(occurredAt);
  if (!Number.isFinite(at)) throw new Error("Invalid event time");
  const matches = attachments.filter(a => {
    if (a.ownerId !== ownerId || a.module !== module || a.pilotId !== pilotId) return false;
    const start = Date.parse(a.startsAt);
    const end = a.endsAt == null ? Infinity : Date.parse(a.endsAt);
    if (!a.id || !a.expertId || !Number.isFinite(start) || !(end > start)) throw new Error("Invalid attachment");
    return start <= at && at < end;
  });
  if (matches.length > 1) throw new Error("Overlapping partner attachments");
  return matches[0] ? { ...matches[0] } : null;
}
