-- Migration v2: comptes élèves, candidatures authentifiées, chat du bureau et stockage des avatars.
-- À exécuter dans Supabase SQL Editor APRÈS schema.sql. Sauvegardez la base avant migration.
alter table public.profiles add column if not exists first_name text not null default '';
alter table public.profiles add column if not exists last_name text not null default '';
alter table public.profiles add column if not exists grade_level text not null default '';
alter table public.profiles add column if not exists track text not null default '';
alter table public.profiles add column if not exists class_number text not null default '';
alter table public.profiles add column if not exists avatar_url text;
alter table public.applications add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.applications add column if not exists rejection_reason text;

-- Create student profile server-side from signup metadata (works even when email confirmation is enabled).
create or replace function public.handle_new_student_profile()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
 insert into public.profiles(id,full_name,first_name,last_name,email,grade_level,track,class_number,role)
 values(new.id,
   trim(coalesce(new.raw_user_meta_data->>'first_name','')||' '||coalesce(new.raw_user_meta_data->>'last_name','')),
   coalesce(new.raw_user_meta_data->>'first_name',''),
   coalesce(new.raw_user_meta_data->>'last_name',''),
   coalesce(new.email,''),
   coalesce(new.raw_user_meta_data->>'grade_level',''),
   coalesce(new.raw_user_meta_data->>'track',''),
   coalesce(new.raw_user_meta_data->>'class_number',''),
   'editor')
 on conflict(id) do nothing;
 return new;
end $$;
drop trigger if exists on_auth_user_created_club_profile on auth.users;
create trigger on_auth_user_created_club_profile after insert on auth.users
for each row execute procedure public.handle_new_student_profile();
create index if not exists applications_user_id_idx on public.applications(user_id);
create table if not exists public.chat_messages(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 author_name text not null default '',
 message text not null check(char_length(message) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index if not exists chat_messages_created_at_idx on public.chat_messages(created_at);
alter table public.chat_messages enable row level security;

-- Profiles: allow a student to create/update only their own non-privileged profile.
drop policy if exists "profile self insert" on public.profiles;
create policy "profile self insert" on public.profiles for insert to authenticated
 with check (id=auth.uid() and role='editor' and email=auth.jwt()->>'email');
drop policy if exists "profile self update" on public.profiles;
create policy "profile self update" on public.profiles for update to authenticated
 using (id=auth.uid() and role='editor') with check (id=auth.uid() and role='editor');

-- Only authenticated students can submit their own applications; staff can review/delete.
drop policy if exists "public submit application" on public.applications;
drop policy if exists "student submit own application" on public.applications;
create policy "student submit own application" on public.applications for insert to authenticated
 with check (user_id=auth.uid() and consent=true and status='pending' and internal_notes is null and reviewed_by is null and reviewed_at is null);
drop policy if exists "student read own applications" on public.applications;
create policy "student read own applications" on public.applications for select to authenticated
 using (user_id=auth.uid() or public.is_club_editor());

drop policy if exists "chat staff read" on public.chat_messages;
create policy "chat staff read" on public.chat_messages for select to authenticated using(public.is_club_editor());
drop policy if exists "chat staff send" on public.chat_messages;
create policy "chat staff send" on public.chat_messages for insert to authenticated with check(public.is_club_editor() and user_id=auth.uid());

-- Student profile avatars: public read, owner upload/update/delete only.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-photos','profile-photos',true,2097152,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=true,file_size_limit=2097152,allowed_mime_types=array['image/png','image/jpeg','image/webp'];
drop policy if exists "Avatar public read" on storage.objects;
create policy "Avatar public read" on storage.objects for select to public using(bucket_id='profile-photos');
drop policy if exists "Avatar owner insert" on storage.objects;
create policy "Avatar owner insert" on storage.objects for insert to authenticated with check(bucket_id='profile-photos' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Avatar owner update" on storage.objects;
create policy "Avatar owner update" on storage.objects for update to authenticated using(bucket_id='profile-photos' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='profile-photos' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Avatar owner delete" on storage.objects;
create policy "Avatar owner delete" on storage.objects for delete to authenticated using(bucket_id='profile-photos' and (storage.foldername(name))[1]=auth.uid()::text);

-- Ensure API roles can access intended tables; RLS policies remain the actual security boundary.
grant select,insert,update,delete on public.profiles,public.applications,public.projects,public.events,public.event_images,public.members,public.contact_messages,public.site_settings,public.chat_messages to authenticated;
grant select on public.events,public.projects,public.event_images,public.site_settings to anon,authenticated;
grant insert on public.contact_messages to anon;

-- Public settings are limited to explicitly public keys (no admin/internal settings).
drop policy if exists "public read hero announcement" on public.site_settings;
create policy "public read hero announcement" on public.site_settings for select to anon,authenticated
using(setting_key in ('hero_announcement','site_notice','club_name'));
drop policy if exists "staff read all profiles" on public.profiles;
create policy "staff read all profiles" on public.profiles for select to authenticated using(public.is_club_editor());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('club-media','club-media',true,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/png','image/jpeg','image/webp'];
drop policy if exists "Club media public read" on storage.objects;
create policy "Club media public read" on storage.objects for select to public using(bucket_id='club-media');
drop policy if exists "Club staff upload media" on storage.objects;
create policy "Club staff upload media" on storage.objects for insert to authenticated with check(bucket_id='club-media' and public.is_club_editor());
drop policy if exists "Club staff update media" on storage.objects;
create policy "Club staff update media" on storage.objects for update to authenticated using(bucket_id='club-media' and public.is_club_editor()) with check(bucket_id='club-media' and public.is_club_editor());
drop policy if exists "Club staff delete media" on storage.objects;
create policy "Club staff delete media" on storage.objects for delete to authenticated using(bucket_id='club-media' and public.is_club_editor());
