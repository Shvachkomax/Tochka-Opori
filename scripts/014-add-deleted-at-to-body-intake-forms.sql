-- Soft delete for body_intake_forms
alter table body_intake_forms
add column if not exists deleted_at timestamptz;

alter table body_intake_forms
add column if not exists deleted_by text;

-- Router metadata columns (from model router)
alter table body_intake_forms
add column if not exists provider text;

alter table body_intake_forms
add column if not exists ai_model text;

alter table body_intake_forms
add column if not exists task_type text;

alter table body_intake_forms
add column if not exists router_version text;

alter table body_intake_forms
add column if not exists request_duration_ms integer;

-- Red flag / fallback columns (already populated by analyze.js)
alter table body_intake_forms
add column if not exists triggered_red_flags jsonb;

alter table body_intake_forms
add column if not exists red_flag_care_level text;

alter table body_intake_forms
add column if not exists used_fallback boolean default false;
