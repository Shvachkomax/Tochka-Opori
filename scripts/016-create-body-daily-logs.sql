-- Body daily logs for "Опора. Здоровье & Стройность"
-- Daily diary entries for returning clients

create table if not exists body_daily_logs (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  module text not null default 'body',

  log_date date not null,

  weight_kg numeric,
  waist_cm numeric,

  steps integer,
  activity_comment text,

  workout_done boolean,
  workout_type text,
  workout_minutes integer,
  workout_intensity text,
  workout_comment text,

  calories integer,
  meals_count integer,
  breakfast text,
  lunch text,
  dinner text,
  snacks text,
  nutrition_comment text,

  overeating_level text,
  sweet_cravings text,

  water_l numeric,
  sleep_hours numeric,
  sleep_quality text,

  energy_level integer,
  mood_level integer,

  day_text text,
  voice_transcript text,

  plate_photos jsonb,

  ai_day_summary text,
  ai_focus_tomorrow text,

  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists idx_body_daily_logs_session_id
on body_daily_logs(session_id);

create index if not exists idx_body_daily_logs_log_date
on body_daily_logs(log_date);
