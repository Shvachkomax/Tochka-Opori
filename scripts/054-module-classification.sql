alter table published_clinical_cases
  add column if not exists modules text[] not null default '{}';
alter table published_clinical_cases
  add column if not exists clinical_tags text[] not null default '{}';
create index if not exists idx_published_cases_modules on published_clinical_cases using gin(modules);
create index if not exists idx_published_cases_tags on published_clinical_cases using gin(clinical_tags);
