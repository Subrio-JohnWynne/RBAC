
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null default '',
  role          text not null default 'viewer'
                  check (role in ('viewer', 'editor', 'admin')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.profiles is 'Stores user profile data and RBAC roles.';

create table if not exists public.content (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  body              text,
  created_by        uuid references auth.users(id) on delete set null,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.content is 'Content records managed by editors and admins.';

-- ACTIVITY LOGS TABLE
create table if not exists public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  user_name   text,
  action      text not null,
  details     text,
  created_at  timestamptz not null default now()
);
comment on table public.activity_logs is 'Audit log of all user actions for admin review.';


-- ──────────────────────────────────────────────
-- STEP 2: ENABLE ROW LEVEL SECURITY
-- ──────────────────────────────────────────────

alter table public.profiles      enable row level security;
alter table public.content       enable row level security;
alter table public.activity_logs enable row level security;


-- ──────────────────────────────────────────────
-- STEP 3: RLS POLICIES — PROFILES
-- ──────────────────────────────────────────────

drop policy if exists "profiles: anyone authenticated can view"  on public.profiles;
drop policy if exists "profiles: user can insert own row"        on public.profiles;
drop policy if exists "profiles: user can update own row"        on public.profiles;
drop policy if exists "profiles: admin can update any row"       on public.profiles;

create policy "profiles: anyone authenticated can view"
  on public.profiles for select
  using (auth.uid() is not null);

create policy "profiles: user can insert own row"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles: user can update own row"
  on public.profiles for update
  using (auth.uid() = id);

create policy "profiles: admin can update any row"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );


-- ──────────────────────────────────────────────
-- STEP 4: RLS POLICIES — CONTENT
-- ──────────────────────────────────────────────

drop policy if exists "content: authenticated users can view"  on public.content;
drop policy if exists "content: editor and admin can insert"   on public.content;
drop policy if exists "content: editor and admin can update"   on public.content;
drop policy if exists "content: editor and admin can delete"   on public.content;

create policy "content: authenticated users can view"
  on public.content for select
  using (auth.uid() is not null);

create policy "content: editor and admin can insert"
  on public.content for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('editor', 'admin')
    )
  );

create policy "content: editor and admin can update"
  on public.content for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('editor', 'admin')
    )
  );

create policy "content: editor and admin can delete"
  on public.content for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('editor', 'admin')
    )
  );


-- ──────────────────────────────────────────────
-- STEP 5: RLS POLICIES — ACTIVITY LOGS
-- ──────────────────────────────────────────────

drop policy if exists "logs: only admin can view"         on public.activity_logs;
drop policy if exists "logs: authenticated users can log" on public.activity_logs;

create policy "logs: only admin can view"
  on public.activity_logs for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "logs: authenticated users can log"
  on public.activity_logs for insert
  with check (auth.uid() is not null);



create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'viewer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();


-- ──────────────────────────────────────────────
-- STEP 7: AUTO-UPDATE updated_at TRIGGER
-- ──────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_content_updated_at on public.content;
create trigger set_content_updated_at
  before update on public.content
  for each row execute function public.set_updated_at();




create or replace view public.v_users_with_roles as
  select
    p.id,
    p.full_name,
    p.role,
    u.email,
    p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.created_at desc;

create or replace view public.v_recent_activity as
  select
    l.id,
    l.user_name,
    l.action,
    l.details,
    l.created_at
  from public.activity_logs l
  order by l.created_at desc
  limit 200;



insert into public.content (title, body, created_by_name)
select * from (values
  ('Welcome to RBAC System',   'This is the role-based access control system for INFOSEC32. Viewers can read; Editors can modify; Admins manage all.', 'System'),
  ('Security Policy v1.0',     'All users must adhere to the access control policies defined in this system. Unauthorized access attempts are logged.', 'System'),
  ('Activity Log Guidelines',  'All actions performed in this system are recorded. Admins can review the full audit trail in the Activity Logs panel.', 'System')
) as v(title, body, created_by_name)
where not exists (select 1 from public.content limit 1);

