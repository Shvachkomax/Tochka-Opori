import assert from "node:assert/strict";
import { allocatedRevenueKopecks as revenue, calculatePartnerAccrual as accrue, selectPartnerAttachment as select } from "../lib/partners/accounting.js";

assert.deepEqual(accrue({ fundingKind: "test", previousBase: 0, nextBase: 22000 }), {
  rateBps: 2500, testCredits: 5500, pendingKopecks: 0, availableKopecks: 0,
});
assert.equal(accrue({ fundingKind: "bonus", previousBase: 0, nextBase: 22000 }).pendingKopecks, 0);
assert.equal(accrue({ fundingKind: "bonus", previousBase: 0, nextBase: 22000 }).testCredits, 0);
const pack = { paidKopecks: 99901, packageCredits: 22000 };
let sum = 0;
for (let i = 1; i <= pack.packageCredits; i++) {
  sum += accrue({ fundingKind: "paid", previousBase: revenue({ ...pack, consumedCredits: i - 1 }), nextBase: revenue({ ...pack, consumedCredits: i }) }).pendingKopecks;
}
assert.equal(sum, 24975, "small debits preserve cumulative rounding");
assert.equal(accrue({ fundingKind: "paid", previousBase: pack.paidKopecks, nextBase: 0 }).pendingKopecks, -sum, "full reversal cancels accrual");
assert.equal(accrue({ fundingKind: "paid", previousBase: 10000, nextBase: 10000 }).pendingKopecks, 0);
for (const bad of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => accrue({ fundingKind: "paid", previousBase: 0, nextBase: bad }));
}
assert.throws(() => accrue({ fundingKind: "unknown", previousBase: 0, nextBase: 10 }));
assert.throws(() => accrue({ fundingKind: "paid", previousBase: 0, nextBase: 10, rateBps: 10001 }));
assert.throws(() => revenue({ ...pack, consumedCredits: 22001 }));
assert.throws(() => revenue({ ...pack, packageCredits: 0, consumedCredits: 0 }));
const scope = { ownerId: "patient", module: "support", pilotId: "anmed" };
const old = { ...scope, id: "a", expertId: "doctor-a", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-20T00:00:00Z" };
const next = { ...scope, id: "b", expertId: "doctor-b", startsAt: old.endsAt, endsAt: null };
const query = { ...scope, attachments: [old, next], occurredAt: old.endsAt };
assert.equal(select(query).expertId, "doctor-b");
assert.equal(select({ ...query, occurredAt: "2026-10-19T23:59:59Z" }).expertId, "doctor-a");
assert.equal(select({ ...query, pilotId: "pneumo" }), null);
assert.equal(select({ ...query, module: "body" }), null);
assert.equal(select({ ...query, ownerId: "other" }), null);
assert.throws(() => select({ ...query, attachments: [next, { ...next, id: "c" }] }));
console.log("Partner accounting: all checks passed");
