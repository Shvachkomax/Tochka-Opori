import assert from "node:assert/strict";
import { supportMissingModelGuard, supportUnexpectedQuestionsGuard } from "../lib/support/question-loop-guard.js";

// Missing model must never return the same eight stock questions indefinitely.
const unavailable = supportMissingModelGuard("support", false);
assert.equal(unavailable.status, 503);
assert.equal(unavailable.payload.code, "SUPPORT_AI_UNAVAILABLE");
assert.equal(supportMissingModelGuard("support", true), null);

// Preserve Health's own behavior: the Support guard must not route it.
assert.equal(supportMissingModelGuard("body", false), null);
assert.equal(supportMissingModelGuard("health", false), null);

// Once a final report is requested, do not return additional question rounds.
const wrongFinal = supportUnexpectedQuestionsGuard("support", 3, "questions");
assert.equal(wrongFinal.status, 502);
assert.equal(wrongFinal.payload.code, "SUPPORT_REPORT_NOT_READY");
assert.equal(supportUnexpectedQuestionsGuard("support", 2, "questions"), null);
assert.equal(supportUnexpectedQuestionsGuard("body", 6, "questions"), null);
assert.equal(supportUnexpectedQuestionsGuard("support", 3, "final"), null);
console.log("support question-loop guards OK");
