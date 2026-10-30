import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import handler from "../api/clinical-knowledge.js";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const routes = config.routes || [];
const isStaging = Boolean(config.builds?.length);
if (isStaging) {
  assert.equal(routes.find(r => r.src === "/api/clinical-knowledge")?.dest, "/api/clinical-knowledge.js");
  assert.equal(routes.find(r => r.src === "/api/specialist")?.dest, "/api/medical-staging-specialist-disabled.js");
  assert.ok(routes.some(r => r.src === "/api/.*" && r.status === 404), "Other APIs must stay unexposed");
  assert.ok((config.builds || []).filter(b => b.use === "@vercel/node").length <= 2);
} else {
  assert.ok(config.rewrites?.some(r => r.source.includes("api/.*") && r.destination === "/index.html"), "Preserve original SPA API exclusion");
  assert.ok(config.functions?.["api/analyze.js"], "Preserve Support analyze function");
  assert.ok(config.functions?.["api/transcribe.js"], "Preserve Health/voice transcribe function");
}

const source = readFileSync(new URL("../src/pages/specialist/ClinicalKnowledgeDemo.jsx", import.meta.url), "utf8");
for (const label of ["Препараты", "Клинические рекомендации", "Похожие случаи", "Тестовые данные", "Реальные списания отключены"]) {
  assert.ok(source.includes(label), "Missing demo notice/section: " + label);
}
const oldFlag = process.env.CLINICAL_KNOWLEDGE_ENABLED;
const oldPatientFlag = process.env.MEDICAL_STAGING_NO_PATIENT_DATA;
try {
  for (const [enabled, closed] of [[undefined, undefined], ["false", "false"], ["true", "true"]]) {
    if (enabled === undefined) delete process.env.CLINICAL_KNOWLEDGE_ENABLED;
    else process.env.CLINICAL_KNOWLEDGE_ENABLED = enabled;
    if (closed === undefined) delete process.env.MEDICAL_STAGING_NO_PATIENT_DATA;
    else process.env.MEDICAL_STAGING_NO_PATIENT_DATA = closed;
    const res = { headers: {}, setHeader(k,v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(v) { this.body = v; return this; } };
    await handler({ method: "POST", headers: {}, body: { action: "searchSimilarCases" } }, res);
    assert.equal(res.code, 503, "Clinical API guard must fail closed");
    assert.equal(res.body?.code, "CLINICAL_KNOWLEDGE_DISABLED");
    assert.equal(res.headers["Cache-Control"], "no-store");
  }
} finally {
  if (oldFlag === undefined) delete process.env.CLINICAL_KNOWLEDGE_ENABLED; else process.env.CLINICAL_KNOWLEDGE_ENABLED = oldFlag;
  if (oldPatientFlag === undefined) delete process.env.MEDICAL_STAGING_NO_PATIENT_DATA; else process.env.MEDICAL_STAGING_NO_PATIENT_DATA = oldPatientFlag;
}
console.log("Clinical Preview synthetic UI and closed API contract passed.");
