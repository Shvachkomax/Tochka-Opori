// This regression uses the real specialist handler and deliberately does not
// configure any Supabase credentials. Guard must stop requests before login.
import assert from "node:assert/strict";
import handler from "../api/specialist.js";

const oldValue=process.env.MEDICAL_STAGING_NO_PATIENT_DATA;
const previousRef=process.env.MEDICAL_STAGING_ALLOWED_SUPABASE_REF;
const previousUrl=process.env.SUPABASE_URL;
const previousRole=process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.MEDICAL_STAGING_NO_PATIENT_DATA="true";
function response() {
  return { code:200, headers:{},
    setHeader(k,v){this.headers[k]=v;return this;},
    getHeader(k){return this.headers[k];},
    status(v){this.code=v;return this;},
    json(data){this.body=data;return this;} };
}
try {
  for (const action of ["login","me","listClients","getClinicalTimeline",
    "createMedicationOrder","supersedeMedicationOrder","revokeMedicationOrder"]) {
    const res=response();
    await handler({ method:"POST",headers:{origin:"https://tochka-opori-medical-staging.vercel.app"},
      body:{action,module:"support"} },res);
    assert.equal(res.code,503,`Action ${action} bypassed medical staging shutdown`);
    assert.equal(res.body?.code,"MEDICAL_STAGING_DATA_DISABLED");
    assert.equal(res.headers["Cache-Control"],"no-store");
  }
  process.env.MEDICAL_STAGING_NO_PATIENT_DATA="false";
  process.env.MEDICAL_STAGING_ALLOWED_SUPABASE_REF="eehyehlhiyztciaezaus";
  for (const [url,role] of [
    ["https://eehyehlhiyztciaezaus.supabase.co",null],
    ["https://another-supabase-project.supabase.co","SYNTHETIC-NONSECRET-KEY"],
    ["https://example.com","SYNTHETIC-NONSECRET-KEY"],
  ]) {
    process.env.SUPABASE_URL=url;
    if(role===null)delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY=role;
    const res=response();
    await handler({ method:"POST",headers:{origin:"https://tochka-opori-medical-staging.vercel.app"},
      body:{action:"login",module:"support"} },res);
    assert.equal(res.code,503,"Unexpected medical DB accepted");
    assert.equal(res.body?.code,"MEDICAL_STAGING_DATABASE_NOT_READY");
    assert.equal(res.headers["Cache-Control"],"no-store");
  }
  console.log("Medical staging shell: 7 disabled actions and 3 invalid database conditions fail closed.");
} finally {
  if(oldValue===undefined)delete process.env.MEDICAL_STAGING_NO_PATIENT_DATA;
  else process.env.MEDICAL_STAGING_NO_PATIENT_DATA=oldValue;
  if(previousRef===undefined)delete process.env.MEDICAL_STAGING_ALLOWED_SUPABASE_REF;
  else process.env.MEDICAL_STAGING_ALLOWED_SUPABASE_REF=previousRef;
  if(previousUrl===undefined)delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL=previousUrl;
  if(previousRole===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY=previousRole;
}
process.exit(0);
