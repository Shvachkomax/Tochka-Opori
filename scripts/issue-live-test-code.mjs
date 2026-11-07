import { validateDatabaseArchitecture } from '../lib/security/database-architecture.js';
// Run only in an explicitly selected test deployment's server environment.
// Prints the bearer code once. Do not save stdout in git or shared logs.
import {budgetScope,newLiveCode,hashLiveCode} from '../lib/voice/live-budget.js';
import {getSupabase} from '../lib/supabase.js';
const scope=budgetScope();
if(process.argv[2]!==scope)throw new Error('Pass the exact LIVE_BUDGET_SCOPE as the first argument.');
if(process.env.VERCEL_ENV !== 'preview' || process.env.DEPLOYMENT_PURPOSE !== 'test' || !validateDatabaseArchitecture(process.env).connected) throw new Error('Only isolated test Preview may issue Live codes.');
const code=newLiveCode();
const {error}=await getSupabase().from('live_test_budgets').insert({scope,code_hash:hashLiveCode(code,scope)});
if(error)throw new Error('Code creation failed; no code issued.');
console.log(code);
