// This regression uses the real specialist handler and deliberately does not
// configure any Supabase credentials. Guard must stop requests before login.
import assert from "node:assert/strict";
import handler from "../api/specialist.js";

const oldValue=process.env.MEDICAL_STAGING_NO_PATIENT_DATA;
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
  console.log("Medical staging shell: 7 specialist API actions fail closed (503).");
} finally {
  if(oldValue===undefined)delete process.env.MEDICAL_STAGING_NO_PATIENT_DATA;
  else process.env.MEDICAL_STAGING_NO_PATIENT_DATA=oldValue;
}
process.exit(0);
