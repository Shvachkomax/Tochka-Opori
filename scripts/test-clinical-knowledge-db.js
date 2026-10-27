import assert from "node:assert/strict";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.log("SKIP: missing env"); process.exit(0); }
const H = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
async function req(path, opts={}) {
  const res = await fetch(url + path, { ...opts, headers: { ...H, ...(opts.headers||{}) } });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const org = (await req("/rest/v1/organizations", { method:"POST", headers:{Prefer:"return=representation"}, body: JSON.stringify({name:"DB Test Org "+Date.now(),slug:"db-test-org-"+Date.now(),type:"private_clinic"}) })).data[0];
const reviewer = (await req("/rest/v1/experts", { method:"POST", headers:{Prefer:"return=representation"}, body: JSON.stringify({name:"DB Reviewer 2",role:"clinical_reviewer",specialty:"psychiatry",city:"Moscow",allowed_modules:["support"],access_code:"DBREVIEWER"+Date.now(),is_active:true}) })).data[0];

// incomplete metadata case
const incompleteRes = await req("/rest/v1/published_clinical_cases", { method:"POST", headers:{Prefer:"return=representation"}, body: JSON.stringify({title:"Incomplete Pub",source_url:"https://example.com",expert_review_status:"pending_review"}) });
console.log("incomplete status", incompleteRes.status, JSON.stringify(incompleteRes.data));
const incomplete = incompleteRes.data[0];
const r1 = await req("/rest/v1/rpc/approve_published_case", { method:"POST", body: JSON.stringify({ p_reviewer_id: reviewer.id, p_publication_id: incomplete.id, p_version: "2025", p_comment: "ok", p_idempotency_key: "k1" }) });
assert.equal(r1.data.ok, false, "incomplete metadata should fail");

const reviewer2 = (await req("/rest/v1/experts", { method:"POST", headers:{Prefer:"return=representation"}, body: JSON.stringify({name:"DB Reviewer 3",role:"clinical_reviewer",specialty:"psychiatry",city:"Moscow",allowed_modules:["support"],access_code:"DBREVIEWER"+Date.now()+"B",is_active:true}) })).data[0];
// complete case
const complete = (await req("/rest/v1/published_clinical_cases", { method:"POST", headers:{Prefer:"return=representation"}, body: JSON.stringify({title:"Complete Pub",authors:"A",doi:"10.1/x",source_url:"https://example.com",usage_rights:"metadata only",last_verified_at:"2026-10-27",expert_review_status:"pending_review",submitted_by_expert_id: reviewer.id,version:"2",source_verified:true,rights_verified:true}) })).data[0];
// self-approval should fail
const self = await req("/rest/v1/rpc/approve_published_case", { method:"POST", body: JSON.stringify({ p_reviewer_id: reviewer.id, p_publication_id: complete.id, p_version: "2025", p_comment: "ok", p_idempotency_key: "k2" }) });
assert.equal(self.data.ok, false, "self approval should fail");

// use another reviewer for approval
const stale = await req("/rest/v1/rpc/approve_published_case", { method:"POST", body: JSON.stringify({ p_reviewer_id: reviewer2.id, p_publication_id: complete.id, p_version: "1", p_comment: "ok", p_idempotency_key: "k-stale" }) });
assert.equal(stale.data.ok, false, "stale version should fail");
const ok = await req("/rest/v1/rpc/approve_published_case", { method:"POST", body: JSON.stringify({ p_reviewer_id: reviewer2.id, p_publication_id: complete.id, p_version: "2", p_comment: "ok", p_idempotency_key: "k3" }) });
assert.equal(ok.data.ok, true, "approval should succeed");

// duplicate idempotency
const dup = await req("/rest/v1/rpc/approve_published_case", { method:"POST", body: JSON.stringify({ p_reviewer_id: reviewer2.id, p_publication_id: complete.id, p_version: "2025", p_comment: "ok", p_idempotency_key: "k3" }) });
assert.equal(dup.data.idempotent, true);

// non-reviewer fails
const nonrev = (await req("/rest/v1/experts", { method:"POST", headers:{Prefer:"return=representation"}, body: JSON.stringify({name:"DB Doctor",role:"doctor",specialty:"psychiatry",city:"Moscow",allowed_modules:["support"],access_code:"DBDOCTOR"+Date.now(),is_active:true}) })).data[0];
const denied = await req("/rest/v1/rpc/approve_published_case", { method:"POST", body: JSON.stringify({ p_reviewer_id: nonrev.id, p_publication_id: complete.id, p_version: "2025", p_comment: "ok", p_idempotency_key: "k4" }) });
assert.equal(denied.data.ok, false, "non-reviewer should fail");

console.log("DB integration tests PASSED");
