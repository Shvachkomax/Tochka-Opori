-- Add module column to sessions and case_reviews for multi-module support
alter table sessions
add column if not exists module text default 'support';

alter table case_reviews
add column if not exists module text default 'support';

create index if not exists sessions_module_idx on sessions(module);
create index if not exists case_reviews_module_idx on case_reviews(module);

-- Add module column to training_sessions as well
alter table training_sessions
add column if not exists module text default 'support';

create index if not exists training_sessions_module_idx on training_sessions(module);
