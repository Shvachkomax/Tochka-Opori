import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizeMyPracticeWorkspace,SYNTHETIC_PRACTICE_SERVICE_NAMES} from "../lib/my-practice/workspace-validation.js";
import {isMyPracticeServerEnabled} from "../lib/my-practice/workspace-handler.js";
const repo=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const cabinet=repo("src/pages/specialist/SpecialistCabinet.jsx");
const publicEntry=repo("src/main.jsx");
const client=repo("src/pages/specialist/MyPracticeServerWorkspace.jsx");
assert(cabinet.includes("!selectedClient && ("));

assert(!cabinet.includes("<MyPracticeServerWorkspace"),"Technical workspace editor must not be exposed in specialist cabinet");
assert(!publicEntry.includes("MyPracticeServerWorkspace"),"Remote workspace must not be available on public demo route");
assert(client.includes('credentials:"same-origin"'));
assert(client.includes('callWorkspace("getMyPracticeWorkspace")'));
assert(client.includes('callWorkspace("saveMyPracticeWorkspace"'));
assert(!client.includes("localStorage"));
assert(SYNTHETIC_PRACTICE_SERVICE_NAMES.length>=3);
assert(!isMyPracticeServerEnabled({}));
const org="00000000-0000-4000-8000-000000000002";
const doc={
  scope:"synthetic",
  catalog:[{organization_id:org,offers:[{id:"srv-1",name:SYNTHETIC_PRACTICE_SERVICE_NAMES[0],priceRub:2500,minutes:45,format:"offline",status:"active"}]}],
  schedule:[],
};
assert.deepEqual(normalizeMyPracticeWorkspace(doc,[org]),doc);
const withRealName=structuredClone(doc);withRealName.catalog[0].offers[0].name="Пациент Иванов";
assert.throws(()=>normalizeMyPracticeWorkspace(withRealName,[org]),/учебные наименования/);
console.log("My Practice private server UI: PASS (auth-only routing, gated client, synthetic labels)");
