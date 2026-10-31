import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fillTrackSelect } from './academics.js';
const cfg = window.CLUB_CONFIG || {};
const $ = s => document.querySelector(s);
let supabase = null;
if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  window.CLUB_AUTH = supabase;
}
const status = $('#accountStatus');
const setStatus = (m, ok = false) => { if (!status) return; status.textContent = m; status.className = 'account-status ' + (m ? (ok ? 'ok' : 'err') : ''); };
const isSchoolMail = e => /^[^@\s]+@elaraki\.ac\.ma$/.test(e);
/* Indication d'adresse institutionnelle : rattachée au champ e-mail (et non plus un bloc flottant sous le bouton) */
const flagEmail = (form, on) => { const i = form?.elements?.email, h = form?.querySelector('.field-hint'); if (!i) return; i.setAttribute('aria-invalid', on ? 'true' : 'false'); h?.classList.toggle('is-error', !!on); if (on) i.focus(); };
const setBusy = (btn, on, label) => { if (!btn) return; btn.disabled = on; if (label) btn.dataset.label = btn.dataset.label || btn.textContent; btn.textContent = on ? label : (btn.dataset.label || btn.textContent); };

/* ---- Ancien lien register.html#connexion → page de connexion dédiée ---- */
if ($('#registerForm') && location.hash === '#connexion') location.replace('login.html');

/* ---- Icône utilisateur du header (toutes les pages publiques) ---- */
async function paintHeaderAccount() {
  const a = $('.header-account'); if (!a || !supabase) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const { data: p } = await supabase.from('profiles').select('first_name,last_name,avatar_url').eq('id', session.user.id).maybeSingle();
  a.href = 'profile.html'; a.title = 'Mon profil'; a.setAttribute('aria-label', 'Mon profil');
  a.classList.add('is-in');
  const label = a.querySelector('.ha-label'); if (label) label.textContent = 'Mon profil';
  const ic = a.querySelector('.ha-icon');
  if (p?.avatar_url) { ic.innerHTML = ''; const img = new Image(); img.src = p.avatar_url; img.alt = ''; ic.append(img); }
  else { ic.textContent = ((p?.first_name || '')[0] || '') + ((p?.last_name || '')[0] || '') || '✓'; ic.classList.add('initials'); }
}
paintHeaderAccount();

/* ---- Inscription ---- */
const registerForm = $('#registerForm');
if (registerForm) {
  const grade = registerForm.elements.grade_level, track = registerForm.elements.track;
  grade.addEventListener('change', () => fillTrackSelect(track, grade.value, ''));
  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!supabase) return setStatus('Configuration Supabase manquante.');
    const f = new FormData(registerForm), email = String(f.get('email') || '').trim().toLowerCase(), password = String(f.get('password') || '');
    if (!isSchoolMail(email)) { setStatus(''); return flagEmail(registerForm, true); }
    flagEmail(registerForm, false);
    const avatar = f.get('avatar'); if (avatar?.size > 2 * 1024 * 1024) return setStatus('La photo dépasse 2 Mo.');
    const btn = registerForm.querySelector('[type=submit]'); setBusy(btn, true, 'Création du compte…'); setStatus('');
    try {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { first_name: f.get('first_name'), last_name: f.get('last_name'), grade_level: f.get('grade_level'), track: f.get('track'), class_number: f.get('class_number') } } });
      if (error) throw error; if (!data.user) throw new Error('Création du compte impossible.');
      if (data.session && avatar && avatar.size) {
        const ext = avatar.name.split('.').pop().toLowerCase(), path = `${data.user.id}/avatar.${ext}`;
        const up = await supabase.storage.from('profile-photos').upload(path, avatar, { upsert: true, contentType: avatar.type }); if (up.error) throw up.error;
        const avatar_url = supabase.storage.from('profile-photos').getPublicUrl(path).data.publicUrl;
        const { error: pe } = await supabase.from('profiles').update({ avatar_url }).eq('id', data.user.id); if (pe) throw pe;
      }
      if (data.session) { setStatus('Compte créé avec succès. Redirection…', true); setTimeout(() => location.href = 'index.html#candidature', 1200); }
      else { setStatus('Compte créé. Vérifiez votre e-mail si une confirmation est demandée, puis connectez-vous.', true); setTimeout(() => location.href = 'login.html', 3500); }
    } catch (err) { setStatus(err.message || 'Une erreur est survenue.'); }
    finally { setBusy(btn, false); }
  });
}

/* ---- Connexion (e-mail + mot de passe uniquement) ---- */
const loginForm = $('#studentLoginForm');
if (loginForm) loginForm.elements.email.addEventListener('input', () => flagEmail(loginForm, false));
if (loginForm) loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (!supabase) return setStatus('Service indisponible. Réessayez plus tard.');
  const f = new FormData(loginForm), email = String(f.get('email') || '').trim().toLowerCase(), password = String(f.get('password') || '');
  if (!isSchoolMail(email)) { setStatus(''); return flagEmail(loginForm, true); }
  flagEmail(loginForm, false);
  const btn = loginForm.querySelector('[type=submit]'); setBusy(btn, true, 'Connexion…'); setStatus('');
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error;
    setStatus('Connexion réussie. Redirection…', true); setTimeout(() => location.href = 'index.html#candidature', 700);
  } catch (err) { setStatus(/invalid login/i.test(err.message || '') ? 'E-mail ou mot de passe incorrect.' : (err.message || 'Connexion impossible.')); setBusy(btn, false); }
});

/* ---- Contenu publié (annonce + projets) ---- */
function fmtDate(d) { return new Date(d + 'T12:00:00'); }
async function loadPublishedContent() {
  if (!supabase) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: ev } = await supabase.from('events').select('id,slug,title,event_date,summary').eq('status', 'published').eq('is_visible', true).gte('event_date', today).order('event_date', { ascending: true }).limit(1);
    const { data: setting } = await supabase.from('site_settings').select('setting_value').eq('setting_key', 'hero_announcement').maybeSingle();
    const box = $('#upcomingAnnouncement');
    if (box) {
      const e = ev?.[0], custom = (setting?.setting_value?.text || '').trim();
      if (custom || e) {
        box.innerHTML = '';
        const badge = document.createElement('span'); badge.className = 'ua-badge'; badge.innerHTML = '<i class="ua-dot"></i><span></span>';
        const body = document.createElement('div'); body.className = 'ua-body';
        if (custom) { badge.lastChild.textContent = 'Annonce'; const t = document.createElement('strong'); t.textContent = custom; body.append(t); }
        else {
          const d = fmtDate(e.event_date); badge.lastChild.textContent = 'Prochain événement';
          const t = document.createElement('strong'); t.textContent = e.title;
          const s = document.createElement('span'); s.textContent = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + (e.summary ? ' — ' + e.summary : '');
          body.append(t, s);
        }
        const cta = document.createElement('a'); cta.href = e ? 'annonce.html?e=' + encodeURIComponent(e.slug || e.id) : '#evenements'; cta.className = 'ua-cta'; cta.textContent = 'Découvrir';
        box.append(badge, body, cta); box.hidden = false;
      }
    }
    /* Les anciens « projets » ont été migrés vers Actions & Événements (section ci-dessous). */
  } catch (e) { console.warn('Chargement du contenu publié indisponible', e); }
}
if (supabase && $('#upcomingAnnouncement')) loadPublishedContent();

/* L'état du compte et le formulaire de candidature sont gérés par assets/volunteer.js */
