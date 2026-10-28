import assert from "node:assert/strict";
import { medicationRpcForClinicalArchive } from "../lib/clinical/medication-archive-route.js";

for (const name of ["activate_medication_order","supersede_medication_order","revoke_medication_order"]) {
  assert.equal(medicationRpcForClinicalArchive(name,false),name);
  assert.equal(medicationRpcForClinicalArchive(name,true),"clinical_"+name);
}
for (const input of ["",null,"getClinicalTimeline","body_medication_order","activate_medication_order;DROP TABLE"]) {
  assert.throws(()=>medicationRpcForClinicalArchive(input,true),/Unsupported medication mutation/);
  assert.throws(()=>medicationRpcForClinicalArchive(input,false),/Unsupported medication mutation/);
}
assert.equal(medicationRpcForClinicalArchive("activate_medication_order","true"),"activate_medication_order");
console.log("Medication clinical archive RPC routing: passed (3 mutations, off/on, unknown names fail-closed).");
