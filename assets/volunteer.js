/* Parcours « Devenir bénévole » : s'adapte à l'état de connexion.
   - non connecté : bloc « compte de l'établissement » (création / connexion)
   - connecté     : carte d'identité scolaire + formulaire de candidature + suivi du statut */
import { APP_STATUS, esc } from './academics.js';

const $ = s => document.querySelector(s);
const db = window.CLUB_AUTH;
const gateEls = [$('#compte'), $('#candidature')].filter(Boolean);
const reveal = () => gateEls.forEach(e => e.classList.add('ready'));
const retarget = hash => document.querySelectorAll('a[data-vol-cta]').forEach(a => a.setAttribute('href', hash));
const fmt = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
const initials = (a = '', b = '') => ((a[0] || '') + (b[0] || '')).toUpperCase() || '?';
const SVG = {
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  grade: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2.5 9 2.5 12 0v-5"/></svg>',
  track: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z"/><path d="M19 19v2H6"/></svg>',
  room: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V4h10v17"/><path d="M15 9h4v12"/><circle cx="12" cy="13" r=".8"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>'
};

async function init() {
  if (!gateEls.length) return;
  if (!db) { $('#candidature').hidden = true; retarget('#compte'); reveal(); return; }   // Supabase indisponible : bloc d'invitation
  let session = null;
  try { ({ data: { session } } = await db.auth.getSession()); } catch { /* hors-ligne */ }
  if (!session) {                                                        // A. non connecté
    $('#candidature').hidden = true; $('#compte').hidden = false; retarget('#compte'); reveal(); return;
  }
  $('#compte').hidden = true; $('#candidature').hidden = false; retarget('#candidature');   // B. connecté
  reveal();
  await render(session);
}

async function render(session, flash = '') {
  const panel = $('#volunteerPanel');
  panel.innerHTML = '<div class="vol-loading" role="status">Chargement de votre profil…</div>';
  const [{ data: profile, error: pe }, { data: app }] = await Promise.all([
    db.from('profiles').select('first_name,last_name,grade_level,track,class_number,avatar_url').eq('id', session.user.id).maybeSingle(),
    db.rpc('my_application')
  ]);
  if (pe) { panel.innerHTML = `<div class="vol-alert err">Impossible de charger votre profil : ${esc(pe.message)}</div>`; return; }
  const p = profile || {};
  const missing = ['first_name', 'last_name', 'grade_level', 'track', 'class_number'].filter(k => !String(p[k] || '').trim());
  const fullName = `${p.first_name || ''} ${p.last_name || ''}`.trim();
  const val = (v) => v ? esc(v) : '<em class="vol-missing">Non renseigné</em>';
  const avatar = p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : esc(initials(p.first_name, p.last_name));

  const card = `<section class="id-card" aria-label="Identité scolaire">
    <div class="id-top"><span class="id-avatar">${avatar}</span>
      <div class="id-who"><strong>${fullName ? esc(fullName) : '<em class="vol-missing">Nom non renseigné</em>'}</strong><span>${SVG.mail}${esc(session.user.email)}</span></div>
      <span class="id-badge">${SVG.check}Connexion confirmée</span></div>
    <dl class="id-grid">
      <div>${SVG.grade}<dt>Niveau</dt><dd>${val(p.grade_level)}</dd></div>
      <div>${SVG.track}<dt>Filière</dt><dd>${val(p.track)}</dd></div>
      <div>${SVG.room}<dt>Classe</dt><dd>${val(p.class_number)}</dd></div>
    </dl>
    ${missing.length ? '<p class="id-warn">Votre profil est incomplet. <a href="profile.html">Complétez-le</a> avant de candidater.</p>' : '<a class="id-edit" href="profile.html">Modifier mon profil</a>'}
  </section>`;

  const status = app ? `<section class="vol-status ${esc(app.status)}"><div><span class="app-chip ${esc(app.status)}">${esc(APP_STATUS[app.status] || app.status)}</span><small>Déposée le ${fmt(app.submitted_at)}</small></div><p>${{
    pending: 'Votre candidature est en cours d’examen. Vous pouvez encore la modifier ci-dessous.',
    accepted: 'Félicitations ! Votre candidature a été acceptée. Le bureau vous contactera pour la suite.',
    rejected: 'Votre candidature n’a pas été retenue cette fois. Vous pouvez mettre à jour vos informations et la soumettre à nouveau.',
    archived: 'Votre candidature a été archivée. Contactez le bureau du club pour en savoir plus.'
  }[app.status] || ''}</p></section>` : '';
  const flashHtml = flash ? `<div class="vol-alert ok" role="status">${esc(flash)}</div>` : '';

  const locked = app && ['accepted', 'archived'].includes(app.status);
  panel.innerHTML = `<div class="form-card vol-card"><h3>Formulaire de candidature</h3>${flashHtml}${card}${status}${locked ? '' : formHtml(app, missing.length > 0)}</div>`;
  window.lucide?.createIcons?.();
  if (!locked) bindForm(session, app, p, missing.length > 0);
}

