import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {normalizeEncounter,handleMedicalRecord} from '../lib/clinical/medical-record.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const base={encounter_id:id(1),expected_version:0,status:'confirmed',encounter_at:'2026-11-01T09:00:00Z',content:{complaints:'Синтетическая запись',medications:[]}};
assert.equal(normalizeEncounter(base).content.complaints,base.content.complaints);
assert.throws(()=>normalizeEncounter({...base,expected_version:-1}));
assert.throws(()=>normalizeEncounter({...base,content:{medications:[]}}));
const med={name:'Условный препарат',source:'clinician_ordered',status:'active',dose:'1 условная единица',frequency:'Согласно записи',route:'Условный способ',start_date:'2026-01-01'};
assert.throws(()=>normalizeEncounter({...base,content:{...base.content,medications:[med]}}),/полномоч|подтверждено/);
assert.equal(normalizeEncounter({...base,content:{...base.content,medications:[med]}},true).content.medications.length,1);
assert.throws(()=>normalizeEncounter({...base,content:{...base.content,medications:[{...med,status:'stopped'}]}},true),/причину/);
assert.throws(()=>normalizeEncounter({...base,content:{...base.content,medications:[{...med,start_date:'2026-03-01',end_date:'2026-02-01'}]}},true));
const res=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}});
let touched=false;
let r=res();await handleMedicalRecord({body:{action:'listMedicalEncounters'}},r,{enabled:()=>true,authorize:async()=>({ok:false,status:403,error:'revoked'}),getSupabase:()=>{touched=true;}});assert.equal(r.statusCode,403);assert.equal(touched,false);
r=res();await handleMedicalRecord({body:{}},r,{enabled:()=>false});assert.equal(r.statusCode,404);
for(const fixture of [
 {module:'support',ownerType:'anonymous_case',ownerId:id(4),encounterId:id(20)},
 {module:'body',ownerType:'anonymous_profile',ownerId:id(5),encounterId:id(21)},
]){
 const calls=[];
 const request={body:{action:'saveMedicalEncounter',module:fixture.module,encounter_id:fixture.encounterId,expected_version:0,status:'confirmed',encounter_at:'2026-11-01T09:00:00Z',content:{complaints:'Синтетическая запись',medications:[]}}};
 const allowed=res();
 await handleMedicalRecord(request,allowed,{enabled:()=>true,authorize:async()=>({ok:true,expertId:id(2),expertName:'Синтетический специалист',ownerType:fixture.ownerType,ownerId:fixture.ownerId,module:fixture.module,organizationId:null,canPrescribe:false}),getSupabase:()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:{encounter_id:fixture.encounterId,version:1,status:'confirmed'},error:null};}})});
 assert.equal(allowed.statusCode,200,`${fixture.module} allowed specialist reaches the A5 handler`);
 assert.equal(calls[0].name,'save_medical_encounter_version');
 assert.equal(calls[0].args.p_owner_type,fixture.ownerType);
 assert.equal(calls[0].args.p_module,fixture.module);
 let deniedTouched=false;
 const denied=res();
 await handleMedicalRecord(request,denied,{enabled:()=>true,authorize:async()=>({ok:false,status:403,error:'forbidden'}),getSupabase:()=>{deniedTouched=true;}});
 assert.equal(denied.statusCode,403,`${fixture.module} foreign specialist is denied`);
 assert.equal(deniedTouched,false);
}
const db=new PGlite();
try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create table experts(id uuid primary key);create table organizations(id uuid primary key);');
 await db.exec(await readFile(new URL('../supabase/migrations/20261116173440_medical_encounters_a5.sql',import.meta.url),'utf8'));
 await db.query('insert into experts values ($1),($2)',[id(2),id(3)]);
 await db.query('insert into organizations values ($1),($2)',[id(7),id(8)]);
 const save=async(version,status='draft',reason='',author=id(2),owner=id(4),encounter=id(1),module='support',organization=null)=>{
  const ownerType=module==='body'?'anonymous_profile':'anonymous_case';
  return (await db.query(`select save_medical_encounter_version($1,$2,$3,$4,$5,$6,$7,'2026-11-01T09:00Z',$8,$9,$10) as saved`,[encounter,version,author,ownerType,owner,module,organization,status,{complaints:'Synthetic',medications:[]},reason])).rows[0].saved;
 };
 assert.equal((await save(0)).version,1);
 await assert.rejects(save(0),{code:'40001'});
 await assert.rejects(save(1,'draft','',id(3)),{code:'42501'});
 await assert.rejects(save(1,'draft','',id(2),id(5)),{code:'42501'});
 assert.equal((await save(1,'confirmed')).version,2);
 await assert.rejects(save(2,'draft'),{code:'22023'});
 assert.equal((await save(2,'draft','Уточнение жалоб')).version,3);
 await assert.rejects(save(3,'confirmed'),{code:'22023'});
 assert.equal((await save(3,'confirmed','Уточнение жалоб')).version,4);
 assert.equal((await db.query('select count(*)::int n from medical_encounter_versions')).rows[0].n,4);
 assert.equal((await save(0,'draft','',id(2),id(4),id(9),'support',id(7))).version,1);
 await assert.rejects(save(1,'draft','',id(2),id(4),id(9),'support',id(8)),{code:'42501'});
 assert.equal((await save(0,'draft','',id(2),id(5),id(10),'body',id(7))).version,1);
 await assert.rejects(save(1,'draft','',id(2),id(6),id(10),'body',id(7)),{code:'42501'});
 assert.equal((await db.query('select count(*)::int n from medical_encounter_versions')).rows[0].n,6);
 await db.exec('set role service_role');
 await assert.rejects(db.query('delete from medical_encounter_versions'),{code:'42501'});
 await assert.rejects(db.query("update medical_encounter_versions set status='draft'"),{code:'42501'});
 await db.exec('reset role;set role anon');
 await assert.rejects(db.query('select * from medical_encounter_versions'),{code:'42501'});
 await assert.rejects(save(0,'draft','',id(2),id(4),id(6)),{code:'42501'});
 await db.exec('reset role');
 const results=await Promise.allSettled([save(4,'confirmed','Correction A'),save(4,'confirmed','Correction B')]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 console.log('PASS A5: manual fields, medication rights, revoked access, immutable versions, scope isolation, correction reason, stale writes and database roles');
}finally{await db.close();}
