-- Club de Solidarité ELARAKI — schéma initial Supabase
-- Exécuter une seule fois dans un projet vierge. Ne pas utiliser une clé service_role côté navigateur.
create extension if not exists pgcrypto;

do $$ begin
  create type public.club_role as enum ('admin','editor');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.application_status as enum ('pending','accepted','rejected','archived');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.content_status as enum ('draft','published','archived');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  role public.club_role not null default 'editor',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null,
  class_name text not null default '',
  phone text,
  interest_area text not null default '',
  joined_at date not null default current_date,
  status text not null default 'active' check (status in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists members_email_lower_idx on public.members (lower(email)) where status <> 'archived';
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null check (char_length(last_name) between 1 and 80),
  email text not null check (char_length(email) <= 180),
  class_name text not null check (char_length(class_name) <= 80),
  phone text,
  interest_area text not null,
  motivation text not null check (char_length(motivation) between 15 and 2000),
  availability text,
  consent boolean not null default false check (consent = true),
  status public.application_status not null default 'pending',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  internal_notes text,
  created_at timestamptz not null default now()
);
create index if not exists applications_status_date_idx on public.applications(status, submitted_at desc);
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  short_description text not null default '',
  description text not null default '',
  cover_image text,
  category text not null default 'Solidarité',
  location text,
  start_date date,
  end_date date,
  status text not null default 'draft' check (status in ('draft','preparing','ongoing','completed','archived')),
  is_featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  summary text not null default '',
  description text not null default '',
  event_date date,
  published_at timestamptz,
  date_type text not null default 'reference' check (date_type in ('actual','publication','reference')),
  category text not null default 'Solidarité',
  location text,
  cover_image text,
  status public.content_status not null default 'draft',
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.event_images (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  image_url text not null,
  alt_text text not null default '',
  caption text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null,
  subject text not null,
  message text not null check (char_length(message) between 1 and 3000),
  status text not null default 'new' check (status in ('new','read','handled','archived')),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create table if not exists public.site_settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null unique,
  setting_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  created_at timestamptz not null default now()
);

create or replace function public.is_club_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') $$;
create or replace function public.is_club_editor()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','editor')) $$;

alter table public.profiles enable row level security;
alter table public.members enable row level security;
alter table public.applications enable row level security;
alter table public.projects enable row level security;
alter table public.events enable row level security;
alter table public.event_images enable row level security;
alter table public.contact_messages enable row level security;
alter table public.site_settings enable row level security;
alter table public.activity_logs enable row level security;

-- Profiles: users can read only their own profile; only admins can manage roles.
drop policy if exists "profile self read" on public.profiles;
create policy "profile self read" on public.profiles for select to authenticated using (id = auth.uid() or public.is_club_admin());
drop policy if exists "profile admin manage" on public.profiles;
create policy "profile admin manage" on public.profiles for all to authenticated using (public.is_club_admin()) with check (public.is_club_admin());

-- Public forms: anonymous visitors may submit, but never read or update submissions.
drop policy if exists "public submit application" on public.applications;
create policy "public submit application" on public.applications for insert to anon, authenticated with check (consent = true and status = 'pending' and internal_notes is null and reviewed_by is null and reviewed_at is null);
drop policy if exists "staff manage applications" on public.applications;
create policy "staff manage applications" on public.applications for all to authenticated using (public.is_club_editor()) with check (public.is_club_editor());

drop policy if exists "public submit contact" on public.contact_messages;
create policy "public submit contact" on public.contact_messages for insert to anon, authenticated with check (status = 'new' and handled_at is null);
drop policy if exists "staff manage messages" on public.contact_messages;
create policy "staff manage messages" on public.contact_messages for all to authenticated using (public.is_club_editor()) with check (public.is_club_editor());

drop policy if exists "public read published events" on public.events;
create policy "public read published events" on public.events for select to anon, authenticated using (status = 'published' or public.is_club_editor());
drop policy if exists "staff manage events" on public.events;
create policy "staff manage events" on public.events for all to authenticated using (public.is_club_editor()) with check (public.is_club_editor());

drop policy if exists "public read published projects" on public.projects;
create policy "public read published projects" on public.projects for select to anon, authenticated using (status in ('ongoing','completed') or public.is_club_editor());
drop policy if exists "staff manage projects" on public.projects;
create policy "staff manage projects" on public.projects for all to authenticated using (public.is_club_editor()) with check (public.is_club_editor());

drop policy if exists "public read images for published events" on public.event_images;
create policy "public read images for published events" on public.event_images for select to anon, authenticated using (exists(select 1 from public.events e where e.id=event_id and e.status='published') or public.is_club_editor());
drop policy if exists "staff manage event images" on public.event_images;
create policy "staff manage event images" on public.event_images for all to authenticated using (public.is_club_editor()) with check (public.is_club_editor());

drop policy if exists "staff manage members" on public.members;
create policy "staff manage members" on public.members for all to authenticated using (public.is_club_editor()) with check (public.is_club_editor());
drop policy if exists "staff manage settings" on public.site_settings;
create policy "staff manage settings" on public.site_settings for all to authenticated using (public.is_club_admin()) with check (public.is_club_admin());
drop policy if exists "admins read activity logs" on public.activity_logs;
create policy "admins read activity logs" on public.activity_logs for select to authenticated using (public.is_club_admin());
drop policy if exists "staff insert activity logs" on public.activity_logs;
create policy "staff insert activity logs" on public.activity_logs for insert to authenticated with check (public.is_club_editor());

-- Create the first auth user in Supabase Dashboard > Authentication, then promote that UUID
-- using the SQL editor controlled by the project owner:
-- insert into public.profiles (id, full_name, email, role)
-- values ('AUTH_USER_UUID', 'Nom administrateur', 'email@exemple.ma', 'admin')
-- on conflict (id) do update set role='admin', updated_at=now();
