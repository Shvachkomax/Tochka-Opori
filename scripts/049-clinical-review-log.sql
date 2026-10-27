create table if not exists clinical_review_log (
  id uuid primary key default gen_random_uuid(),
  reviewer_id uuid not null references experts(id) on delete restrict,
  publication_id text not null,
  publication_version text,
  decision text not null check (decision in ('approve','request_changes','reject')),
  comment text not null,
  created_at timestamptz not null default now(),
  unique (reviewer_id, publication_id, publication_version, decision)
);
alter table clinical_review_log enable row level security;
create policy "review_log_service_only" on clinical_review_log for all to service_role using (true) with check (true);
create policy "review_log_append_only" on clinical_review_log for insert to service_role with check (true);

create or replace function prevent_review_log_mutation()
returns trigger as $$
begin
  raise exception 'clinical_review_log is append-only';
end;
$$ language plpgsql;

drop trigger if exists trg_review_log_no_update on clinical_review_log;
create trigger trg_review_log_no_update
before update on clinical_review_log
for each row execute function prevent_review_log_mutation();

drop trigger if exists trg_review_log_no_delete on clinical_review_log;
create trigger trg_review_log_no_delete
before delete on clinical_review_log
for each row execute function prevent_review_log_mutation();

create or replace function approve_published_case(
  p_reviewer_id uuid,
  p_publication_id text,
  p_version text,
  p_comment text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
as $$
declare
  v_existing uuid;
begin
  select id into v_existing from clinical_review_log
  where reviewer_id = p_reviewer_id
    and publication_id = p_publication_id
    and (p_version is null or publication_version = p_version)
  limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;

  insert into clinical_review_log (reviewer_id, publication_id, publication_version, decision, comment)
  values (p_reviewer_id, p_publication_id, p_version, 'approve', p_comment);

  update published_clinical_cases
  set expert_review_status = 'approved', updated_at = now()
  where id::text = p_publication_id;

  return jsonb_build_object('ok', true, 'idempotent', false);
end;
$$;
