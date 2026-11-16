import assert from 'node:assert/strict';
import {parseDraftPeriod,buildPatientDraft,handlePatientDraft} from '../lib/clinical/patient-draft-summary.js';
assert.throws(()=>parseDraftPeriod('other'));
const d='2026-11-17T00:00:00.000Z';
const events=[
 {at:'2026-11-10T00:00:00.000Z',source:'body_daily_logs',provenance:'patient_reported',details:{weight_kg:80,sleep_hours:6}},
 {at:'2026-11-16T00:00:00.000Z',source:'body_daily_logs',provenance:'patient_reported',details:{weight_kg:79,sleep_hours:7}},
 {at:'2026-11-16T00:00:00.000Z',source:'sessions',provenance:'patient_reported',details:{}},
 {at:'2026-01-01T00:00:00.000Z',source:'sessions',provenance:'patient_reported',details:{}}
];
const health=buildPatientDraft(events,'body','days7',new Date(d));
assert.equal(health.items.find(x=>x.label==='Вес, кг').value,'79');
assert.equal(health.items.find(x=>x.label==='Вес, кг').sources.length,1);
const support=buildPatientDraft(events,'support','days30',new Date(d));
assert.equal(support.items.find(x=>x.label==='Контакты Support').value,'Сохранённых сессий: 1');
assert.ok(support.items.every(x=>x.sources.length>0));
const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
let reads=0, r=response();
const deps={enabled:()=>true,authorize:async()=>({ok:false,status:403}),getSupabase:()=>{reads++;},load:async()=>{reads++;}};
await handlePatientDraft({body:{period:'days30'}},r,deps);
assert.equal(r.statusCode,403);assert.equal(reads,0);
r=response();await handlePatientDraft({body:{period:'days30'}},r,{...deps,authorize:async()=>({ok:true,relationship:'shared'})});
assert.equal(r.statusCode,403);assert.equal(reads,0);
r=response();await handlePatientDraft({body:{period:'days30'}},r,{...deps,authorize:async()=>({ok:true,relationship:'primary'}) ,load:async()=>({coverage:{complete:false}})});
assert.equal(r.statusCode,503);
r=response();await handlePatientDraft({body:{period:'invalid'}},r,{...deps,authorize:async()=>({ok:true,relationship:'primary'})});
assert.equal(r.statusCode,400);
console.log('PASS A5.2: period bounds, module isolation, provenance, revoked/shared grants, incomplete coverage');
