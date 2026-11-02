-- 狮爷谈金融 Lio Talk: AI reading of uploaded policies (run once in Supabase → SQL Editor, after schema.sql).
-- The read-policy cloud function writes one row per uploaded file; clients see their own rows, the agent sees all.

create table if not exists public.policy_extracts (
  upload_id   uuid primary key references public.policy_uploads(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'reading',   -- reading | done | failed
  data        jsonb,                              -- what was read (see supabase/functions/read-policy)
  error       text,
  model       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table public.policy_extracts enable row level security;

drop policy if exists "own extracts read" on public.policy_extracts;
create policy "own extracts read" on public.policy_extracts for select using (auth.uid() = user_id or public.is_agent());
-- No insert/update policies: only the cloud function (service role) writes here.
