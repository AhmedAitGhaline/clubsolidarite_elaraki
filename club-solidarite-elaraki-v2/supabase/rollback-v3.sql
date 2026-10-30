-- Retour arrière de la migration v3 (À UTILISER SEULEMENT SI NÉCESSAIRE).
-- ATTENTION : revenir à la v2 rétablit l'ancien comportement où tout élève (profiles.role='editor')
-- obtient les droits « editor » (accès administration). Ne l'utilisez qu'en dépannage temporaire.
-- Les données (candidatures, messages, annonces, journal) ne sont PAS supprimées, sauf les tables
-- de rôles et d'équipe listées ci-dessous (sauvegardez-les avant si besoin).

drop trigger if exists club_bootstrap_super_admin_trg on auth.users;
drop trigger if exists sync_profile_email_trg on auth.users;
drop trigger if exists profiles_guard_trg on public.profiles;
drop trigger if exists chat_messages_guard_trg on public.chat_messages;
drop trigger if exists applications_before_update_trg on public.applications;
drop trigger if exists user_roles_audit_trg on public.user_roles;
drop trigger if exists user_roles_guard_trg on public.user_roles;

drop function if exists public.submit_volunteer_application(text, text, text, text[], text, text, text, boolean);
drop function if exists public.my_application();
drop function if exists public.admin_update_account(uuid, text, text, text, text, text);
drop function if exists public.admin_set_role(uuid, text, text[]);
drop function if exists public.admin_list_accounts();
drop function if exists public.my_access();

drop policy if exists "club chat realtime read" on realtime.messages;
drop policy if exists "club chat realtime write" on realtime.messages;

-- Tables introduites par la v3 (perte des attributions de rôles et de l'équipe dirigeante) :
-- drop table if exists public.club_team;
-- drop table if exists public.user_roles;
-- drop table if exists public.club_roles;
-- drop table if exists public.club_permissions;

-- Puis relancer, dans cet ordre, schema.sql puis migration-v2.sql : leurs « drop policy if exists /
-- create policy » et « create or replace function » rétablissent les politiques et fonctions d'origine.
-- (is_club_admin / is_club_editor seront alors de nouveau basées sur profiles.role.)
