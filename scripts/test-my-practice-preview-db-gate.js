import assert from "node:assert/strict";
import {getSupabase} from "../lib/supabase.js";
import {isMyPracticeServerEnabled} from "../lib/my-practice/workspace-handler.js";
const vars=["MY_PRACTICE_REQUIRE_TEST_DB","MY_PRACTICE_SERVER_ENABLED","MY_PRACTICE_ALLOWED_SUPABASE_REF","SUPABASE_URL","VERCEL_ENV"];
const saved=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
try{
  Object.assign(process.env,{
    MY_PRACTICE_REQUIRE_TEST_DB:"true",
    MY_PRACTICE_SERVER_ENABLED:"false",
    MY_PRACTICE_ALLOWED_SUPABASE_REF:"eehyehlhiyztciaezaus",
    SUPABASE_URL:"https://eehyehlhiyztciaezaus.supabase.co",
    VERCEL_ENV:"preview",
  });
  assert.equal(isMyPracticeServerEnabled(process.env),false);
  assert.throws(()=>getSupabase(),/verified test database credentials not configured/);
  process.env.MY_PRACTICE_SERVER_ENABLED="true";
  process.env.SUPABASE_URL="https://blwogrdezfhprdpdnxtn.supabase.co";
  assert(!isMyPracticeServerEnabled(process.env),"Production URL must never be accepted");
  assert.throws(()=>getSupabase(),/verified test database credentials not configured/);
} finally {
  for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;
}
console.log("My Practice DB gate: PASS (no inherited Production DB access)");
