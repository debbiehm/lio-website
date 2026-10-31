-- Lio｜狮小智 website: database + file storage + security rules.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Before running, replace AGENT_EMAIL below with the email you will use to sign in from Lio (your own account).

-- ------------------------------------------------------------------ settings
create or replace function public.is_agent() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'AGENT_EMAIL'
$$;

-- ------------------------------------------------------------------ client profile (one row per website user)
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  name          text,
  phone         text,
  ic            text,
  state         text,          -- 州属: Pulau Pinang, Selangor, ...
  city          text,
  postcode      text,
  occupation    text,
  employer      text,
  income        numeric,       -- 每年收入 RM
  living        numeric,       -- 家庭每年生活费 RM
  support_years numeric,       -- 要照顾家人几年
  debts         numeric,       -- 债务总额 RM
  education     numeric,       -- 子女教育费 RM
  assets        numeric,       -- 可用资产 RM
  dependants    integer,       -- 受抚养人数
  med_room      numeric,       -- 想要的病房 RM / 晚
  med_annual    numeric,       -- 想要的每年医疗限额 RM
  notes         text,
  consent_at    timestamptz,   -- PDPA consent given
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ------------------------------------------------------------------ uploaded policy documents
create table if not exists public.policy_uploads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  file_path   text not null,     -- path inside the 'policies' storage bucket: <user id>/<file name>
  file_name   text,
  note        text,
  created_at  timestamptz default now()
);

-- ------------------------------------------------------------------ row level security: clients see only their own rows,
-- the agent (AGENT_EMAIL) can read everything
alter table public.profiles enable row level security;
alter table public.policy_uploads enable row level security;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select using (auth.uid() = id or public.is_agent());
drop policy if exists "own profile write" on public.profiles;
create policy "own profile write" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own uploads read" on public.policy_uploads;
create policy "own uploads read" on public.policy_uploads for select using (auth.uid() = user_id or public.is_agent());
drop policy if exists "own uploads add" on public.policy_uploads;
create policy "own uploads add" on public.policy_uploads for insert with check (auth.uid() = user_id);
drop policy if exists "own uploads delete" on public.policy_uploads;
create policy "own uploads delete" on public.policy_uploads for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------------ private file bucket for policy PDFs
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('policies', 'policies', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "own files upload" on storage.objects;
create policy "own files upload" on storage.objects for insert
  with check (bucket_id = 'policies' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "own files read" on storage.objects;
create policy "own files read" on storage.objects for select
  using (bucket_id = 'policies' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_agent()));
drop policy if exists "own files delete" on storage.objects;
create policy "own files delete" on storage.objects for delete
  using (bucket_id = 'policies' and (storage.foldername(name))[1] = auth.uid()::text);
