import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveLiveOwner } from '../lib/voice/live-owner.js';
const token = 'synthetic-secret';
const session = { session_id: 'fixture', module: 'body', anonymous_owner_id: 'owner',
  access_token_hash: createHash('sha256').update(token).digest('hex'), legacy_access: false, json_data: {} };
function db(row, owner = 'owner', error = null) {
  return { from(table) {
    const query = { select() { return query; }, eq() { return query; },
      async maybeSingle() { return { data: table === 'sessions' ? row : { anonymous_owner_id: owner }, error }; } };
    return query;
  } };
}
delete process.env.PILOT_ID; delete process.env.VITE_APP_BRAND;
assert.deepEqual(await resolveLiveOwner(db(session), 'fixture', token), { ownerId: 'owner', sessionId: 'fixture' });
for (const row of [null, { ...session, legacy_access: true }, { ...session, module: 'support' },
  { ...session, anonymous_owner_id: null }, { ...session, json_data: { pilot_id: 'foreign' } }]) {
  assert.equal(await resolveLiveOwner(db(row), 'fixture', token), null);
}
assert.equal(await resolveLiveOwner(db(session), 'fixture', 'old-public-code'), null);
assert.equal(await resolveLiveOwner(db(session, 'foreign-owner'), 'fixture', token), null);
assert.equal(await resolveLiveOwner(db(session, 'owner', { code: 'failure' }), 'fixture', token), null);
for (const pilot of ['anmed', 'kgmu', 'pneumointegration']) {
  process.env.PILOT_ID = pilot;
  assert.equal(await resolveLiveOwner(db(session), 'fixture', token), null);
  for (const other of ['anmed', 'kgmu', 'pneumointegration']) {
    assert.equal(Boolean(await resolveLiveOwner(db({ ...session, json_data: { pilot_id: other } }), 'fixture', token)), pilot === other);
  }
}
console.log('Live ownership PASS: strict token, no legacy bypass, exact pilot, matching canonical owner, fail closed.');

// Support gets the same strict owner, pilot and token checks without body_clients.
delete process.env.PILOT_ID;
const supportSession={...session,module:'support'};
assert.deepEqual(await resolveLiveOwner(db(supportSession),'fixture',token,'support'),{ownerId:'owner',sessionId:'fixture'});
assert.equal(await resolveLiveOwner(db(supportSession),'fixture','wrong','support'),null);
assert.equal(await resolveLiveOwner(db({...supportSession,legacy_access:true}),'fixture',token,'support'),null);
assert.equal(await resolveLiveOwner(db(supportSession),'fixture',token,'body'),null);
console.log('Support Live strict ownership PASS');
