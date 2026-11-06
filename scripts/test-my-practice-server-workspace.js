import assert from "node:assert/strict";
import {emptyMyPracticeWorkspace,normalizeMyPracticeWorkspace,WorkspaceValidationError,isSafeMyPracticeVersion} from "../lib/my-practice/workspace-validation.js";
const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002";
const basis={scope:"synthetic",catalog:[
 {organization_id:a,offers:[{id:"demo-a",name:"Консультация",priceRub:4500,minutes:60,format:"offline",status:"active"}]},
 {organization_id:b,offers:[{id:"demo-b",name:"Повторная консультация",priceRub:2800,minutes:30,format:"online",status:"active"}]}
],schedule:[
 {id:"evt-a",organization_id:a,kind:"busy",source:"manual",day:"2026-11-10",start:"10:00",end:"12:00",reason:"clinic"},
 {id:"evt-b",organization_id:b,kind:"booking",source:"manual",day:"2026-11-10",start:"12:00",end:"12:30",patientAlias:"demo-p1",serviceId:"demo-b",status:"pending"}
]};
const clone=x=>JSON.parse(JSON.stringify(x));
assert.deepEqual(normalizeMyPracticeWorkspace(emptyMyPracticeWorkspace(),[]),emptyMyPracticeWorkspace());
assert.deepEqual(normalizeMyPracticeWorkspace(basis,[a,b]),basis);
assert(isSafeMyPracticeVersion(0));assert(!isSafeMyPracticeVersion(-1));assert(!isSafeMyPracticeVersion(3.5));
const fail=(patch,allowed=[a,b])=>assert.throws(()=>normalizeMyPracticeWorkspace(patch,allowed),WorkspaceValidationError);
fail(clone(basis),[a]);
const invalid=(cb)=>{let obj=clone(basis);cb(obj);fail(obj);};
invalid(x=>x.extra="real-patient");
invalid(x=>x.catalog[0].bookingUrl="https://external.invalid");
invalid(x=>x.catalog[0].offers[0].notes="diagnosis");
invalid(x=>x.catalog[0].offers[0].priceRub=-5);
invalid(x=>x.catalog[0].offers[0].id="demo-b");
invalid(x=>x.catalog[0].offers[0].name="X");
invalid(x=>x.schedule[0].patientName="Пётр Петров");
invalid(x=>x.schedule[1].patientAlias="Пётр Петров");
invalid(x=>x.schedule[1].serviceId="demo-a");
invalid(x=>x.schedule[1].source="clinic");
invalid(x=>x.schedule[1].start="11:45");
invalid(x=>x.schedule[0].day="2026-02-30");
invalid(x=>x.schedule[0].day="2019-01-01");
invalid(x=>x.schedule[0].end="10:00");
invalid(x=>x.schedule[0].reason="other");
invalid(x=>x.schedule[1].status="unknown");
invalid(x=>x.schedule.push(x.schedule[0]));
let cancelled=clone(basis);cancelled.schedule[1].status="cancelled";cancelled.schedule[1].start="11:15";cancelled.schedule[1].end="11:45";
assert.equal(normalizeMyPracticeWorkspace(cancelled,[a,b]).schedule[1].status,"cancelled");
console.log("My Practice server workspace: PASS (RBAC membership, no PII, cross-clinic conflicts, source and revision validation)");
