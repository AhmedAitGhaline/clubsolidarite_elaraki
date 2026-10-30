import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fillTrackSelect, APP_STATUS, esc } from './academics.js';

const c = window.CLUB_CONFIG || {}, db = createClient(c.supabaseUrl, c.supabaseAnonKey), $ = s => document.querySelector(s);
const form = $('#profileForm'), status = $('#profileStatus');
const msg = (s, ok = false) => { status.textContent = s; status.className = 'account-status ' + (s ? (ok ? 'ok' : 'err') : ''); };
const avatarHtml = url => `<img src="${esc(url)}" alt="Photo de profil" style="width:90px;height:90px;object-fit:cover;border-radius:50%;margin:12px 0">`;

const { data: { session } } = await db.auth.getSession();
if (!session) { location.href = 'login.html'; throw new Error('Not signed in'); }
const { data: p, error } = await db.from('profiles').select('*').eq('id', session.user.id).single();
if (error) { msg(error.message); throw error; }

/* Ordre CORRECT : niveau d'abord, puis options de filière, puis valeur enregistrée.
   (Avant : la valeur était posée sur une liste vide, puis la liste était reconstruite et la 1re option — ex. « Sciences Maths A » — s'imposait.) */
const grade = form.elements.grade_level, track = form.elements.track;
for (const k of ['first_name', 'last_name', 'class_number']) form.elements[k].value = p[k] || '';
if (p.grade_level) grade.value = p.grade_level;
fillTrackSelect(track, grade.value, p.track || '');
grade.addEventListener('change', () => fillTrackSelect(track, grade.value, ''));
if (p.avatar_url) $('#currentAvatar').innerHTML = avatarHtml(p.avatar_url);

form.addEventListener('submit', async e => {
  e.preventDefault();
  const b = form.querySelector('button[type="submit"]'); b.disabled = true; msg('');
  try {
    const f = new FormData(form), first = String(f.get('first_name') || '').trim(), last = String(f.get('last_name') || '').trim();
    if (!first || !last || !f.get('grade_level') || !f.get('track') || !String(f.get('class_number') || '').trim()) throw new Error('Renseignez tous les champs obligatoires, y compris la filière.');
    const payload = { first_name: first, last_name: last, full_name: `${first} ${last}`, grade_level: f.get('grade_level'), track: f.get('track'), class_number: String(f.get('class_number')).trim() };
    const file = f.get('avatar');
    if (file?.size) {
      if (file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choisissez une image JPG, PNG ou WebP de 2 Mo maximum.');
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg', path = `${session.user.id}/avatar.${ext}`;
      const up = await db.storage.from('profile-photos').upload(path, file, { upsert: true, contentType: file.type }); if (up.error) throw up.error;
      payload.avatar_url = db.storage.from('profile-photos').getPublicUrl(path).data.publicUrl;
    }
    const { data, error } = await db.from('profiles').update(payload).eq('id', session.user.id).select('id,grade_level,track');
    if (error) throw error;
    if (!data?.length) throw new Error('Le profil n’a pas été enregistré (accès refusé).');
    msg('Profil enregistré.', true);
    if (payload.avatar_url) $('#currentAvatar').innerHTML = avatarHtml(payload.avatar_url);
  } catch (err) { msg(err.message); } finally { b.disabled = false; }
});
$('#profileLogout').addEventListener('click', async () => { await db.auth.signOut(); location.href = 'login.html'; });

/* ---- Suivi de la candidature bénévole ---- */
(async () => {
  const box = $('#applicationCard'); if (!box) return;
  const { data: app, error } = await db.rpc('my_application');
  if (error) { box.hidden = true; return; }
  const d = v => v ? new Date(v).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  box.hidden = false;
  if (!app) { box.innerHTML = `<h2>Candidature bénévole</h2><p class="account-help">Vous n’avez pas encore candidaté.</p><a class="button button-outline-dark" href="index.html#candidature">Devenir bénévole</a>`; return; }
  const texts = { pending: 'Votre candidature est en cours d’examen par le bureau.', accepted: 'Félicitations, votre candidature a été acceptée.', rejected: 'Votre candidature n’a pas été retenue. Vous pouvez la mettre à jour et la soumettre à nouveau.', archived: 'Votre candidature a été archivée.' };
  box.innerHTML = `<h2>Candidature bénévole</h2><p><span class="app-chip ${esc(app.status)}">${esc(APP_STATUS[app.status] || app.status)}</span> <span class="account-help">Déposée le ${d(app.submitted_at)}</span></p><p class="account-help">${esc(texts[app.status] || '')}</p>${['pending', 'rejected'].includes(app.status) ? '<a class="button button-outline-dark" href="index.html#candidature">' + (app.status === 'pending' ? 'Consulter / modifier ma candidature' : 'Mettre à jour et renvoyer') + '</a>' : ''}`;
})();
