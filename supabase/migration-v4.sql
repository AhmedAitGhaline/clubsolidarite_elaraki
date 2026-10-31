-- =====================================================================
-- Migration v4 — Club Solidarité ELARAKI
-- 1) Candidature : domaines d'implication en texte libre
-- 2) Hiérarchie STRICTE des rôles (y compris entre Super Admins)
-- 3) Chat : épinglage réservé Super Admin / Admin
-- 4) Journal d'audit : auteur + cible + anciennes/nouvelles valeurs, inviolable
-- 5) Actions & Événements : heure, fin, visibilité, type ; migration des « projets »
-- 6) Statistiques réelles du tableau de bord (fonction serveur)
--
-- À exécuter APRÈS migration-v3.sql. Idempotente. Sauvegardez avant.
-- Aucune table ni donnée existante n'est supprimée.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Utilitaires
-- ---------------------------------------------------------------------
create or replace function public.club_person_name(p_user uuid)
returns text language sql stable security definer set search_path = public
as $$
  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''), p.email,
                  (select u.email::text from auth.users u where u.id = p_user))
  from (select 1) x left join public.profiles p on p.id = p_user
$$;
revoke all on function public.club_person_name(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Candidature bénévole : domaines en texte libre (colonne existante interest_area)
--    Les anciennes valeurs (listes cochées) restent lisibles : interest_area les contient déjà.
-- ---------------------------------------------------------------------
drop function if exists public.submit_volunteer_application(text, text, text, text[], text, text, text, boolean);

create or replace function public.submit_volunteer_application(
  p_phone text, p_motivation text, p_skills text, p_interest text,
  p_availability text, p_extra_info text, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
  v_p public.profiles%rowtype;
  v_existing public.applications%rowtype;
  v_class text; v_id uuid; v_created boolean := false; v_status public.application_status;
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
  p_interest := btrim(coalesce(p_interest, ''));
  p_skills := nullif(btrim(coalesce(p_skills, '')), '');
  p_availability := nullif(btrim(coalesce(p_availability, '')), '');
  p_extra_info := nullif(btrim(coalesce(p_extra_info, '')), '');
  if coalesce(p_consent, false) is not true then raise exception 'Vous devez accepter le traitement de vos informations.'; end if;
  if char_length(p_motivation) < 15 or char_length(p_motivation) > 2000 then raise exception 'La motivation doit contenir entre 15 et 2000 caractères.'; end if;
  if char_length(p_interest) < 5 or char_length(p_interest) > 1500 then raise exception 'Décrivez les domaines dans lesquels vous souhaitez vous impliquer (5 à 1500 caractères).'; end if;
  if p_phone is not null and p_phone !~ '^[0-9 +().-]{6,30}$' then raise exception 'Numéro de téléphone invalide.'; end if;
  if char_length(coalesce(p_skills,'')) > 1000 or char_length(coalesce(p_extra_info,'')) > 1500 or char_length(coalesce(p_availability,'')) > 500 then
    raise exception 'Un des champs dépasse la longueur autorisée.';
  end if;
  v_class := concat_ws(' · ', v_p.grade_level, v_p.track, v_p.class_number);

  select * into v_existing from public.applications where user_id = v_uid order by submitted_at desc limit 1 for update;
  if found then
    if v_existing.status = 'accepted' then raise exception 'Votre candidature a déjà été acceptée.'; end if;
    if v_existing.status = 'archived' then raise exception 'Votre candidature a été archivée. Contactez le bureau du club.'; end if;
    update public.applications set
        first_name = v_p.first_name, last_name = v_p.last_name, email = v_email, class_name = v_class,
        grade_level = v_p.grade_level, track = v_p.track, class_number = v_p.class_number,
        phone = p_phone, interest_area = p_interest, motivation = p_motivation, skills = p_skills,
        availability = p_availability, extra_info = p_extra_info, consent = true,
        status = 'pending',
        submitted_at = case when v_existing.status = 'rejected' then now() else v_existing.submitted_at end,
        rejection_reason = case when v_existing.status = 'rejected' then null else v_existing.rejection_reason end
      where id = v_existing.id
      returning id, status into v_id, v_status;
  else
    insert into public.applications(user_id, first_name, last_name, email, class_name, grade_level, track, class_number, phone,
                                    interest_area, motivation, skills, availability, extra_info, consent, status)
    values (v_uid, v_p.first_name, v_p.last_name, v_email, v_class, v_p.grade_level, v_p.track, v_p.class_number, p_phone,
            p_interest, p_motivation, p_skills, p_availability, p_extra_info, true, 'pending')
    returning id, status into v_id, v_status;
    v_created := true;
  end if;
  return jsonb_build_object('id', v_id, 'status', v_status, 'created', v_created);
end $$;

create or replace function public.my_application()
returns jsonb language sql stable security definer set search_path = public
as $$
  select to_jsonb(t) from (
    select a.id, a.status, a.submitted_at, a.updated_at, a.reviewed_at, a.phone, a.motivation, a.skills,
           a.interest_area, a.availability, a.extra_info
      from public.applications a where a.user_id = auth.uid() order by a.submitted_at desc limit 1
  ) t
$$;
revoke all on function public.submit_volunteer_application(text, text, text, text, text, text, boolean), public.my_application() from public, anon, authenticated;
grant execute on function public.submit_volunteer_application(text, text, text, text, text, text, boolean), public.my_application() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Journal d'audit : structure enrichie (on réutilise les colonnes existantes)
--    action = action_type · entity_type/entity_id = cible (élément ou personne) · details = metadata
-- ---------------------------------------------------------------------
alter table public.activity_logs add column if not exists actor_name text;
alter table public.activity_logs add column if not exists target_name text;
alter table public.activity_logs add column if not exists old_values jsonb;
alter table public.activity_logs add column if not exists new_values jsonb;
create index if not exists activity_logs_created_idx on public.activity_logs(created_at desc);
create index if not exists activity_logs_entity_idx on public.activity_logs(entity_type, entity_id);

-- Reprise des anciennes entrées (AVANT d'activer l'immutabilité)
do $$
begin
  update public.activity_logs l set actor_name = public.club_person_name(l.actor_id)
   where l.actor_id is not null and l.actor_name is null;
  -- changements de statut de candidature
  update public.activity_logs l
     set target_name = btrim(a.first_name || ' ' || a.last_name),
         old_values = jsonb_build_object('status', l.details->>'from'),
         new_values = jsonb_build_object('status', l.details->>'to')
    from public.applications a
   where l.action = 'application.status' and l.entity_id = a.id and l.target_name is null;
  -- rôles : entity_id = identifiant de la personne
  update public.activity_logs l
     set target_name = public.club_person_name(l.entity_id),
         old_values = case when l.details ? 'from_role' then jsonb_build_object('role', (select label from public.club_roles where role_key = l.details->>'from_role'), 'role_key', l.details->>'from_role')
                           when l.action = 'role.deleted' then jsonb_build_object('role', (select label from public.club_roles where role_key = l.details->>'role'), 'role_key', l.details->>'role') end,
         new_values = case when l.details ? 'to_role' then jsonb_build_object('role', (select label from public.club_roles where role_key = l.details->>'to_role'), 'role_key', l.details->>'to_role')
                           when l.action = 'role.assigned' then jsonb_build_object('role', (select label from public.club_roles where role_key = l.details->>'role'), 'role_key', l.details->>'role') end
   where l.action like 'role.%' and l.target_name is null;
  -- équipe dirigeante
  update public.activity_logs l
     set target_name = public.club_person_name(nullif(l.details->>'user_id','')::uuid),
         new_values = case when l.action <> 'team.removed' then jsonb_build_object('function', l.details->>'function') end,
         old_values = case when l.action = 'team.removed' then jsonb_build_object('function', l.details->>'function') end
   where l.action like 'team.%' and l.target_name is null and l.details ? 'user_id';
exception when others then
  raise notice 'Reprise partielle des anciens journaux : %', sqlerrm;
end $$;

-- Nouvelle fonction d'écriture : l'auteur vient TOUJOURS de la session (auth.uid()), jamais du client.
create or replace function public.log_action(
  p_action text, p_entity_type text, p_entity_id uuid, p_target_name text default null,
  p_old jsonb default null, p_new jsonb default null, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  insert into public.activity_logs(actor_id, actor_name, action, entity_type, entity_id, target_name, old_values, new_values, details)
  values ((select id from public.profiles where id = v_uid),
          case when v_uid is null then 'Système' else public.club_person_name(v_uid) end,
          p_action, p_entity_type, p_entity_id, p_target_name, p_old, p_new, coalesce(p_meta, '{}'::jsonb));
end $$;
revoke all on function public.log_action(text, text, uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- Le journal n'est ni modifiable ni supprimable (seule la mise à NULL de actor_id par la clé étrangère est tolérée)
create or replace function public.activity_logs_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Le journal d''audit ne peut pas être supprimé.'; end if;
  if new.actor_id is not null or (to_jsonb(new) - 'actor_id') is distinct from (to_jsonb(old) - 'actor_id') then
    raise exception 'Le journal d''audit ne peut pas être modifié.';
  end if;
  return new;
end $$;
drop trigger if exists activity_logs_immutable_trg on public.activity_logs;
create trigger activity_logs_immutable_trg before update or delete on public.activity_logs
  for each row execute function public.activity_logs_immutable();

-- Lecture : chacun voit les opérations des modules auxquels il a accès ; « management » voit tout.
create or replace function public.club_can_see_log(p_type text)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.club_has_perm('management') or case p_type
    when 'applications' then public.club_has_any_perm(array['volunteers','applications'])
    when 'events' then public.club_has_perm('events')
    when 'event_images' then public.club_has_perm('events')
    when 'club_team' then public.club_has_perm('team')
    when 'chat_messages' then public.club_has_perm('chat')
    when 'site_settings' then public.club_has_perm('settings')
    when 'members' then public.club_has_perm('members')
    else false end
$$;
revoke all on function public.club_can_see_log(text) from public, anon;
grant execute on function public.club_can_see_log(text) to authenticated;
drop policy if exists "audit read" on public.activity_logs;
create policy "audit read" on public.activity_logs for select to authenticated using (public.club_can_see_log(entity_type));
revoke insert, update, delete, truncate on public.activity_logs from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Déclencheurs d'audit (dans la MÊME transaction que l'opération : un échec n'est jamais journalisé)
-- ---------------------------------------------------------------------
-- 3a. Rôles et permissions
create or replace function public.user_roles_audit()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_old_label text; v_new_label text; v_target text;
begin
  if tg_op = 'DELETE' then
    select label into v_old_label from public.club_roles where role_key = old.role_key;
    perform public.log_action('role.deleted', 'user_roles', old.user_id, public.club_person_name(old.user_id),
      jsonb_build_object('role', v_old_label, 'role_key', old.role_key), null);
    return old;
  end if;
  v_target := public.club_person_name(new.user_id);
  select label into v_new_label from public.club_roles where role_key = new.role_key;
  if tg_op = 'INSERT' then
    if new.role_key = 'eleve' and cardinality(new.permissions) = 0 then return new; end if;   -- inscription ordinaire : pas de bruit
    perform public.log_action('role.assigned', 'user_roles', new.user_id, v_target, null,
      jsonb_build_object('role', v_new_label, 'role_key', new.role_key, 'permissions', new.permissions));
  elsif old.role_key is distinct from new.role_key then
    select label into v_old_label from public.club_roles where role_key = old.role_key;
    if new.role_key = 'eleve' then   -- retrait d'un rôle à privilèges = rôle supprimé
      perform public.log_action('role.deleted', 'user_roles', new.user_id, v_target,
        jsonb_build_object('role', v_old_label, 'role_key', old.role_key, 'permissions', old.permissions), null);
    else
      perform public.log_action('role.changed', 'user_roles', new.user_id, v_target,
        jsonb_build_object('role', v_old_label, 'role_key', old.role_key, 'permissions', old.permissions),
        jsonb_build_object('role', v_new_label, 'role_key', new.role_key, 'permissions', new.permissions));
    end if;
  elsif old.permissions is distinct from new.permissions then
    perform public.log_action('permissions.changed', 'user_roles', new.user_id, v_target,
      jsonb_build_object('role', v_new_label, 'permissions', old.permissions), jsonb_build_object('role', v_new_label, 'permissions', new.permissions));
  end if;
  return new;
end $$;

-- 3b. Candidatures / bénévoles
create or replace function public.applications_before_update()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_name text := btrim(new.first_name || ' ' || new.last_name); v_uid uuid := auth.uid();
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    if new.status = 'pending' then new.reviewed_at := null; new.reviewed_by := null;
    else new.reviewed_at := now(); new.reviewed_by := (select id from public.profiles where id = v_uid); end if;
    perform public.log_action(
      case when new.status = 'pending' and v_uid is not null and v_uid = new.user_id then 'application.resubmitted' else 'application.status' end,
      'applications', new.id, v_name, jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  elsif (old.first_name, old.last_name, old.email, old.phone, old.class_name, old.interest_area, old.motivation, old.skills, old.availability, old.extra_info, old.internal_notes)
        is distinct from
        (new.first_name, new.last_name, new.email, new.phone, new.class_name, new.interest_area, new.motivation, new.skills, new.availability, new.extra_info, new.internal_notes) then
    perform public.log_action(case when v_uid is not null and v_uid = new.user_id then 'application.self_updated' else 'application.updated' end,
      'applications', new.id, v_name, null, null,
      jsonb_build_object('notes_changed', old.internal_notes is distinct from new.internal_notes));
  end if;
  return new;
end $$;

create or replace function public.applications_audit_io()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_action('application.received', 'applications', new.id, btrim(new.first_name || ' ' || new.last_name), null, jsonb_build_object('status', new.status));
    return new;
  end if;
  perform public.log_action('application.deleted', 'applications', old.id, btrim(old.first_name || ' ' || old.last_name), jsonb_build_object('status', old.status), null);
  return old;
end $$;
drop trigger if exists applications_audit_ins_trg on public.applications;
create trigger applications_audit_ins_trg after insert on public.applications for each row execute function public.applications_audit_io();
drop trigger if exists applications_audit_del_trg on public.applications;
create trigger applications_audit_del_trg after delete on public.applications for each row execute function public.applications_audit_io();

-- 3c. Membres
create or replace function public.members_audit()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then perform public.log_action('member.added', 'members', new.id, btrim(new.first_name || ' ' || new.last_name), null, jsonb_build_object('status', new.status)); return new;
  elsif tg_op = 'DELETE' then perform public.log_action('member.removed', 'members', old.id, btrim(old.first_name || ' ' || old.last_name), jsonb_build_object('status', old.status), null); return old;
  elsif (old.first_name, old.last_name, old.email, old.class_name, old.phone, old.status) is distinct from (new.first_name, new.last_name, new.email, new.class_name, new.phone, new.status) then
    perform public.log_action('member.changed', 'members', new.id, btrim(new.first_name || ' ' || new.last_name), jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  return new;
end $$;
drop trigger if exists members_audit_trg on public.members;
create trigger members_audit_trg after insert or update or delete on public.members for each row execute function public.members_audit();

-- 3d. Équipe dirigeante
create or replace function public.club_team_audit()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.log_action('team.removed', 'club_team', old.id, public.club_person_name(old.user_id), jsonb_build_object('function', old.function_title), null);
    return old;
  end if;
  new.function_title := btrim(new.function_title);
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    perform public.log_action('team.added', 'club_team', new.id, public.club_person_name(new.user_id), null, jsonb_build_object('function', new.function_title));
  elsif old.function_title is distinct from new.function_title or old.user_id is distinct from new.user_id or old.display_order is distinct from new.display_order then
    perform public.log_action('team.changed', 'club_team', new.id, public.club_person_name(new.user_id),
      jsonb_build_object('function', old.function_title, 'person', public.club_person_name(old.user_id)),
      jsonb_build_object('function', new.function_title, 'person', public.club_person_name(new.user_id)));
  end if;
  return new;
end $$;

-- 3e. Paramètres du site
create or replace function public.site_settings_audit()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.log_action('setting.changed', 'site_settings', old.id, old.setting_key, jsonb_build_object('text', left(old.setting_value->>'text', 200)), null);
    return old;
  end if;
  if tg_op = 'INSERT' or old.setting_value is distinct from new.setting_value then
    perform public.log_action('setting.changed', 'site_settings', new.id, new.setting_key,
      case when tg_op = 'UPDATE' then jsonb_build_object('text', left(old.setting_value->>'text', 200)) end,
      jsonb_build_object('text', left(new.setting_value->>'text', 200)));
  end if;
  return new;
end $$;
drop trigger if exists site_settings_audit_trg on public.site_settings;
create trigger site_settings_audit_trg after insert or update or delete on public.site_settings for each row execute function public.site_settings_audit();

-- ---------------------------------------------------------------------
-- 4. Hiérarchie STRICTE des rôles (aucune exception, Super Admin compris)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_role(p_target uuid, p_role text, p_permissions text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role text; v_caller_rank integer; v_is_super boolean;
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

  -- Règle fondamentale : niveau(X) <= niveau(Y)  =>  X ne peut pas toucher aux rôles de Y.
  if p_target = v_caller then
    raise exception 'Vous ne pouvez pas modifier votre propre rôle ou vos permissions.' using errcode = '42501';
  end if;
  if v_caller_rank <= v_target_rank then
    raise exception 'Opération refusée : le niveau de cette personne est égal ou supérieur au vôtre.' using errcode = '42501';
  end if;
  -- On ne peut attribuer qu'un rôle de niveau inférieur ou égal au sien (égal : réservé au Super Admin)
  if v_new_rank > v_caller_rank or (v_new_rank = v_caller_rank and not v_is_super) then
    raise exception 'Vous ne pouvez pas attribuer un rôle égal ou supérieur au vôtre.' using errcode = '42501';
  end if;
  if not v_is_super then
    v_caller_perms := public.club_effective_permissions(v_caller);
    if exists (select 1 from unnest(p_permissions) x where not (x = any(v_caller_perms))) then
      raise exception 'Vous ne pouvez pas accorder une permission que vous ne possédez pas.' using errcode = '42501';
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
  v_caller uuid := auth.uid(); v_caller_role text; v_target_role text; v_old public.profiles%rowtype;
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
  if p_target <> v_caller and public.club_role_rank(coalesce(v_target_role, 'eleve')) >= public.club_role_rank(v_caller_role) then
    raise exception 'Opération refusée : le niveau de cette personne est égal ou supérieur au vôtre.' using errcode = '42501';
  end if;
  select * into v_old from public.profiles where id = p_target;
  if not found then raise exception 'Profil introuvable.'; end if;
  update public.profiles
     set first_name = p_first, last_name = p_last, full_name = btrim(p_first || ' ' || p_last),
         grade_level = p_grade, track = p_track, class_number = p_class
   where id = p_target;
  perform public.log_action('account.updated', 'profiles', p_target, public.club_person_name(p_target),
    jsonb_build_object('name', v_old.full_name, 'grade_level', v_old.grade_level, 'track', v_old.track, 'class_number', v_old.class_number),
    jsonb_build_object('name', btrim(p_first || ' ' || p_last), 'grade_level', p_grade, 'track', p_track, 'class_number', p_class));
  return jsonb_build_object('user_id', p_target);
end $$;

-- Remplace l'ancienne signature de log_action (plus aucune fonction ne l'utilise)
drop function if exists public.log_action(text, text, uuid, jsonb);

-- ---------------------------------------------------------------------
-- 5. Chat : épinglage (Super Admin / Admin uniquement, contrôlé côté base)
-- ---------------------------------------------------------------------
alter table public.chat_messages add column if not exists pinned_at timestamptz;
alter table public.chat_messages add column if not exists pinned_by uuid references auth.users(id) on delete set null;
create index if not exists chat_messages_pinned_idx on public.chat_messages(pinned_at) where pinned_at is not null;

drop policy if exists "chat send" on public.chat_messages;
create policy "chat send" on public.chat_messages for insert to authenticated
  with check (public.club_has_perm('chat') and user_id = auth.uid() and char_length(btrim(message)) > 0 and edited_at is null and pinned_at is null and pinned_by is null);

create or replace function public.chat_messages_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id
     or new.author_name is distinct from old.author_name or new.created_at is distinct from old.created_at then
    raise exception 'Seul le texte du message peut être modifié.';
  end if;
  -- L'état « épinglé » ne se change que par chat_set_pin() (qui vérifie le rôle) : jamais par un UPDATE direct.
  if (new.pinned_at is distinct from old.pinned_at or new.pinned_by is distinct from old.pinned_by)
     and coalesce(current_setting('club.allow_pin', true), '') <> '1' then
    raise exception 'Seuls les Super Admin et Admin peuvent épingler un message.' using errcode = '42501';
  end if;
  if new.message is distinct from old.message then
    new.message := btrim(new.message);
    if char_length(new.message) = 0 then raise exception 'Un message ne peut pas être vide.'; end if;
    new.edited_at := now();
  end if;
  return new;
end $$;

create or replace function public.chat_set_pin(p_id uuid, p_pin boolean)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare m public.chat_messages%rowtype;
begin
  if auth.uid() is null or not public.club_has_perm('chat') or not public.is_club_admin() then
    raise exception 'Seuls les Super Admin et Admin peuvent épingler ou désépingler un message.' using errcode = '42501';
  end if;
  select * into m from public.chat_messages where id = p_id;
  if not found then raise exception 'Message introuvable.'; end if;
  if (m.pinned_at is not null) = p_pin then
    return jsonb_build_object('id', p_id, 'pinned', p_pin, 'unchanged', true);
  end if;
  perform set_config('club.allow_pin', '1', true);   -- valable pour cette transaction seulement
  update public.chat_messages
     set pinned_at = case when p_pin then now() end, pinned_by = case when p_pin then auth.uid() end
   where id = p_id;
  perform public.log_action(case when p_pin then 'chat.pinned' else 'chat.unpinned' end, 'chat_messages', p_id, m.author_name,
    null, null, jsonb_build_object('excerpt', left(m.message, 140)));
  return jsonb_build_object('id', p_id, 'pinned', p_pin);
end $$;
revoke all on function public.chat_set_pin(uuid, boolean) from public, anon, authenticated;
grant execute on function public.chat_set_pin(uuid, boolean) to authenticated;

create or replace function public.chat_messages_audit_del()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null then
    perform public.log_action('chat.deleted', 'chat_messages', old.id, old.author_name, null, null,
      jsonb_build_object('excerpt', left(old.message, 140), 'own', old.user_id = auth.uid(), 'was_pinned', old.pinned_at is not null));
  end if;
  return old;
end $$;
drop trigger if exists chat_messages_audit_del_trg on public.chat_messages;
create trigger chat_messages_audit_del_trg after delete on public.chat_messages for each row execute function public.chat_messages_audit_del();

-- ---------------------------------------------------------------------
-- 6. Actions & Événements : un seul espace (type, heure, fin, visibilité)
-- ---------------------------------------------------------------------
alter table public.events add column if not exists kind text not null default 'event';
do $$ begin
  alter table public.events add constraint events_kind_check check (kind in ('event','action'));
exception when duplicate_object then null; end $$;
alter table public.events add column if not exists start_time time;
alter table public.events add column if not exists end_time time;
alter table public.events add column if not exists end_date date;
alter table public.events add column if not exists is_visible boolean not null default true;
alter table public.event_images add column if not exists storage_path text;

create or replace function public.event_start_ts(p_date date, p_time time)
returns timestamptz language sql immutable as $$ select ((p_date + coalesce(p_time, time '00:00')) at time zone 'Africa/Casablanca') $$;
create or replace function public.event_end_ts(p_date date, p_end_date date, p_end_time time)
returns timestamptz language sql immutable as $$ select ((coalesce(p_end_date, p_date) + coalesce(p_end_time, time '23:59:59')) at time zone 'Africa/Casablanca') $$;

drop policy if exists "public read published events" on public.events;
create policy "public read published events" on public.events for select to anon, authenticated
  using ((status = 'published' and is_visible) or public.club_has_perm('events'));
drop policy if exists "public read images for published events" on public.event_images;
create policy "public read images for published events" on public.event_images for select to anon, authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.status = 'published' and e.is_visible) or public.club_has_perm('events'));

-- Migration (sans suppression) des anciens « projets » vers Actions & Événements
alter table public.projects add column if not exists migrated_event_id uuid;
do $$
declare r record; v_id uuid; v_slug text;
begin
  for r in select * from public.projects where migrated_event_id is null loop
    v_slug := 'action-' || r.slug;
    if exists (select 1 from public.events where slug = v_slug) then v_slug := v_slug || '-' || substr(r.id::text, 1, 6); end if;
    insert into public.events(title, slug, summary, description, event_date, end_date, published_at, date_type, category, location, cover_image, status, is_featured, kind, is_visible)
    values (r.title, v_slug, coalesce(nullif(r.short_description, ''), left(r.description, 280), ''), r.description,
            coalesce(r.start_date, r.created_at::date), r.end_date, r.created_at, 'actual', r.category, r.location, r.cover_image,
            case r.status when 'ongoing' then 'published' when 'completed' then 'published' when 'archived' then 'archived' else 'draft' end::public.content_status,
            r.is_featured, 'action', true)
    returning id into v_id;
    update public.projects set migrated_event_id = v_id where id = r.id;
  end loop;
end $$;

-- Audit des événements / actions et de leurs photos
create or replace function public.events_audit()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_fields text[]; v_old jsonb := '{}'::jsonb; v_new jsonb := '{}'::jsonb; k text;
begin
  if tg_op = 'DELETE' then
    perform public.log_action('event.deleted', 'events', old.id, old.title, jsonb_build_object('kind', old.kind, 'date', old.event_date, 'status', old.status), null);
    return old;
  end if;
  if tg_op = 'INSERT' then
    perform public.log_action('event.created', 'events', new.id, new.title, null, jsonb_build_object('kind', new.kind, 'date', new.event_date, 'status', new.status));
    if new.status = 'published' then perform public.log_action('event.published', 'events', new.id, new.title, null, jsonb_build_object('kind', new.kind)); end if;
    return new;
  end if;
  if old.status is distinct from new.status then
    if new.status = 'published' then perform public.log_action('event.published', 'events', new.id, new.title, null, jsonb_build_object('kind', new.kind));
    elsif old.status = 'published' then perform public.log_action('event.unpublished', 'events', new.id, new.title, null, jsonb_build_object('kind', new.kind, 'status', new.status));
    end if;
  end if;
  select array_agg(f) into v_fields from unnest(array['title','summary','description','event_date','end_date','start_time','end_time','location','category','cover_image','is_visible','kind']) f
   where to_jsonb(old)->f is distinct from to_jsonb(new)->f;
  if v_fields is not null then
    foreach k in array v_fields loop
      if k not in ('summary','description','cover_image') then v_old := v_old || jsonb_build_object(k, to_jsonb(old)->k); v_new := v_new || jsonb_build_object(k, to_jsonb(new)->k); end if;
    end loop;
    perform public.log_action('event.updated', 'events', new.id, new.title, v_old, v_new, jsonb_build_object('fields', to_jsonb(v_fields), 'kind', new.kind));
  end if;
  return new;
end $$;
drop trigger if exists events_audit_trg on public.events;
create trigger events_audit_trg after insert or update or delete on public.events for each row execute function public.events_audit();

create or replace function public.event_images_audit()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_event uuid; v_title text;
begin
  if tg_op = 'INSERT' then v_event := new.event_id; else v_event := old.event_id; end if;
  select title into v_title from public.events where id = v_event;
  if v_title is not null then   -- si l'événement n'existe plus (suppression en cascade) : déjà journalisé
    perform public.log_action(case tg_op when 'INSERT' then 'photo.added' else 'photo.removed' end, 'event_images', v_event, v_title);
  end if;
  if tg_op = 'INSERT' then return new; end if;
  return old;
end $$;
drop trigger if exists event_images_audit_trg on public.event_images;
create trigger event_images_audit_trg after insert or delete on public.event_images for each row execute function public.event_images_audit();

-- ---------------------------------------------------------------------
-- 7. Statistiques du tableau de bord (agrégats serveur, filtrés par permissions)
-- ---------------------------------------------------------------------
create or replace function public.admin_dashboard_stats()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_now timestamp := now() at time zone 'Africa/Casablanca';
  v_m0 timestamp := date_trunc('month', v_now);
  v_vol jsonb := null; v_ev jsonb := null; v_team jsonb := null;
begin
  if not public.is_club_editor() then raise exception 'Accès refusé.' using errcode = '42501'; end if;

  if public.club_has_any_perm(array['volunteers','applications','members']) then
    select jsonb_build_object(
      'total', count(*), 'pending', count(*) filter (where status = 'pending'),
      'accepted', count(*) filter (where status = 'accepted'), 'rejected', count(*) filter (where status = 'rejected'),
      'received_this_month', count(*) filter (where date_trunc('month', submitted_at at time zone 'Africa/Casablanca') = v_m0),
      'received_prev_month', count(*) filter (where date_trunc('month', submitted_at at time zone 'Africa/Casablanca') = v_m0 - interval '1 month'),
      'accepted_this_month', count(*) filter (where status = 'accepted' and date_trunc('month', reviewed_at at time zone 'Africa/Casablanca') = v_m0),
      'accepted_prev_month', count(*) filter (where status = 'accepted' and date_trunc('month', reviewed_at at time zone 'Africa/Casablanca') = v_m0 - interval '1 month'),
      'rejected_this_month', count(*) filter (where status = 'rejected' and date_trunc('month', reviewed_at at time zone 'Africa/Casablanca') = v_m0),
      'rejected_prev_month', count(*) filter (where status = 'rejected' and date_trunc('month', reviewed_at at time zone 'Africa/Casablanca') = v_m0 - interval '1 month'))
      into v_vol from public.applications;
    v_vol := v_vol || jsonb_build_object('monthly', (
      select jsonb_agg(jsonb_build_object('month', to_char(s.m, 'YYYY-MM'),
        'received', (select count(*) from public.applications a where date_trunc('month', a.submitted_at at time zone 'Africa/Casablanca') = s.m),
        'accepted', (select count(*) from public.applications a where a.status = 'accepted' and date_trunc('month', coalesce(a.reviewed_at, a.submitted_at) at time zone 'Africa/Casablanca') = s.m),
        'rejected', (select count(*) from public.applications a where a.status = 'rejected' and date_trunc('month', coalesce(a.reviewed_at, a.submitted_at) at time zone 'Africa/Casablanca') = s.m),
        'accepted_total', (select count(*) from public.applications a where a.status = 'accepted' and date_trunc('month', coalesce(a.reviewed_at, a.submitted_at) at time zone 'Africa/Casablanca') <= s.m))
        order by s.m)
      from generate_series(v_m0 - interval '11 months', v_m0, interval '1 month') s(m)));
  end if;

  if public.club_has_perm('events') then
    select jsonb_build_object(
      'done', count(*) filter (where status = 'published' and public.event_end_ts(event_date, end_date, end_time) < now()),
      'done_events', count(*) filter (where status = 'published' and kind = 'event' and public.event_end_ts(event_date, end_date, end_time) < now()),
      'done_actions', count(*) filter (where status = 'published' and kind = 'action' and public.event_end_ts(event_date, end_date, end_time) < now()),
      'upcoming', count(*) filter (where status = 'published' and public.event_start_ts(event_date, start_time) > now()),
      'ongoing', count(*) filter (where status = 'published' and public.event_start_ts(event_date, start_time) <= now() and public.event_end_ts(event_date, end_date, end_time) >= now()),
      'drafts', count(*) filter (where status = 'draft'),
      'done_this_month', count(*) filter (where status = 'published' and date_trunc('month', event_date::timestamp) = v_m0 and public.event_end_ts(event_date, end_date, end_time) < now()),
      'done_prev_month', count(*) filter (where status = 'published' and date_trunc('month', event_date::timestamp) = v_m0 - interval '1 month'))
      into v_ev from public.events where event_date is not null;
    v_ev := v_ev || jsonb_build_object('monthly', (
      select jsonb_agg(jsonb_build_object('month', to_char(s.m, 'YYYY-MM'),
        'events', (select count(*) from public.events e where e.status = 'published' and e.kind = 'event' and date_trunc('month', e.event_date::timestamp) = s.m),
        'actions', (select count(*) from public.events e where e.status = 'published' and e.kind = 'action' and date_trunc('month', e.event_date::timestamp) = s.m))
        order by s.m)
      from generate_series(v_m0 - interval '11 months', v_m0, interval '1 month') s(m)));
  end if;

  if public.club_has_any_perm(array['team','management']) then
    select jsonb_build_object(
      'admins', (select count(*) from public.user_roles where role_key in ('super_admin','admin')),
      'super_admins', (select count(*) from public.user_roles where role_key = 'super_admin'),
      'leaders', (select count(distinct user_id) from public.club_team),
      'accounts', (select count(*) from public.profiles)) into v_team;
  end if;

  return jsonb_build_object('volunteers', v_vol, 'events', v_ev, 'team', v_team, 'generated_at', now());
end $$;
revoke all on function public.admin_dashboard_stats() from public, anon, authenticated;
grant execute on function public.admin_dashboard_stats() to authenticated;

-- Fin de la migration v4.

-- ---------------------------------------------------------------------
-- 8. Site public : permettre de MASQUER une archive historique (assets/events-data.js) depuis l'administration
--    La fonction ne renvoie que, parmi les identifiants fournis, ceux dont l'événement existe en base
--    mais n'est pas publié ou est masqué. Aucun autre événement n'est divulgué.
-- ---------------------------------------------------------------------
create or replace function public.hidden_event_slugs(p_slugs text[])
returns text[] language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(slug), '{}') from public.events
   where slug = any(coalesce(p_slugs, '{}')) and not (status = 'published' and is_visible)
$$;
revoke all on function public.hidden_event_slugs(text[]) from public;
grant execute on function public.hidden_event_slugs(text[]) to anon, authenticated;
