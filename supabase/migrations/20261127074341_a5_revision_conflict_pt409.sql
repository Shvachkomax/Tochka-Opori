-- Business revision conflicts must not use the retryable serialization SQLSTATE.
create or replace function public.save_medical_encounter_version(
 p_encounter_id uuid,p_expected_version integer,p_author_id uuid,p_owner_type text,p_owner_id uuid,p_module text,
 p_organization_id uuid,p_encounter_at timestamptz,p_status text,p_content jsonb,p_amendment_reason text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.medical_encounter_versions%rowtype; saved public.medical_encounter_versions%rowtype;
begin
 if p_expected_version is null or p_expected_version<0 then raise exception 'Invalid version' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('medical-encounter:'||p_encounter_id::text,0));
 select * into previous from public.medical_encounter_versions where encounter_id=p_encounter_id order by version desc limit 1;
 if found then
   if previous.author_id is distinct from p_author_id or previous.owner_type is distinct from p_owner_type
      or previous.owner_id is distinct from p_owner_id or previous.module is distinct from p_module
      or previous.organization_id is distinct from p_organization_id then
     raise exception 'Scope mismatch' using errcode='42501';
   end if;
   if previous.version<>p_expected_version then raise sqlstate 'PT409' using message='Revision conflict'; end if;
   -- Any correction after confirmation retains a reason, including its subsequent drafts.
   if exists(select 1 from public.medical_encounter_versions where encounter_id=p_encounter_id and status='confirmed')
      and length(btrim(coalesce(p_amendment_reason,'')))=0 then raise exception 'Correction reason required' using errcode='22023'; end if;
 else
   if p_expected_version<>0 then raise sqlstate 'PT409' using message='Revision conflict'; end if;
 end if;
 insert into public.medical_encounter_versions(encounter_id,version,author_id,owner_type,owner_id,module,organization_id,encounter_at,status,content,amendment_reason)
 values(p_encounter_id,p_expected_version+1,p_author_id,p_owner_type,p_owner_id,p_module,p_organization_id,p_encounter_at,p_status,p_content,coalesce(p_amendment_reason,'')) returning * into saved;
 return jsonb_build_object('encounter_id',saved.encounter_id,'version',saved.version,'status',saved.status);
end;
$$;
