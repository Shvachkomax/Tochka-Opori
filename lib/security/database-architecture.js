// Connection policy only. This does not replace patient or organization authorization.
export const DATABASE_REFS = Object.freeze({
  live: 'blwogrdezfhprdpdnxtn',
  test: 'eehyehlhiyztciaezaus',
});

export function validateDatabaseArchitecture(env) {
  const purpose = env.DEPLOYMENT_PURPOSE;
  if (!['live', 'test', 'demo'].includes(purpose)) {
    throw new Error('Database policy: DEPLOYMENT_PURPOSE must be live, test or demo');
  }
  if (env.VERCEL_ENV === 'preview' && purpose === 'live') {
    throw new Error('Database policy: Preview cannot use the live database');
  }
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (purpose === 'demo') {
    if (url || key) throw new Error('Database policy: demo must have no database credentials');
    return { purpose, connected: false };
  }
  const ref = DATABASE_REFS[purpose];
  if (url !== `https://${ref}.supabase.co`) {
    throw new Error('Database policy: database URL does not match deployment purpose');
  }
  if (!key) throw new Error('Database policy: server credential is missing');
  // Legacy JWT claims are a configuration consistency check, not signature verification.
  // Modern opaque keys are checked by Supabase when establishing an authenticated connection.
  if (!key.startsWith('sb_secret_')) {
    let claims;
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')); }
    catch { throw new Error('Database policy: unsupported server credential format'); }
    if (claims.ref !== ref || claims.role !== 'service_role') {
      throw new Error('Database policy: server credential belongs to another database or role');
    }
  }
  return { purpose, connected: true };
}
