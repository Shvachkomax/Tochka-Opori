import assert from 'node:assert/strict';
import { DATABASE_REFS, validateDatabaseArchitecture as validate } from '../lib/security/database-architecture.js';

const key = (ref, role = 'service_role') => `synthetic.${Buffer.from(JSON.stringify({ ref, role })).toString('base64url')}.synthetic`;
const config = (purpose, environment = 'production') => ({
  DEPLOYMENT_PURPOSE: purpose, VERCEL_ENV: environment,
  SUPABASE_URL: `https://${DATABASE_REFS[purpose]}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: key(DATABASE_REFS[purpose]),
});
assert.equal(validate(config('live')).purpose, 'live');
assert.equal(validate(config('test')).purpose, 'test'); // Test project Production remains test.
assert.equal(validate(config('test', 'preview')).purpose, 'test');
assert.throws(() => validate(config('live', 'preview')), /Preview/);
assert.throws(() => validate({ ...config('test'), SUPABASE_URL: config('live').SUPABASE_URL }), /URL/);
assert.throws(() => validate({ ...config('test'), SUPABASE_SERVICE_ROLE_KEY: key(DATABASE_REFS.live) }), /another database/);
assert.throws(() => validate({ ...config('test'), SUPABASE_SERVICE_ROLE_KEY: key(DATABASE_REFS.test, 'anon') }), /role/);
assert.throws(() => validate({ ...config('test'), SUPABASE_SERVICE_ROLE_KEY: '' }), /missing/);
assert.throws(() => validate({ ...config('test'), SUPABASE_SERVICE_ROLE_KEY: 'malformed' }), /format/);
assert.throws(() => validate({ ...config('test'), DEPLOYMENT_PURPOSE: '' }), /DEPLOYMENT_PURPOSE/);
assert.equal(validate({ DEPLOYMENT_PURPOSE: 'demo' }).connected, false);
assert.throws(() => validate({ ...config('test'), DEPLOYMENT_PURPOSE: 'demo' }), /no database/);
console.log('Database architecture: 12 checks PASS (synthetic credentials, no network)');
