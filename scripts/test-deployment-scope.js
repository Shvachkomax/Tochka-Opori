import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { scopeDatabase, deploymentOrganizationId } from '../lib/security/deployment-scope.js';
const own = 'badfcce0-4ad7-46f3-ad2f-07f102abe3f7';
const foreign = '11111111-1111-4111-8111-111111111111';
const requests = [];
const base = createClient('https://example.supabase.co', 'test-only-key', {global: {fetch: async (url, init) => {
  requests.push({url: new URL(url), method: init.method, body: init.body ? JSON.parse(init.body) : null});
  return new Response('[]', {status:200,headers:{'Content-Type':'application/json'}});
}}});
const db = scopeDatabase(base, own);
for (const table of ['sessions','patient_assignments','patient_access','expert_organization_memberships','patient_specialist_invitations','specialist_match_requests','doctor_invite_links','case_reviews','service_requests','expert_requests','crisis_requests']) {
  const scopeColumn = ['service_requests','expert_requests','crisis_requests'].includes(table) ? 'tenant_id' : 'organization_id';
  await db.from(table).select('*').eq(scopeColumn, foreign);
  assert.deepEqual(requests.at(-1).url.searchParams.getAll(scopeColumn), [`eq.${own}`,`eq.${foreign}`]);
  await db.from(table).insert({[scopeColumn]:null});
  assert.equal(requests.at(-1).body[scopeColumn],own);
  assert.throws(()=>db.from(table).insert({[scopeColumn]:foreign}));
  assert.throws(()=>db.from(table).update({[scopeColumn]:foreign}));
  assert.throws(()=>db.from(table).upsert({[scopeColumn]:own}));
  await db.from(table).update({status:'active'}).eq('id','synthetic');
  assert.equal(requests.at(-1).url.searchParams.get(scopeColumn),`eq.${own}`);
  await db.from(table).delete().eq('id','synthetic');
  assert.equal(requests.at(-1).url.searchParams.get(scopeColumn),`eq.${own}`);
}
await db.from('organizations').select('*');
assert.equal(requests.at(-1).url.searchParams.get('id'),`eq.${own}`);
const denied = await db.rpc('accept_specialist_invitation',{p_token_hash:'foreign'});
assert.equal(denied.data.code,'NOT_FOUND');
assert.equal(scopeDatabase(base,null),base);
process.env.VITE_APP_BRAND='kgmu';delete process.env.DEPLOYMENT_ORGANIZATION_ID;
assert.throws(()=>deploymentOrganizationId());
process.env.DEPLOYMENT_ORGANIZATION_ID=own;
assert.equal(deploymentOrganizationId(),own);
process.env.VITE_APP_BRAND='pneumointegration';delete process.env.DEPLOYMENT_ORGANIZATION_ID;
assert.throws(()=>deploymentOrganizationId());
process.env.DEPLOYMENT_ORGANIZATION_ID=own;
assert.equal(deploymentOrganizationId(),own);
const { validateSpecialistContext } = await import('../api/specialist.js');
const ctx={memberships:[{organization_id:own}],module:'support',allowedModules:['support']};
assert.equal(validateSpecialistContext({...ctx,organizationId:own}).ok,true);
assert.equal(validateSpecialistContext({...ctx,organizationId:foreign}).ok,false);
assert.equal(validateSpecialistContext({...ctx,organizationId:null}).ok,false);
console.log('Deployment scope tests passed: query filters, bound inserts, denied reassignment/upsert/invitation and specialist contexts.');

process.exit(0); // Imported API rate limiters keep an interval alive.
