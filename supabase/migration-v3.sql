-- =====================================================================
-- Migration v3 — Club Solidarité ELARAKI
-- Rôles & permissions, sécurisation de l'administration, candidatures
-- bénévoles, chat (édition/suppression/Realtime), équipe dirigeante,
-- annonces (photos), journal d'audit.
--
-- À EXÉCUTER dans Supabase > SQL Editor, APRÈS schema.sql et migration-v2.sql.
-- Idempotente : peut être relancée sans erreur « already exists ».
-- Sauvegardez la base avant (Database > Backups).
-- Retour arrière : voir rollback-v3.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Catalogue des rôles et des permissions
-- ---------------------------------------------------------------------
create table if not exists public.club_permissions (
  perm_key text primary key,
  label text not null
);
insert into public.club_permissions(perm_key,label) values
  ('applications','Candidatures'),
  ('volunteers','Bénévoles'),
  ('members','Membres'),
  ('projects','Projets & actions'),
  ('events','Annonces & événements'),
  ('chat','Chat du club'),
  ('chat_moderate','Modération du chat'),
  ('settings','Paramètres du site'),
  ('contact','Messages de contact'),
  ('team','Équipe dirigeante'),
  ('management','Gestion des comptes')
on conflict (perm_key) do update set label = excluded.label;

create table if not exists public.club_roles (
  role_key text primary key check (role_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null,
  rank integer not null default 0,
  default_permissions text[] not null default '{}',
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);
-- Les rôles sont des données : on peut en ajouter (INSERT) sans modifier le code.
insert into public.club_roles(role_key,label,rank,default_permissions,is_system) values
  ('super_admin','Super administrateur',100,array['applications','volunteers','members','projects','events','chat','chat_moderate','settings','contact','team','management'],true),
  ('admin','Administrateur',80,array['applications','volunteers','members','projects','events','chat','chat_moderate','settings','contact','team'],true),
  ('responsable','Responsable',50,'{}',true),
  ('benevole','Bénévole',20,'{}',true),
  ('eleve','Élève',10,'{}',true)
on conflict (role_key) do nothing;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role_key text not null references public.club_roles(role_key) on update cascade,
  permissions text[] not null default '{}',
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_roles_role_idx on public.user_roles(role_key);

alter table public.club_permissions enable row level security;
alter table public.club_roles enable row level security;
alter table public.user_roles enable row level security;

-- ---------------------------------------------------------------------
-- 2. Fonctions d'autorisation (SECURITY DEFINER : le client ne les falsifie pas)
-- ---------------------------------------------------------------------
create or replace function public.club_role_rank(p_role text)
returns integer language sql stable security definer set search_path = public
as $$ select coalesce((select rank from public.club_roles where role_key = p_role), 0) $$;

create or replace function public.club_effective_permissions(p_user uuid)
returns text[] language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case
      when ur.role_key = 'super_admin'
        then (select coalesce(array_agg(perm_key), '{}') from public.club_permissions)
      else (select coalesce(array_agg(distinct x), '{}')
              from unnest(coalesce(r.default_permissions, '{}') || coalesce(ur.permissions, '{}')) x
             where x in (select perm_key from public.club_permissions))
    end
    from public.user_roles ur
    join public.club_roles r on r.role_key = ur.role_key
    where ur.user_id = p_user
  ), '{}'::text[])
$$;

create or replace function public.club_has_perm(p text)
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(p = any(public.club_effective_permissions(auth.uid())), false) $$;

create or replace function public.club_has_any_perm(p text[])
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.club_effective_permissions(auth.uid()) && p, false) $$;

create or replace function public.club_is_super_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = auth.uid() and role_key = 'super_admin') $$;

-- Anciennes fonctions utilisées par schema.sql / migration-v2.sql : on les redéfinit
-- pour qu'elles dépendent désormais des rôles Supabase (et plus de profiles.role,
-- qui valait 'editor' pour TOUS les élèves — cause de l'accès non autorisé).
create or replace function public.is_club_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = auth.uid() and role_key in ('super_admin','admin')) $$;
create or replace function public.is_club_editor()
returns boolean language sql stable security definer set search_path = public
as $$ select cardinality(public.club_effective_permissions(auth.uid())) > 0 $$;

-- Appelables par les politiques RLS (y compris pour le rôle anon : renvoient false).
revoke all on function public.club_has_perm(text), public.club_has_any_perm(text[]),
  public.club_is_super_admin(), public.is_club_admin(), public.is_club_editor() from public;
