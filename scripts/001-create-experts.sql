-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/blwogrdezfhprdpdnxtn/sql/new)

-- 1. Create experts table
create table if not exists experts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  role text,
  specialty text,
  city text,
  organization text,
  access_code text unique not null,
  is_active boolean default true,
  created_at timestamptz default now()
);

create index if not exists experts_access_code_idx on experts(access_code);

-- 2. Add expert columns to case_reviews
alter table case_reviews
add column if not exists expert_id uuid;

alter table case_reviews
add column if not exists expert_name text;

alter table case_reviews
add column if not exists expert_role text;

alter table case_reviews
add column if not exists expert_specialty text;

-- 3. Insert test experts
insert into experts
  (name, email, role, specialty, city, organization, access_code)
values
  ('Максим Швачко', 'shvachkomax@gmail.com', 'admin', 'psychiatry', 'Москва', 'Точка Опоры', 'MAXIM-ADMIN-01'),
  ('Анна Иванова', 'anna@example.com', 'psychologist', 'clinical-psychology', 'Санкт-Петербург', 'Клиника СПб', 'ANNA-PSY-01')
on conflict (access_code) do nothing;
