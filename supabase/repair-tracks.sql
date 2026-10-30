-- Diagnostic et correction PRUDENTE des filières altérées par l'ancien bug de profile.js.
-- Cause : à l'ouverture de « Mon profil », la liste des filières était reconstruite APRÈS l'affectation
-- de la valeur ; la première option (ex. « Sciences Maths A » pour 2 Bac) s'affichait donc, et un
-- enregistrement du profil écrasait la vraie filière en base.
-- La filière choisie à l'inscription est conservée dans auth.users.raw_user_meta_data.

-- ÉTAPE 1 — Diagnostic (lecture seule). Lignes où la filière du profil diffère de celle de l'inscription.
select p.id, p.email, p.grade_level as profil_niveau, p.track as profil_filiere,
       u.raw_user_meta_data->>'grade_level' as inscription_niveau,
       u.raw_user_meta_data->>'track'       as inscription_filiere
from public.profiles p
join auth.users u on u.id = p.id
where coalesce(u.raw_user_meta_data->>'track','') <> ''
  and (p.track is distinct from u.raw_user_meta_data->>'track'
       or p.grade_level is distinct from u.raw_user_meta_data->>'grade_level')
order by p.email;

-- ÉTAPE 2 — Sauvegarde des lignes qui seraient modifiées.
create table if not exists public.profiles_track_backup as
select p.id, p.grade_level, p.track, now() as saved_at
from public.profiles p
join auth.users u on u.id = p.id
where false;
-- (la sauvegarde effective est faite à l'étape 3)

-- ÉTAPE 3 — Correction. NE L'EXÉCUTEZ qu'après avoir relu l'étape 1 : un élève a pu changer
-- volontairement sa filière plus tard. La correction ne touche que les profils dont la filière
-- actuelle est la première option de la liste (« Sciences Maths A » / « Scientifique » / « Sciences Maths »)
-- ET différente de l'inscription, avec un niveau identique.
-- begin;
--   insert into public.profiles_track_backup(id, grade_level, track)
--   select p.id, p.grade_level, p.track from public.profiles p join auth.users u on u.id = p.id
--   where p.track in ('Sciences Maths A','Scientifique','Sciences Maths')
--     and p.grade_level = u.raw_user_meta_data->>'grade_level'
--     and coalesce(u.raw_user_meta_data->>'track','') <> '' and p.track <> u.raw_user_meta_data->>'track';
--   update public.profiles p set track = u.raw_user_meta_data->>'track'
--   from auth.users u
--   where u.id = p.id
--     and p.track in ('Sciences Maths A','Scientifique','Sciences Maths')
--     and p.grade_level = u.raw_user_meta_data->>'grade_level'
--     and coalesce(u.raw_user_meta_data->>'track','') <> '' and p.track <> u.raw_user_meta_data->>'track';
-- commit;   -- vérifiez le nombre de lignes avant de valider ; sinon « rollback; »