grant execute on function public.club_has_perm(text), public.club_has_any_perm(text[]),
  public.club_is_super_admin(), public.is_club_admin(), public.is_club_editor() to anon, authenticated;
-- Fonctions internes : jamais appelables depuis le navigateur.
revoke all on function public.club_role_rank(text), public.club_effective_permissions(uuid) from public, anon, authenticated;

-- Lecture des tables de rôles
drop policy if exists "roles catalog read" on public.club_roles;
create policy "roles catalog read" on public.club_roles for select to authenticated using (true);
drop policy if exists "permissions catalog read" on public.club_permissions;
create policy "permissions catalog read" on public.club_permissions for select to authenticated using (true);
drop policy if exists "user roles read" on public.user_roles;
create policy "user roles read" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.club_has_perm('management'));
-- AUCUNE politique d'écriture sur user_roles : seules les fonctions admin_* ci-dessous écrivent.
revoke all on public.user_roles, public.club_roles, public.club_permissions from anon;
revoke insert, update, delete, truncate on public.user_roles, public.club_roles, public.club_permissions from authenticated;
grant select on public.user_roles, public.club_roles, public.club_permissions to authenticated;

-- Validation des permissions stockées
create or replace function public.user_roles_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from unnest(coalesce(new.permissions, '{}')) x where x not in (select perm_key from public.club_permissions)) then
    raise exception 'Permission inconnue.';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists user_roles_guard_trg on public.user_roles;
create trigger user_roles_guard_trg before insert or update on public.user_roles
  for each row execute function public.user_roles_guard();

-- ---------------------------------------------------------------------
-- 3. Journal d'audit
-- ---------------------------------------------------------------------
alter table public.activity_logs add column if not exists details jsonb not null default '{}'::jsonb;

