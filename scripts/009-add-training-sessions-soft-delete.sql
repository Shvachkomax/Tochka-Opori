-- Soft delete columns for training_sessions
-- Запись считается удалённой, если deleted_at is not null

alter table training_sessions
add column if not exists deleted_at timestamptz;

alter table training_sessions
add column if not exists deleted_by_expert_id uuid;

alter table training_sessions
add column if not exists deleted_by_expert_name text;

alter table training_sessions
add column if not exists deletion_reason text;

create index if not exists training_sessions_deleted_at_idx
on training_sessions(deleted_at);
