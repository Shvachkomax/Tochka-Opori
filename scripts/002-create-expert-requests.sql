-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/blwogrdezfhprdpdnxtn/sql/new)

-- Create expert_requests table
create table if not exists expert_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  telegram text,
  role text not null,
  specialty text,
  city text,
  organization text,
  comment text,
  status text default 'pending',
  created_at timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  reviewer_comment text
);

create index if not exists expert_requests_status_idx
on expert_requests(status);