function formHtml(app, blocked) {
  const a = app || {};
  const label = app ? (app.status === 'rejected' ? 'Soumettre à nouveau' : 'Mettre à jour ma candidature') : 'Envoyer ma candidature';
  return `<form id="volunteerForm" class="vol-form" novalidate>
    <fieldset ${blocked ? 'disabled' : ''}>
    <div class="vol-grid">
      <label><span class="lt">Téléphone <span class="optional">(facultatif)</span></span><input type="tel" name="phone" maxlength="30" autocomplete="tel" placeholder="06 00 00 00 00" value="${esc(a.phone || '')}"><small class="fe" data-for="phone"></small></label>
      <label><span class="lt">Disponibilités <span class="optional">(facultatif)</span></span><input name="availability" maxlength="500" placeholder="Ex. mercredi après-midi, samedi matin" value="${esc(a.availability || '')}"></label>
      <label class="full">Domaines dans lesquels vous souhaitez vous impliquer *<textarea name="interest" rows="3" maxlength="1500" required placeholder="Décrivez les domaines dans lesquels vous souhaitez vous impliquer...">${esc(a.interest_area || '')}</textarea><small class="fe" data-for="interest"></small></label>
      <label class="full">Motivations *<textarea name="motivation" rows="4" maxlength="2000" placeholder="Pourquoi souhaitez-vous rejoindre le club ? (15 caractères minimum)">${esc(a.motivation || '')}</textarea><span class="counter"><span id="motivCount">${(a.motivation || '').length}</span>/2000</span><small class="fe" data-for="motivation"></small></label>
      <label class="full"><span class="lt">Compétences que vous pouvez apporter <span class="optional">(facultatif)</span></span><textarea name="skills" rows="2" maxlength="1000" placeholder="Ex. dessin, photographie, montage vidéo, organisation, langues…">${esc(a.skills || '')}</textarea></label>
      <label class="full"><span class="lt">Informations complémentaires <span class="optional">(facultatif)</span></span><textarea name="extra_info" rows="2" maxlength="1500">${esc(a.extra_info || '')}</textarea></label>
      <label class="consent full"><input type="checkbox" name="consent"><span>J’accepte que mes informations soient utilisées pour traiter ma candidature. *</span></label><small class="fe full" data-for="consent"></small>
    </div>
    <button class="button button-primary" type="submit">${label} <span>→</span></button>
    </fieldset>
    ${blocked ? '<p class="vol-note">Le formulaire se débloque dès que votre profil est complet.</p>' : ''}
    <p class="vol-form-status" id="volunteerStatus" role="status" aria-live="polite"></p>
    <p class="privacy-hint">La candidature ne garantit pas automatiquement l’acceptation.</p>
  </form>`;
}

function bindForm(session, app, profile, blocked) {
  const form = $('#volunteerForm'); if (!form) return;
  const status = $('#volunteerStatus'), btn = form.querySelector('button[type=submit]');
  let sending = false;
  const err = (k, m) => { const el = form.querySelector(`.fe[data-for="${k}"]`); if (el) el.textContent = m || ''; };
  const say = (m, ok = false) => { status.textContent = m; status.className = 'vol-form-status ' + (m ? (ok ? 'ok' : 'err') : ''); };
  form.elements.motivation.addEventListener('input', () => { $('#motivCount').textContent = form.elements.motivation.value.length; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (sending || blocked) return;                       // empêche les doubles envois
    ['phone', 'interest', 'motivation', 'consent'].forEach(k => err(k, ''));
    const f = new FormData(form), interest = String(f.get('interest') || '').trim(), motivation = String(f.get('motivation') || '').trim(), phone = String(f.get('phone') || '').trim();
    let ok = true;
    if (phone && !/^[0-9 +().-]{6,30}$/.test(phone)) { err('phone', 'Numéro de téléphone invalide.'); ok = false; }
    if (interest.length < 5) { err('interest', 'Décrivez les domaines dans lesquels vous souhaitez vous impliquer.'); ok = false; }
    if (motivation.length < 15) { err('motivation', 'Décrivez vos motivations (15 caractères minimum).'); ok = false; }
    if (!f.get('consent')) { err('consent', 'Votre accord est nécessaire pour traiter la candidature.'); ok = false; }
    if (!ok) { say('Veuillez corriger les champs signalés.'); form.querySelector('.fe:not(:empty)')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    sending = true; btn.disabled = true; const old = btn.innerHTML; btn.textContent = 'Envoi en cours…'; say('');
    try {
      const { data, error } = await db.rpc('submit_volunteer_application', {
        p_phone: phone || null, p_motivation: motivation, p_skills: String(f.get('skills') || '').trim() || null, p_interest: interest,
        p_availability: String(f.get('availability') || '').trim() || null, p_extra_info: String(f.get('extra_info') || '').trim() || null, p_consent: true
      });
      if (error) throw error;
      if (!data?.id) throw new Error('Réponse inattendue du serveur : la candidature n’est pas confirmée.');
      await render(session, data.created ? 'Candidature enregistrée avec succès. Le bureau va l’examiner.' : 'Candidature mise à jour avec succès.');
      $('#candidature').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (ex) { say(ex.message || 'Envoi impossible.'); btn.disabled = false; btn.innerHTML = old; sending = false; }
  });
}

init().catch(e => { console.warn('Parcours bénévole indisponible', e); reveal(); });
