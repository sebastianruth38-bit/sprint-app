-- Sprint Lab schema
-- Run this once in your Supabase project's SQL Editor (Project > SQL Editor > New query).
-- Every table is scoped to auth.uid() via Row Level Security, so each signed-in
-- user only ever sees their own rows.

create extension if not exists "pgcrypto";

-- ---------- Workouts (one row per day-of-week per user) ----------
create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day text not null check (day in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  type text not null,
  details text,
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

-- ---------- Logged times ----------
create table if not exists public.times (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  distance text not null,
  time text not null,
  logged_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- ---------- Big goals + small goals ----------
create table if not exists public.big_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.small_goals (
  id uuid primary key default gen_random_uuid(),
  big_goal_id uuid not null references public.big_goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- Weight-room exercises + weekly completion checks ----------
create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  url text,
  is_custom boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.weight_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  week_key text not null, -- e.g. "2026-W36"
  done boolean not null default true,
  unique (user_id, exercise_id, week_key)
);

-- ---------- Form diagnosis entries ----------
-- video_path points at a file in the `diagnosis-videos` storage bucket, e.g. `${user_id}/${entry_id}.webm`
create table if not exists public.diagnosis_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notes text,
  video_path text,
  clip_type text, -- 'Acceleration' | 'Max Velocity' | 'Speed Endurance'
  distance text,
  effort text,
  created_at timestamptz not null default now()
);

-- ---------- Motivation favorites ----------
create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  url text not null,
  created_at timestamptz not null default now()
);

-- ---------- Weekly availability (guideline, not a hard schedule) ----------
create table if not exists public.availability (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_key text not null, -- e.g. "2026-W36"
  sprint_days jsonb not null default '[]'::jsonb, -- e.g. ["Monday","Wednesday"]
  gym_days jsonb not null default '[]'::jsonb,
  unique (user_id, week_key)
);

-- ---------- Row Level Security: every table, owner-only ----------
alter table public.workouts enable row level security;
alter table public.times enable row level security;
alter table public.big_goals enable row level security;
alter table public.small_goals enable row level security;
alter table public.exercises enable row level security;
alter table public.weight_checks enable row level security;
alter table public.diagnosis_entries enable row level security;
alter table public.favorites enable row level security;
alter table public.availability enable row level security;
do $$
declare
  t text;
begin
  foreach t in array array['workouts','times','big_goals','small_goals','exercises','weight_checks','diagnosis_entries','favorites','availability']
  loop
    execute format('
      create policy "owner_select" on public.%I for select using (auth.uid() = user_id);
      create policy "owner_insert" on public.%I for insert with check (auth.uid() = user_id);
      create policy "owner_update" on public.%I for update using (auth.uid() = user_id);
      create policy "owner_delete" on public.%I for delete using (auth.uid() = user_id);
    ', t, t, t, t);
  end loop;
end $$;

-- ---------- Storage bucket for diagnosis video clips ----------
insert into storage.buckets (id, name, public)
values ('diagnosis-videos', 'diagnosis-videos', false)
on conflict (id) do nothing;

create policy "owner_read_own_videos"
  on storage.objects for select
  using (bucket_id = 'diagnosis-videos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owner_upload_own_videos"
  on storage.objects for insert
  with check (bucket_id = 'diagnosis-videos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owner_delete_own_videos"
  on storage.objects for delete
  using (bucket_id = 'diagnosis-videos' and (storage.foldername(name))[1] = auth.uid()::text);
