import assert from "node:assert/strict";
import {handleMyPracticeWorkspace,isMyPracticeServerEnabled,isSameOriginPracticeRequest} from "../lib/my-practice/workspace-handler.js";

const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002";
const env={MY_PRACTICE_SERVER_ENABLED:"true",MY_PRACTICE_ALLOWED_SUPABASE_REF:"eehyehlhiyztciaezaus",
  VERCEL_ENV:"preview",DEPLOYMENT_PURPOSE:"test",SUPABASE_URL:"https://eehyehlhiyztciaezaus.supabase.co"};
const headers={origin:"https://test-preview.vercel.app",host:"test-preview.vercel.app"};
assert(isMyPracticeServerEnabled(env));
assert(!isMyPracticeServerEnabled({...env,VERCEL_ENV:"production"}));
assert(!isMyPracticeServerEnabled({...env,SUPABASE_URL:"https://blwogrdezfhprdpdnxtn.supabase.co"}));
assert(!isMyPracticeServerEnabled({...env,MY_PRACTICE_SERVER_ENABLED:"false"}));
assert(!isMyPracticeServerEnabled({...env,MY_PRACTICE_ALLOWED_SUPABASE_REF:"blwogrdezfhprdpdnxtn",SUPABASE_URL:"https://blwogrdezfhprdpdnxtn.supabase.co"}));
assert(isSameOriginPracticeRequest(headers));
assert(!isSameOriginPracticeRequest({...headers,origin:"https://other-preview.vercel.app"}));
assert(!isSameOriginPracticeRequest({...headers,origin:undefined}));
const expert={id:"00000000-0000-4000-8000-000000000007",is_active:true};
const memberships=[
  {organization_id:a,organization_name:"Клиника А",role_in_organization:"doctor"},
  {organization_id:b,organization_name:"Клиника Б",role_in_organization:"psychologist"},
];
let stored=null;
const db={from(table){
  assert.equal(table,"my_practice_synthetic_workspaces");
  let mode="get",payload=null,filters={};
  const q={
    select(){if(mode!=="update")mode="get";return q;},
    eq(field,value){filters[field]=value;return q;},
    async maybeSingle(){
      if(mode==="get")return {data:stored,error:null};
      if(mode==="update"){
        if(!stored||filters.version!==stored.version||filters.expert_id!==expert.id)return {data:null,error:null};
        stored={...stored,...payload};
        return {data:{version:stored.version},error:null};
      }
    },
    async insert(row){
      if(stored)return {error:{code:"23505"}};
      stored={...row};return {error:null};
    },
    update(data){mode="update";payload=data;return q},
  };
  return q;
}};
function res(){
  return {code:0,body:null,headers:{},setHeader(k,v){this.headers[k]=v;return this;},
    status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
}
const authorizeSpecialist=async()=>({expert,memberships});
async function call(body,{auth=authorizeSpecialist,environment=env,requestHeaders=headers}={}){
  const response=res();
  await handleMyPracticeWorkspace({headers:requestHeaders,body},response,{authorizeSpecialist:auth,getSupabase:()=>db,env:environment});
  assert.equal(response.headers["Cache-Control"],"no-store");
  return response;
}
let r=await call({action:"getMyPracticeWorkspace"});
assert.equal(r.code,200);assert.equal(r.body.version,0);assert.equal(r.body.organizations.length,2);
const workspace={scope:"synthetic",catalog:[{organization_id:a,offers:[{
  id:"svc-1",name:"Учебная консультация",priceRub:3000,minutes:45,format:"offline",status:"active"
}]}],schedule:[]};
r=await call({action:"saveMyPracticeWorkspace",version:0,workspace});
assert.equal(r.code,200);assert.equal(r.body.version,1);
r=await call({action:"saveMyPracticeWorkspace",version:0,workspace});
assert.equal(r.code,409);
r=await call({action:"getMyPracticeWorkspace"});
assert.equal(r.body.version,1);assert.equal(r.body.workspace.catalog[0].offers[0].priceRub,3000);
const revised=structuredClone(workspace);
revised.catalog[0].offers[0].priceRub=3500;
r=await call({action:"saveMyPracticeWorkspace",version:1,workspace:revised});
assert.equal(r.code,200);assert.equal(r.body.version,2);
r=await call({action:"saveMyPracticeWorkspace",version:1,workspace});
assert.equal(r.code,409);
r=await call({action:"saveMyPracticeWorkspace",version:2,workspace:{
  ...revised,catalog:[{organization_id:"00000000-0000-4000-8000-000000000099",offers:[]}]
}});
assert.equal(r.code,400);
r=await call({action:"getMyPracticeWorkspace"},{auth:async()=>({status:401,error:"Требуется авторизация"})});
assert.equal(r.code,401);
r=await call({action:"getMyPracticeWorkspace"},{auth:async()=>({expert,memberships:[memberships[1]]})});
assert.equal(r.code,409);assert(!r.body.workspace);
r=await call({action:"getMyPracticeWorkspace"},{environment:{...env,VERCEL_ENV:"production"}});
assert.equal(r.code,404);
r=await call({action:"getMyPracticeWorkspace"},{requestHeaders:{origin:"https://bad.vercel.app",host:headers.host}});
assert.equal(r.code,403);
console.log("My Practice API: PASS (origin, preview only, authenticated membership, save/CAS, revoked access)");
