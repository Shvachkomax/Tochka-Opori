// Test-only, server-side persistence for synthetic My Practice workspaces.
// Never reuse for real patients or medical records. Preview + exact test Supabase ref required.
import {emptyMyPracticeWorkspace,normalizeMyPracticeWorkspace,isSafeMyPracticeVersion,WorkspaceValidationError} from "./workspace-validation.js";

const TABLE="my_practice_synthetic_workspaces";
// Hard guardrail: never point this test-only feature at the Production database.
const APPROVED_TEST_SUPABASE_REF="eehyehlhiyztciaezaus";
const CLINIC_ROLES=new Set(["doctor","psychologist","clinician","admin","owner"]);
const SUPABASE_HOST=/^([a-z0-9]{20})\.supabase\.co$/;

export function isMyPracticeServerEnabled(env=process.env){
  if(env.MY_PRACTICE_SERVER_ENABLED!=="true")return false;
  if(env.VERCEL_ENV!=="preview")return false;
  const expected=env.MY_PRACTICE_ALLOWED_SUPABASE_REF;
  if(expected!==APPROVED_TEST_SUPABASE_REF)return false;
  if(!SUPABASE_HOST.test(expected+".supabase.co"))return false;
  try{
    const parsed=new URL(env.SUPABASE_URL||"");
    return parsed.protocol==="https:" && parsed.hostname===expected+".supabase.co";
  }catch{return false;}
}
export function isSameOriginPracticeRequest(headers={}){
  const origin=headers.origin,host=headers.host;
  if(typeof origin!=="string"||typeof host!=="string")return false;
  try {
    const url=new URL(origin);
    if(url.host!==host||url.pathname!=="/"||url.search||url.hash)return false;
    return url.protocol==="https:"||url.protocol==="http:"&&["localhost","127.0.0.1"].includes(url.hostname);
  } catch{return false;}
}
export function allowedPracticeOrganizations(memberships=[]){
  if(!Array.isArray(memberships))return [];
  return memberships.filter(m=>m&&CLINIC_ROLES.has(m.role_in_organization)&&typeof m.organization_id==="string")
    .map(m=>({organization_id:m.organization_id,name:m.organization_name||"Организация"}));
}

export async function handleMyPracticeWorkspace(req,res,{authorizeSpecialist,getSupabase,env=process.env}){
  res.setHeader("Cache-Control","no-store");
  if(!isMyPracticeServerEnabled(env))return res.status(404).json({ok:false,error:"Серверный черновик недоступен."});
  if(!isSameOriginPracticeRequest(req.headers))return res.status(403).json({ok:false,error:"Недопустимый источник запроса."});
  const action=req.body?.action;
  if(!["getMyPracticeWorkspace","saveMyPracticeWorkspace"].includes(action))return res.status(400).json({ok:false,error:"Некорректная операция."});
  const auth=await authorizeSpecialist(req);
  if(auth.error)return res.status(auth.status||401).json({ok:false,error:auth.error});
  if(!auth.expert?.id||!auth.expert?.is_active&&auth.expert?.is_active!==undefined)return res.status(403).json({ok:false,error:"Нет доступа."});
  const organizations=allowedPracticeOrganizations(auth.memberships);
  if(!organizations.length)return res.status(403).json({ok:false,error:"Нет разрешённых клиник."});
  const allowed=organizations.map(x=>x.organization_id);
  const supabase=getSupabase();
  if(action==="getMyPracticeWorkspace"){
    const {data,error}=await supabase.from(TABLE).select("version, workspace").eq("expert_id",auth.expert.id).maybeSingle();
    if(error)return res.status(503).json({ok:false,error:"Хранилище пока недоступно."});
    try{
      const workspace=normalizeMyPracticeWorkspace(data?.workspace||emptyMyPracticeWorkspace(),allowed);
      return res.status(200).json({ok:true,version:data?.version||0,workspace,organizations});
    }catch{
      return res.status(409).json({ok:false,error:"Доступ к организации изменился; обратитесь к администратору."});
    }
  }
  if(!isSafeMyPracticeVersion(req.body?.version))return res.status(400).json({ok:false,error:"Некорректная версия."});
  let workspace;
  try{
    workspace=normalizeMyPracticeWorkspace(req.body?.workspace,allowed);
  }catch(error){
    if(error instanceof WorkspaceValidationError)return res.status(400).json({ok:false,error:error.message});
    throw error;
  }
  const version=req.body.version;
  if(version===0){
    const {error}=await supabase.from(TABLE).insert({expert_id:auth.expert.id,version:1,workspace});
    if(error?.code==="23505")return res.status(409).json({ok:false,error:"Черновик изменён в другой вкладке. Обновите данные."});
    if(error)return res.status(503).json({ok:false,error:"Не удалось сохранить черновик."});
    return res.status(200).json({ok:true,version:1,workspace});
  }
  const {data,error}=await supabase.from(TABLE)
    .update({workspace,version:version+1,updated_at:new Date().toISOString()})
    .eq("expert_id",auth.expert.id).eq("version",version)
    .select("version").maybeSingle();
  if(error)return res.status(503).json({ok:false,error:"Не удалось сохранить черновик."});
  if(!data)return res.status(409).json({ok:false,error:"Черновик был изменён в другой вкладке. Перезагрузите данные."});
  return res.status(200).json({ok:true,version:data.version,workspace});
}
