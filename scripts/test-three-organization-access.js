import assert from 'node:assert/strict';
import { canReadSpecialistRecord, canAccessPatientOrganization } from '../lib/specialist/access-policy.js';
const organizations = ['synthetic-anmed', 'synthetic-kgmu', 'synthetic-pneumo'];
for (const own of organizations) {
  const grant = { organization_id: own, public_code: 'synthetic-patient', module: 'support', access_role: 'clinician' };
  const scope = { expertId: `doctor-${own}`, allowedModules: ['support'],
    memberships: [{ organization_id: own }], patientAccess: [grant], primaryAssignments: [] };
  for (const organization_id of organizations) {
    const record = { organization_id, public_code: grant.public_code, module: 'support' };
    assert.equal(canReadSpecialistRecord(scope, record), organization_id === own);
    assert.equal(canReadSpecialistRecord({ ...scope, patientAccess: [] }, record), false, 'revoked or missing patient grant');
    assert.equal(canReadSpecialistRecord({ ...scope, memberships: [] }, record), false, 'revoked membership');
    const multi = { ...scope, memberships: organizations.map(organization_id => ({ organization_id })) };
    assert.equal(canReadSpecialistRecord(multi, record), organization_id === own, 'multiple memberships do not extend patient grant');
    assert.equal(canAccessPatientOrganization({ organizationId: organization_id,
      requestedOrganizationId: own, hasRequestedOrganization: true, activeOrganizationIds: organizations }), organization_id === own);
  }
}
console.log('Three-organization policy matrix PASS: cross-org, revoked grants, membership-only and multi-clinic context (synthetic unit tests).');