create or replace function public.log_action(p_action text, p_entity_type text, p_entity_id uuid, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public
as $$
begin
  insert into public.activity_logs(actor_id, action, entity_type, entity_id, details)
  values ((select id from public.profiles where id = auth.uid()), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
end $$;
revoke all on function public.log_action(text, text, uuid, jsonb) from public, anon, authenticated;

drop policy if exists "admins read activity logs" on public.activity_logs;
drop policy if exists "audit read" on public.activity_logs;
create policy "audit read" on public.activity_logs for select to authenticated using (public.club_has_perm('management'));
drop policy if exists "staff insert activity logs" on public.activity_logs;   -- les logs ne se forgent plus depuis le navigateur
revoke insert, update, delete on public.activity_logs from authenticated, anon;

create or replace function public.user_roles_audit()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.log_action('role.deleted', 'user_roles', old.user_id, jsonb_build_object('role', old.role_key));
    return old;
  elsif tg_op = 'INSERT' then
    if new.role_key = 'eleve' and cardinality(new.permissions) = 0 then return new; end if;   -- pas de bruit à chaque inscription
    perform public.log_action('role.assigned', 'user_roles', new.user_id, jsonb_build_object('role', new.role_key, 'permissions', new.permissions));
  elsif old.role_key is distinct from new.role_key or old.permissions is distinct from new.permissions then
    perform public.log_action('role.changed', 'user_roles', new.user_id,
      jsonb_build_object('from_role', old.role_key, 'to_role', new.role_key, 'from_permissions', old.permissions, 'to_permissions', new.permissions));
  end if;
  return new;
end $$;
drop trigger if exists user_roles_audit_trg on public.user_roles;
create trigger user_roles_audit_trg after insert or update or delete on public.user_roles
  for each row execute function public.user_roles_audit();

-- ---------------------------------------------------------------------
-- 4. Profils : tout nouvel inscrit est « élève » ; le rôle ne se modifie plus côté client
-- ---------------------------------------------------------------------
create or replace function public.handle_new_student_profile()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id, full_name, first_name, last_name, email, grade_level, track, class_number, role)
  values (new.id,
    trim(coalesce(new.raw_user_meta_data->>'first_name','') || ' ' || coalesce(new.raw_user_meta_data->>'last_name','')),
    coalesce(new.raw_user_meta_data->>'first_name',''),
    coalesce(new.raw_user_meta_data->>'last_name',''),
    coalesce(new.email,''),
    coalesce(new.raw_user_meta_data->>'grade_level',''),
    coalesce(new.raw_user_meta_data->>'track',''),
    coalesce(new.raw_user_meta_data->>'class_number',''),
    'editor')   -- colonne héritée, SANS effet sur les droits depuis la v3
  on conflict (id) do nothing;
  insert into public.user_roles(user_id, role_key) values (new.id, 'eleve') on conflict (user_id) do nothing;
  return new;
end $$;

create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.id is distinct from old.id then raise exception 'Identifiant de profil immuable.'; end if;
  if new.role is distinct from old.role and not public.club_is_super_admin() then new.role := old.role; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before update on public.profiles
  for each row execute function public.profiles_guard();

-- Synchronise profiles.email avec auth.users après confirmation d'un changement d'e-mail
create or replace function public.sync_profile_email()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists sync_profile_email_trg on auth.users;
create trigger sync_profile_email_trg after update of email on auth.users
  for each row execute function public.sync_profile_email();

drop policy if exists "profile self read" on public.profiles;
create policy "profile self read" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "profile admin manage" on public.profiles;
drop policy if exists "staff read all profiles" on public.profiles;
create policy "staff read all profiles" on public.profiles for select to authenticated
  using (public.club_has_any_perm(array['management','team','applications','volunteers','members']));
drop policy if exists "profile self update" on public.profiles;
create policy "profile self update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());   -- le rôle est protégé par profiles_guard
-- "profile self insert" (migration-v2) est conservée telle quelle (role='editor' imposé, sans effet sur les droits).

-- Rôles initiaux pour les comptes existants (AVANT l'amorçage du super admin)
--   profiles.role = 'admin'  -> rôle « admin » (à relire dans Gestion)
--   tous les autres comptes  -> « eleve » (l'ancien « editor » automatique ne donne plus AUCUN accès)
insert into public.user_roles(user_id, role_key)
select p.id, case when p.role = 'admin' then 'admin' else 'eleve' end
from public.profiles p
join auth.users u on u.id = p.id
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------
-- 5. Amorçage sécurisé du Super administrateur initial
--    Identité vérifiée dans auth.users (e-mail CONFIRMÉ), jamais fournie par le navigateur.
--    Ne s'applique que tant qu'aucun super administrateur n'existe.
-- ---------------------------------------------------------------------
create or replace function public.club_bootstrap_super_admin()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if lower(new.email) = 'aghaline20@gmail.com'
     and new.email_confirmed_at is not null
     and not exists (select 1 from public.user_roles where role_key = 'super_admin') then
    insert into public.profiles(id, email, full_name)
    values (new.id, coalesce(new.email,''), coalesce(new.raw_user_meta_data->>'full_name',''))
    on conflict (id) do nothing;
    insert into public.user_roles(user_id, role_key) values (new.id, 'super_admin')
    on conflict (user_id) do update set role_key = 'super_admin', permissions = '{}', updated_at = now();
  end if;
  return new;
end $$;
drop trigger if exists club_bootstrap_super_admin_trg on auth.users;
create trigger club_bootstrap_super_admin_trg after insert or update of email, email_confirmed_at on auth.users
  for each row execute function public.club_bootstrap_super_admin();

do $$
declare u record;
begin
  select id, email, raw_user_meta_data into u from auth.users
   where lower(email) = 'aghaline20@gmail.com' and email_confirmed_at is not null limit 1;
  if found and not exists (select 1 from public.user_roles where role_key = 'super_admin') then
    insert into public.profiles(id, email, full_name)
    values (u.id, coalesce(u.email,''), coalesce(u.raw_user_meta_data->>'full_name',''))
    on conflict (id) do nothing;
    insert into public.user_roles(user_id, role_key) values (u.id, 'super_admin')
    on conflict (user_id) do update set role_key = 'super_admin', permissions = '{}', updated_at = now();
    raise notice 'Super administrateur initialisé pour aghaline20@gmail.com';
  elsif not found then
    raise notice 'Compte aghaline20@gmail.com introuvable ou e-mail non confirmé : le rôle sera attribué automatiquement dès sa création/confirmation.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. RPC d'administration des comptes (toutes les règles sont appliquées CÔTÉ SERVEUR)
-- ---------------------------------------------------------------------
create or replace function public.my_access()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'role_key', coalesce((select role_key from public.user_roles where user_id = auth.uid()), 'eleve'),
    'role_label', coalesce((select r.label from public.user_roles ur join public.club_roles r on r.role_key = ur.role_key where ur.user_id = auth.uid()), 'Élève'),
    'is_super', public.club_is_super_admin(),
    'permissions', to_jsonb(public.club_effective_permissions(auth.uid()))
  )
$$;

create or replace function public.admin_list_accounts()
returns table(user_id uuid, email text, full_name text, first_name text, last_name text, grade_level text, track text,
              class_number text, avatar_url text, role_key text, role_label text, role_rank integer, permissions text[],
              functions text[], account_created_at timestamptz, last_sign_in_at timestamptz, email_confirmed boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.club_has_perm('management') then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select u.id, u.email::text, coalesce(p.full_name, ''), coalesce(p.first_name, ''), coalesce(p.last_name, ''),
         coalesce(p.grade_level, ''), coalesce(p.track, ''), coalesce(p.class_number, ''), p.avatar_url,
         coalesce(ur.role_key, 'eleve'), coalesce(r.label, 'Élève'), coalesce(r.rank, 10),
         coalesce(ur.permissions, '{}'::text[]),
         coalesce((select array_agg(t.function_title order by t.display_order, t.created_at) from public.club_team t where t.user_id = u.id), '{}'::text[]),
         u.created_at, u.last_sign_in_at, (u.email_confirmed_at is not null)
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.user_roles ur on ur.user_id = u.id
  left join public.club_roles r on r.role_key = coalesce(ur.role_key, 'eleve')
  order by u.created_at desc;
end $$;

create or replace function public.admin_set_role(p_target uuid, p_role text, p_permissions text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role text; v_caller_rank integer; v_is_super boolean := false;
  v_target_role text; v_target_rank integer; v_new_rank integer;
  v_caller_perms text[]; v_invalid text[];
begin
  if v_caller is null or not public.club_has_perm('management') then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_target) then raise exception 'Compte introuvable.'; end if;
  select rank into v_new_rank from public.club_roles where role_key = p_role;
  if not found then raise exception 'Rôle inconnu.'; end if;
  p_permissions := coalesce(p_permissions, '{}');
  select array_agg(x) into v_invalid from unnest(p_permissions) x where x not in (select perm_key from public.club_permissions);
  if v_invalid is not null then raise exception 'Permission inconnue : %', array_to_string(v_invalid, ', '); end if;

  select role_key into v_caller_role from public.user_roles where user_id = v_caller;
  v_is_super := coalesce(v_caller_role = 'super_admin', false);
  v_caller_rank := public.club_role_rank(v_caller_role);
  v_target_role := coalesce((select role_key from public.user_roles where user_id = p_target), 'eleve');
  v_target_rank := public.club_role_rank(v_target_role);

  if not v_is_super then
    if p_target = v_caller then raise exception 'Vous ne pouvez pas modifier votre propre rôle ou vos permissions.'; end if;
    if v_target_rank >= v_caller_rank then raise exception 'Vous ne pouvez pas modifier un compte de rang égal ou supérieur au vôtre.'; end if;
    if v_new_rank >= v_caller_rank then raise exception 'Seul un Super administrateur peut attribuer ce rôle.'; end if;
    v_caller_perms := public.club_effective_permissions(v_caller);
    if exists (select 1 from unnest(p_permissions) x where not (x = any(v_caller_perms))) then
      raise exception 'Vous ne pouvez pas accorder une permission que vous ne possédez pas.';
    end if;
  end if;

  if v_target_role = 'super_admin' and p_role <> 'super_admin'
     and (select count(*) from public.user_roles where role_key = 'super_admin') <= 1 then
    raise exception 'Impossible : au moins un Super administrateur doit rester actif.';
  end if;

  insert into public.user_roles(user_id, role_key, permissions, granted_by)
  values (p_target, p_role, case when p_role = 'super_admin' then '{}' else p_permissions end, v_caller)
  on conflict (user_id) do update
    set role_key = excluded.role_key, permissions = excluded.permissions, granted_by = v_caller, updated_at = now();
  return jsonb_build_object('user_id', p_target, 'role_key', p_role, 'permissions', case when p_role = 'super_admin' then '{}'::text[] else p_permissions end);
end $$;

create or replace function public.admin_update_account(p_target uuid, p_first text, p_last text, p_grade text, p_track text, p_class text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid(); v_caller_role text; v_target_role text;
begin
  if v_caller is null or not public.club_has_perm('management') then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  p_first := btrim(coalesce(p_first, '')); p_last := btrim(coalesce(p_last, ''));
  p_grade := btrim(coalesce(p_grade, '')); p_track := btrim(coalesce(p_track, '')); p_class := btrim(coalesce(p_class, ''));
  if char_length(p_first) > 80 or char_length(p_last) > 80 or char_length(p_class) > 20 then raise exception 'Valeur trop longue.'; end if;
  if (p_grade = '') <> (p_track = '') then raise exception 'Niveau et filière doivent être renseignés ensemble.'; end if;
  if p_grade <> '' and not (
       (p_grade = 'Tronc Commun' and p_track in ('Scientifique','Lettre')) or
       (p_grade = '1 Bac' and p_track in ('Sciences Maths','Sciences Experimentales','Sciences Economiques')) or
       (p_grade = '2 Bac' and p_track in ('Sciences Maths A','Sciences Maths B','Sciences Physiques','Sciences Economiques'))
     ) then raise exception 'Niveau / filière incohérents.'; end if;
  select role_key into v_caller_role from public.user_roles where user_id = v_caller;
  select role_key into v_target_role from public.user_roles where user_id = p_target;
  if v_caller_role is distinct from 'super_admin' and p_target <> v_caller
     and public.club_role_rank(v_target_role) >= public.club_role_rank(v_caller_role) then
    raise exception 'Vous ne pouvez pas modifier un compte de rang égal ou supérieur au vôtre.';
  end if;
  update public.profiles
     set first_name = p_first, last_name = p_last, full_name = btrim(p_first || ' ' || p_last),
         grade_level = p_grade, track = p_track, class_number = p_class
   where id = p_target;
  if not found then raise exception 'Profil introuvable.'; end if;
  perform public.log_action('account.updated', 'profiles', p_target, jsonb_build_object('grade_level', p_grade, 'track', p_track, 'class_number', p_class));
  return jsonb_build_object('user_id', p_target);
end $$;

revoke all on function public.my_access(), public.admin_list_accounts(), public.admin_set_role(uuid, text, text[]),
  public.admin_update_account(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.my_access(), public.admin_list_accounts(), public.admin_set_role(uuid, text, text[]),
  public.admin_update_account(uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Candidatures bénévoles
-- ---------------------------------------------------------------------
alter table public.applications add column if not exists grade_level text;
alter table public.applications add column if not exists track text;
alter table public.applications add column if not exists class_number text;
alter table public.applications add column if not exists skills text;
alter table public.applications add column if not exists areas text[] not null default '{}';
alter table public.applications add column if not exists areas_other text;
alter table public.applications add column if not exists extra_info text;
alter table public.applications add column if not exists updated_at timestamptz not null default now();

-- Reprise prudente des anciennes candidatures : on copie le profil actuel de l'élève sans écraser une valeur déjà présente.
update public.applications a
   set grade_level = coalesce(a.grade_level, nullif(p.grade_level, '')),
       track = coalesce(a.track, nullif(p.track, '')),
       class_number = coalesce(a.class_number, nullif(p.class_number, ''))
  from public.profiles p
 where a.user_id = p.id and (a.grade_level is null or a.track is null or a.class_number is null);

-- Une seule candidature par élève (empêche les doublons même contre l'API directe)
do $$
begin
  if exists (select 1 from public.applications where user_id is not null group by user_id having count(*) > 1) then
    raise notice 'Doublons de candidatures détectés : index unique NON créé. Supprimez les doublons puis relancez cette migration.';
  else
    create unique index if not exists applications_one_per_user_idx on public.applications(user_id) where user_id is not null;
  end if;
end $$;

drop policy if exists "public submit application" on public.applications;
drop policy if exists "student submit own application" on public.applications;
drop policy if exists "student read own applications" on public.applications;   -- exposait internal_notes à l'élève
drop policy if exists "staff manage applications" on public.applications;
drop policy if exists "staff read applications" on public.applications;
create policy "staff read applications" on public.applications for select to authenticated
  using (public.club_has_any_perm(array['applications','volunteers','members']));
drop policy if exists "staff update applications" on public.applications;
create policy "staff update applications" on public.applications for update to authenticated
  using (public.club_has_any_perm(array['applications','volunteers'])) with check (public.club_has_any_perm(array['applications','volunteers']));
drop policy if exists "staff delete applications" on public.applications;
create policy "staff delete applications" on public.applications for delete to authenticated
  using (public.club_has_any_perm(array['applications','volunteers']));
revoke insert on public.applications from authenticated, anon;   -- création uniquement via submit_volunteer_application()

create or replace function public.applications_before_update()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    if new.status = 'pending' then
      new.reviewed_at := null; new.reviewed_by := null;
    else
      new.reviewed_at := now();
      new.reviewed_by := (select id from public.profiles where id = auth.uid());
    end if;
    perform public.log_action('application.status', 'applications', new.id,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end $$;
drop trigger if exists applications_before_update_trg on public.applications;
create trigger applications_before_update_trg before update on public.applications
  for each row execute function public.applications_before_update();

create or replace function public.submit_volunteer_application(
  p_phone text, p_motivation text, p_skills text, p_areas text[], p_areas_other text,
  p_availability text, p_extra_info text, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
  v_p public.profiles%rowtype;
  v_existing public.applications%rowtype;
  v_allowed text[] := array['Organisation des événements','Communication et réseaux sociaux','Logistique','Actions solidaires',
                            'Développement durable','Création de contenu et design','Informatique et développement web','Autre'];
  v_areas text[]; v_class text; v_interest text; v_id uuid; v_created boolean := false; v_status public.application_status;
begin
  if v_uid is null then raise exception 'Connectez-vous pour candidater.' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@elaraki\.ac\.ma$' then raise exception 'Une adresse @elaraki.ac.ma est requise pour candidater.'; end if;
  select * into v_p from public.profiles where id = v_uid;
  if not found or coalesce(v_p.first_name,'') = '' or coalesce(v_p.last_name,'') = ''
     or coalesce(v_p.grade_level,'') = '' or coalesce(v_p.track,'') = '' or coalesce(v_p.class_number,'') = '' then
    raise exception 'Complétez votre profil (nom, niveau, filière, classe) avant de candidater.';
  end if;
  p_phone := nullif(btrim(coalesce(p_phone, '')), '');
  p_motivation := btrim(coalesce(p_motivation, ''));
  p_skills := nullif(btrim(coalesce(p_skills, '')), '');
  p_areas_other := nullif(btrim(coalesce(p_areas_other, '')), '');
  p_availability := nullif(btrim(coalesce(p_availability, '')), '');
  p_extra_info := nullif(btrim(coalesce(p_extra_info, '')), '');
  if coalesce(p_consent, false) is not true then raise exception 'Vous devez accepter le traitement de vos informations.'; end if;
  if char_length(p_motivation) < 15 or char_length(p_motivation) > 2000 then raise exception 'La motivation doit contenir entre 15 et 2000 caractères.'; end if;
  if p_phone is not null and p_phone !~ '^[0-9 +().-]{6,30}$' then raise exception 'Numéro de téléphone invalide.'; end if;
  if char_length(coalesce(p_skills,'')) > 1000 or char_length(coalesce(p_extra_info,'')) > 1500
     or char_length(coalesce(p_availability,'')) > 500 or char_length(coalesce(p_areas_other,'')) > 200 then
    raise exception 'Un des champs dépasse la longueur autorisée.';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_areas from unnest(coalesce(p_areas, '{}')) x where x = any(v_allowed);
  if cardinality(v_areas) = 0 then raise exception 'Choisissez au moins un domaine d''implication.'; end if;
  if 'Autre' = any(v_areas) and p_areas_other is null then raise exception 'Précisez le domaine « Autre ».'; end if;

  v_class := concat_ws(' · ', v_p.grade_level, v_p.track, v_p.class_number);
  v_interest := array_to_string(array_remove(v_areas, 'Autre') || case when 'Autre' = any(v_areas) then array['Autre : ' || p_areas_other] else '{}'::text[] end, ', ');

  select * into v_existing from public.applications where user_id = v_uid order by submitted_at desc limit 1 for update;
  if found then
    if v_existing.status = 'accepted' then raise exception 'Votre candidature a déjà été acceptée.'; end if;
    if v_existing.status = 'archived' then raise exception 'Votre candidature a été archivée. Contactez le bureau du club.'; end if;
    update public.applications set
        first_name = v_p.first_name, last_name = v_p.last_name, email = v_email, class_name = v_class,
        grade_level = v_p.grade_level, track = v_p.track, class_number = v_p.class_number,
        phone = p_phone, interest_area = v_interest, motivation = p_motivation, skills = p_skills,
        areas = v_areas, areas_other = p_areas_other, availability = p_availability, extra_info = p_extra_info, consent = true,
        -- re-soumission après refus : retour en attente ; modification d'une candidature en attente : statut inchangé
        status = 'pending',
        submitted_at = case when v_existing.status = 'rejected' then now() else v_existing.submitted_at end,
        rejection_reason = case when v_existing.status = 'rejected' then null else v_existing.rejection_reason end
      where id = v_existing.id
      returning id, status into v_id, v_status;
  else
    insert into public.applications(user_id, first_name, last_name, email, class_name, grade_level, track, class_number, phone,
                                    interest_area, motivation, skills, areas, areas_other, availability, extra_info, consent, status)
    values (v_uid, v_p.first_name, v_p.last_name, v_email, v_class, v_p.grade_level, v_p.track, v_p.class_number, p_phone,
            v_interest, p_motivation, p_skills, v_areas, p_areas_other, p_availability, p_extra_info, true, 'pending')
    returning id, status into v_id, v_status;
    v_created := true;
  end if;
  return jsonb_build_object('id', v_id, 'status', v_status, 'created', v_created);
end $$;

create or replace function public.my_application()
returns jsonb language sql stable security definer set search_path = public
as $$
  select to_jsonb(t) from (
    select a.id, a.status, a.submitted_at, a.updated_at, a.reviewed_at, a.phone, a.motivation, a.skills, a.areas,
           a.areas_other, a.availability, a.extra_info
      from public.applications a where a.user_id = auth.uid() order by a.submitted_at desc limit 1
  ) t
$$;
revoke all on function public.submit_volunteer_application(text, text, text, text[], text, text, text, boolean), public.my_application() from public, anon, authenticated;
grant execute on function public.submit_volunteer_application(text, text, text, text[], text, text, text, boolean), public.my_application() to authenticated;
-- internal_notes et rejection_reason ne sont JAMAIS renvoyés à l'élève.

-- ---------------------------------------------------------------------
-- 8. Chat : modification, suppression, Realtime
-- ---------------------------------------------------------------------
alter table public.chat_messages add column if not exists edited_at timestamptz;

drop policy if exists "chat staff read" on public.chat_messages;
drop policy if exists "chat staff send" on public.chat_messages;
drop policy if exists "chat read" on public.chat_messages;
create policy "chat read" on public.chat_messages for select to authenticated using (public.club_has_perm('chat'));
drop policy if exists "chat send" on public.chat_messages;
create policy "chat send" on public.chat_messages for insert to authenticated
  with check (public.club_has_perm('chat') and user_id = auth.uid() and char_length(btrim(message)) > 0 and edited_at is null);
drop policy if exists "chat edit own" on public.chat_messages;
create policy "chat edit own" on public.chat_messages for update to authenticated
  using (public.club_has_perm('chat') and user_id = auth.uid())
  with check (public.club_has_perm('chat') and user_id = auth.uid());
drop policy if exists "chat delete own or moderate" on public.chat_messages;
create policy "chat delete own or moderate" on public.chat_messages for delete to authenticated
  using (public.club_has_perm('chat') and (user_id = auth.uid() or public.club_has_perm('chat_moderate')));

create or replace function public.chat_messages_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id
     or new.author_name is distinct from old.author_name or new.created_at is distinct from old.created_at then
    raise exception 'Seul le texte du message peut être modifié.';
  end if;
  if new.message is distinct from old.message then
    new.message := btrim(new.message);
    if char_length(new.message) = 0 then raise exception 'Un message ne peut pas être vide.'; end if;
    new.edited_at := now();
  end if;
  return new;
end $$;
drop trigger if exists chat_messages_guard_trg on public.chat_messages;
create trigger chat_messages_guard_trg before update on public.chat_messages
  for each row execute function public.chat_messages_guard();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- Canal privé « club-chat » (indicateur de saisie via Broadcast) réservé aux détenteurs de la permission chat
do $$
begin
  if to_regclass('realtime.messages') is not null then
    drop policy if exists "club chat realtime read" on realtime.messages;
    create policy "club chat realtime read" on realtime.messages for select to authenticated
      using (realtime.topic() = 'club-chat' and public.club_has_perm('chat'));
    drop policy if exists "club chat realtime write" on realtime.messages;
    create policy "club chat realtime write" on realtime.messages for insert to authenticated
      with check (realtime.topic() = 'club-chat' and public.club_has_perm('chat'));
  end if;
exception when others then
  raise notice 'Politiques Realtime non créées (%). Créez-les depuis le Dashboard : voir README.', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 9. Équipe dirigeante (distincte des rôles techniques)
-- ---------------------------------------------------------------------
create table if not exists public.club_team (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  function_title text not null check (char_length(btrim(function_title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 600),
  display_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists club_team_user_function_idx on public.club_team(user_id, lower(btrim(function_title)));
create index if not exists club_team_order_idx on public.club_team(display_order, created_at);
alter table public.club_team enable row level security;
drop policy if exists "team manage" on public.club_team;
create policy "team manage" on public.club_team for all to authenticated
  using (public.club_has_perm('team')) with check (public.club_has_perm('team'));
revoke all on public.club_team from anon;
grant select, insert, update, delete on public.club_team to authenticated;

create or replace function public.club_team_audit()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.log_action('team.removed', 'club_team', old.id, jsonb_build_object('user_id', old.user_id, 'function', old.function_title));
    return old;
  end if;
  new.function_title := btrim(new.function_title);
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    perform public.log_action('team.added', 'club_team', new.id, jsonb_build_object('user_id', new.user_id, 'function', new.function_title));
  elsif old.function_title is distinct from new.function_title or old.user_id is distinct from new.user_id then
    perform public.log_action('team.changed', 'club_team', new.id, jsonb_build_object('user_id', new.user_id, 'function', new.function_title));
  end if;
  return new;
end $$;
drop trigger if exists club_team_audit_trg on public.club_team;
create trigger club_team_audit_trg before insert or update on public.club_team for each row execute function public.club_team_audit();
drop trigger if exists club_team_audit_del_trg on public.club_team;
create trigger club_team_audit_del_trg after delete on public.club_team for each row execute function public.club_team_audit();

-- ---------------------------------------------------------------------
-- 10. Annonces / événements : permissions par module + galerie de photos
-- ---------------------------------------------------------------------
alter table public.event_images add column if not exists storage_path text;

drop policy if exists "public read published events" on public.events;
create policy "public read published events" on public.events for select to anon, authenticated
  using (status = 'published' or public.club_has_perm('events'));
drop policy if exists "staff manage events" on public.events;
create policy "staff manage events" on public.events for all to authenticated
  using (public.club_has_perm('events')) with check (public.club_has_perm('events'));

drop policy if exists "public read images for published events" on public.event_images;
create policy "public read images for published events" on public.event_images for select to anon, authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.status = 'published') or public.club_has_perm('events'));
drop policy if exists "staff manage event images" on public.event_images;
create policy "staff manage event images" on public.event_images for all to authenticated
  using (public.club_has_perm('events')) with check (public.club_has_perm('events'));

drop policy if exists "public read published projects" on public.projects;
create policy "public read published projects" on public.projects for select to anon, authenticated
  using (status in ('ongoing','completed') or public.club_has_perm('projects'));
drop policy if exists "staff manage projects" on public.projects;
create policy "staff manage projects" on public.projects for all to authenticated
  using (public.club_has_perm('projects')) with check (public.club_has_perm('projects'));

drop policy if exists "staff manage members" on public.members;
create policy "staff manage members" on public.members for all to authenticated
  using (public.club_has_perm('members')) with check (public.club_has_perm('members'));

drop policy if exists "staff manage messages" on public.contact_messages;
create policy "staff manage messages" on public.contact_messages for all to authenticated
  using (public.club_has_perm('contact')) with check (public.club_has_perm('contact'));

drop policy if exists "staff manage settings" on public.site_settings;
create policy "staff manage settings" on public.site_settings for all to authenticated
  using (public.club_has_perm('settings')) with check (public.club_has_perm('settings'));

-- Stockage des photos du club : écriture réservée aux modules qui publient du contenu
drop policy if exists "Club staff upload media" on storage.objects;
create policy "Club staff upload media" on storage.objects for insert to authenticated
  with check (bucket_id = 'club-media' and public.club_has_any_perm(array['events','projects','settings']));
drop policy if exists "Club staff update media" on storage.objects;
create policy "Club staff update media" on storage.objects for update to authenticated
  using (bucket_id = 'club-media' and public.club_has_any_perm(array['events','projects','settings']))
  with check (bucket_id = 'club-media' and public.club_has_any_perm(array['events','projects','settings']));
drop policy if exists "Club staff delete media" on storage.objects;
create policy "Club staff delete media" on storage.objects for delete to authenticated
  using (bucket_id = 'club-media' and public.club_has_any_perm(array['events','projects','settings']));

-- Fin de la migration v3.
