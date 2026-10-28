import assert from "node:assert/strict";
import { clearKnowledgeStateForTests, searchDrugs, searchGuidelines, searchSimilarCases, listQueryHistory, estimateCharge, getKnowledgePrices } from "../lib/clinical/knowledge/service.js";
import { hasClinicalKnowledgeAccess } from "../lib/clinical/knowledge/access.js";
import { SYNTHETIC_CLINICAL_CASES } from "../lib/clinical/knowledge/providers/clinical-cases-provider.js";

clearKnowledgeStateForTests();

// Access
assert.equal(hasClinicalKnowledgeAccess({ role: "specialist", requestedOrganizationId: "org-1", memberships: [{ organization_id: "org-1", status: "active" }] }), true);
assert.equal(hasClinicalKnowledgeAccess({ role: "specialist", requestedOrganizationId: "org-2", memberships: [{ organization_id: "org-1", status: "active" }] }), false);
assert.equal(hasClinicalKnowledgeAccess({ role: "patient", requestedOrganizationId: "org-1", memberships: [] }), false);

// Unauthorized service call
const denied = await searchDrugs({ query: "x", actor: { id: "p1", role: "patient" }, organizationId: "org-1", memberships: [] });
assert.equal(denied.ok, false);

// Prices
const prices = getKnowledgePrices();
assert.equal(prices.drug_basic_search, 0);
assert.equal(prices.drug_extended_search, 5);
assert.equal(prices.similar_cases_search, 20);

// Drugs
const drug = await searchDrugs({ query: "сертралин", extended: true, actor: { id: "u1", role: "specialist" }, organizationId: "org-1", memberships: [{ organization_id: "org-1", status: "active" }], idempotencyKey: "k1" });
assert.equal(drug.ok, true);
assert.equal(drug.results.length, 0);
assert.equal(drug.provider_status, "awaiting_license");
assert.equal(drug.real_charge_performed, false);
assert.equal(drug.charge.price_rub, 5);

// Idempotency
const drug2 = await searchDrugs({ query: "сертралин", extended: true, actor: { id: "u1", role: "specialist" }, organizationId: "org-1", memberships: [{ organization_id: "org-1", status: "active" }], idempotencyKey: "k1" });
assert.equal(drug2.query_id, drug.query_id);

// Guidelines
const guide = await searchGuidelines({ symptoms: ["снижение настроения"], diagnosis: "депрессивный", ageGroup: "adult", actor: { id: "u1", role: "specialist" }, organizationId: "org-1", memberships: [{ organization_id: "org-1", status: "active" }] });
assert.equal(guide.ok, true);
assert.ok(Array.isArray(guide.results));
assert.ok(guide.results.length > 0);

// Similar cases
const cases = await searchSimilarCases({ symptoms: ["снижение настроения"], ageGroup: "adult", actor: { id: "u1", role: "specialist" }, organizationId: "org-1", memberships: [{ organization_id: "org-1", status: "active" }] });
assert.equal(cases.ok, true);
assert.equal(cases.results.length, 1);
assert.ok(cases.results[0].source_link);
assert.equal(cases.no_confirmed_sources_message, null);

// Empty sources message
const empty = await searchSimilarCases({ symptoms: ["несуществующий симптом xyz"], ageGroup: "adult", actor: { id: "u1", role: "specialist" }, organizationId: "org-1", memberships: [{ organization_id: "org-1", status: "active" }] });
assert.equal(empty.no_confirmed_sources_message, "Подтверждённых источников не найдено.");

// Synthetic cases approved only
assert.ok(SYNTHETIC_CLINICAL_CASES.every((c) => c.expert_review_status === "approved"));

// History
const history = listQueryHistory({ actorId: "u1" });
assert.ok(history.length >= 3);

console.log("clinical-knowledge tests passed");
