import { validateDatabaseArchitecture } from '../lib/security/database-architecture.js';

// Plain local UI builds do not have Vercel configuration. Explicit policy checks
// and every Vercel build must satisfy the policy; failures never print credentials.
if (!process.env.VERCEL && !process.env.VERCEL_ENV && !process.env.DEPLOYMENT_PURPOSE) {
  console.log('Database policy: local UI build; no deployment configuration checked');
} else {
  try {
    const result = validateDatabaseArchitecture(process.env);
    console.log(`Database policy: ${result.purpose} PASS`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
