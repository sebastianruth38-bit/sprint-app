-- Sprintr schema
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
  timed text, -- 'Timed' | 'Untimed' | null
  lift_details text,
  lift_log jsonb, -- weight actually used per lift exercise, e.g. {"Power Cleans 3x3-5": "135lbs"}
  logged_result jsonb, -- time actually run per sprint segment, e.g. {"2x20": "3.1", "2x25": "3.6"}
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

-- ---------- Form Reference movements (name + a form video link) ----------
create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  url text,
  is_custom boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Form diagnosis entries ----------
-- video_path points at a file in the `diagnosis-videos` storage bucket, e.g. `${user_id}/${entry_id}.webm`
create table if not exists public.diagnosis_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notes text,
  -- Entries saved before 2026-09-10 have a clip in the bucket and keep
  -- playing it until the retention purge takes it. Nothing is stored here
  -- for entries saved since: key_frames replaced it.
  video_path text,
  -- Stills at the moments the grader actually measured, in place of the
  -- clip: [{ path, label, measure, t }]. A handful of ~40KB JPEGs against a
  -- 3MB video, and each one is the exact instant a score refers to, which
  -- the video never told you.
  key_frames jsonb,
  clip_type text, -- 'Acceleration' | 'Max Velocity' | 'Speed Endurance'
  distance text,
  effort text,
  analysis jsonb, -- AI-generated: { summary, pinpoints[], additional_observations[], flags[] }
  -- A ~240px JPEG data url of one graded frame, kept in the row rather than
  -- in storage on purpose. It arrives with the list query the app already
  -- makes, so the history can show a preview without signing a url or
  -- fetching a file per entry. The clips themselves are 20-30MB and a phone
  -- writes the file index at the end of the file, so anything that makes the
  -- browser touch the video just to draw a still costs most of the clip.
  thumb text,
  created_at timestamptz not null default now()
);
alter table public.diagnosis_entries add column if not exists thumb text;
alter table public.diagnosis_entries add column if not exists key_frames jsonb;
alter table public.athlete_settings add column if not exists has_gym boolean not null default true;

-- ---------- Form analysis criteria (per-athlete custom good/bad cues) ----------
create table if not exists public.form_criteria (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  good_desc text,
  bad_desc text,
  created_at timestamptz not null default now()
);

-- ---------- AI analysis quota (per user, per day) ----------
-- Caps what a single account can spend on the Anthropic API. Deliberately
-- has no client-facing write policy: the counter is only ever changed by
-- consume_analysis_quota() below, called by the Edge Function with the
-- service role. If the user it limits could write it, it wouldn't be a limit.
create table if not exists public.analysis_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);

-- Atomic check-and-increment. The `where count < p_limit` guard lives on the
-- ON CONFLICT update, so two concurrent requests can't both slip past the
-- limit -- the loser updates zero rows and RETURNING yields nothing.
create or replace function public.consume_analysis_quota(p_user_id uuid, p_limit int)
returns table (allowed boolean, used int, quota int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used int;
begin
  insert into public.analysis_usage as au (user_id, day, count)
  values (p_user_id, current_date, 1)
  on conflict (user_id, day) do update
    set count = au.count + 1
    where au.count < p_limit
  returning au.count into v_used;

  if v_used is null then
    select au.count into v_used
    from public.analysis_usage au
    where au.user_id = p_user_id and au.day = current_date;
    return query select false, coalesce(v_used, p_limit), p_limit;
    return; -- `return query` alone falls through and would also emit the allowed row
  end if;

  return query select true, v_used, p_limit;
end;
$$;

revoke all on function public.consume_analysis_quota(uuid, int) from public, anon, authenticated;
grant execute on function public.consume_analysis_quota(uuid, int) to service_role;

-- ---------- Motivation favorites ----------
-- Saved video links from the old Hype tab, which the warm-up replaced on
-- 10 September 2026. Nothing reads or writes this any more; it is left in
-- place rather than dropped because a drop is irreversible and an empty table
-- costs nothing. Remove it if the warm-up sticks.
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

-- ---------- Competition season (one row per athlete, not per week) ----------
create table if not exists public.competition_seasons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  indoor_start date,
  indoor_end date,
  outdoor_start date,
  outdoor_end date,
  updated_at timestamptz not null default now()
);

-- ---------- Athlete settings: events, equipment, next meet ----------
create table if not exists public.athlete_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  primary_events jsonb not null default '[]'::jsonb,
  equipment jsonb not null default '[]'::jsonb,
  -- Whether there is a weight room. Defaults true, and is its own column
  -- rather than an entry in `equipment` above: in that array absent means
  -- "does not have it", so a "Gym" chip would have flipped every existing
  -- athlete to bodyweight the moment it shipped.
  has_gym boolean not null default true,
  next_meet_date date,
  next_meet_events jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- Row Level Security: every table, owner-only ----------
alter table public.workouts enable row level security;
alter table public.times enable row level security;
alter table public.big_goals enable row level security;
alter table public.small_goals enable row level security;
alter table public.exercises enable row level security;
alter table public.diagnosis_entries enable row level security;
alter table public.favorites enable row level security;
alter table public.competition_seasons enable row level security;
alter table public.availability enable row level security;
alter table public.athlete_settings enable row level security;
alter table public.form_criteria enable row level security;
alter table public.analysis_usage enable row level security;
do $$
declare
  t text;
begin
  foreach t in array array['workouts','times','big_goals','small_goals','exercises','diagnosis_entries','favorites','availability','competition_seasons','athlete_settings','form_criteria']
  loop
    execute format('
      create policy "owner_select" on public.%I for select using (auth.uid() = user_id);
      create policy "owner_insert" on public.%I for insert with check (auth.uid() = user_id);
      create policy "owner_update" on public.%I for update using (auth.uid() = user_id);
      create policy "owner_delete" on public.%I for delete using (auth.uid() = user_id);
    ', t, t, t, t);
  end loop;
end $$;

-- analysis_usage gets SELECT only -- see the note on the table above.
create policy "owner_select" on public.analysis_usage
  for select using (auth.uid() = user_id);

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

-- ---------- Marks the athlete is chasing ----------
-- Records, standards, a rival's time -- whatever they are actually running at.
-- Free-form rather than a built-in table of records: what is worth chasing is
-- personal, and a hard-coded record list goes stale with no way for the person
-- looking at it to correct it.
create table if not exists public.benchmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  distance text not null,          -- '100m', '60m', matches the times table
  label text not null,             -- 'World record', 'State qualifier', 'Marcus'
  seconds numeric not null,
  created_at timestamptz not null default now()
);
alter table public.benchmarks enable row level security;
create index if not exists benchmarks_user_distance on public.benchmarks (user_id, distance);
