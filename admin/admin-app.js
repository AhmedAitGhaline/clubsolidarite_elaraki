import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';

/* ============ Outils ============ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = () => window.lucide?.createIcons();
const dateFr = d => d ? new Date(d).toLocaleDateString('fr-FR') : 'Date non définie';
const initials = (a = '', b = '') => ((a[0] || '') + (b[0] || '')).toUpperCase() || '?';
const STATUS_FR = {draft:'Brouillon',preparing:'En préparation',ongoing:'En cours',completed:'Terminé',archived:'Archivé',published:'Publié',pending:'En attente',accepted:'Accepté',rejected:'Refusé'};
const chip = s => `<span class="chip ${esc(s)}">${esc(STATUS_FR[s] || s || '')}</span>`;
const ICON = {success:'check-circle-2', error:'alert-circle', info:'info'};

/* ---- Notifications (statut de chaque action) ---- */
function toast(type, title, msg = '', ms = 4500) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<i data-lucide="${ICON[type] || 'info'}"></i><div><strong>${esc(title)}</strong>${msg ? `<span>${esc(msg)}</span>` : ''}</div><button type="button" aria-label="Fermer"><i data-lucide="x"></i></button>`;
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  el.querySelector('button').onclick = close;
  $('#toasts').append(el); icons();
  if (ms) setTimeout(close, ms);
}
const ok = (t, m) => toast('success', t, m);
const fail = (t, m) => toast('error', t, m, 7000);

/* ---- Bouton occupé : désactive + spinner, puis exécute ---- */
async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try { return await fn(); }
  finally { if (btn) { btn.disabled = false; btn.classList.remove('loading'); } }
}

/* ---- Dialogues (remplacent alert / confirm / prompt) ---- */
function dialog({title, text = '', icon = 'info', tone = 'info', body = '', confirm = 'Confirmer', cancel = 'Annuler', confirmClass = '', wide = false, onOpen}) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="dlg ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="ico ${tone}"><i data-lucide="${icon}"></i></div><h2>${esc(title)}</h2>${text ? `<p>${text}</p>` : ''}<div class="dlg-body">${body}</div><div class="acts">${cancel ? `<button type="button" class="btn ghost" data-r="cancel">${esc(cancel)}</button>` : ''}${confirm ? `<button type="button" class="btn ${confirmClass}" data-r="ok">${esc(confirm)}</button>` : ''}</div></div>`;
    const done = v => { ov.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = e => { if (e.key === 'Escape') done(null); };
    ov.addEventListener('click', e => { if (e.target === ov) done(null); const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === 'ok' ? (ov.querySelector('textarea')?.value ?? true) : null); });
    document.addEventListener('keydown', key);
    document.body.append(ov); icons(); onOpen?.(ov);
    (ov.querySelector('textarea') || ov.querySelector('[data-r="ok"]') || ov.querySelector('button'))?.focus();
  });
}
const askConfirm = (title, text, confirm, tone = 'bad', icon = 'trash-2', confirmClass = 'bad') => dialog({title, text, icon, tone, confirm, confirmClass: tone === 'good' ? 'good' : confirmClass});

/* ============ Session ============ */
const cfg = window.CLUB_CONFIG || {};
if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) { location.replace('login.html'); throw new Error('Supabase configuration missing'); }
const db = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {auth:{persistSession:true, autoRefreshToken:true}});
const {data:{session}, error:sessionError} = await db.auth.getSession();
if (sessionError || !session) { location.replace('login.html'); throw new Error('Session missing'); }
const {data:access, error:accessErr} = await db.rpc('my_access');
if (accessErr) { location.replace('denied.html?setup=1'); throw accessErr; }
const perms = new Set(access?.permissions || []);
if (!perms.size) { location.replace('denied.html'); throw new Error('Unauthorized'); }   // l'élève reste connecté au site public
const can = p => perms.has(p), canAny = list => list.some(can);
let {data:me} = await db.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
const adminOnly = can('settings');
let displayName = me?.full_name || session.user.email;

function paintUser() {
  $('#adminUserName').textContent = displayName;
  $('#ddName').textContent = displayName;
  $('#ddMail').textContent = session.user.email;
  $('#userAvatar').textContent = initials(...String(displayName).split(' ').filter(Boolean).slice(0, 2));
}
paintUser();
if (!adminOnly) $('#tabSite').hidden = true;
$$('[data-need]').forEach(el => { if (!canAny(el.dataset.need.split(','))) el.hidden = true; });
$('#boot').remove();

async function logout(btn) {
  await busy(btn, async () => { await db.auth.signOut(); toast('info', 'Déconnexion', 'À bientôt !', 1200); setTimeout(() => location.replace('login.html'), 500); });
}
$('#logoutButton').onclick = e => logout(e.currentTarget);
$('#ddLogout').onclick = e => logout(e.currentTarget);

/* ============ Navigation ============ */
const views = ['dashboard','volunteers','members','events','team','messages','management','settings'];
const TITLES = {dashboard:'Tableau de bord', volunteers:'Bénévoles', members:'Membres', events:'Actions & Événements', team:'Équipe dirigeante', messages:'Chat du club', management:'Gestion', settings:'Paramètres'};
/* Permission requise par rubrique (l'interface masque ; la base de données refuse réellement via RLS) */
const NEED = {volunteers:['volunteers','applications'], members:['members','applications'], events:['events'], team:['team'], messages:['chat'], management:['management']};
const allowedView = v => !NEED[v] || canAny(NEED[v]);
$$('#adminNav [data-view]').forEach(a => { if (!allowedView(a.dataset.view)) a.hidden = true; });
let current = 'dashboard', stopView = () => {};
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#scrim').hidden = true; }
function go(view) {
  if (!views.includes(view) || !allowedView(view)) view = 'dashboard';
  current = view;
  views.forEach(v => $('#view-' + v).hidden = v !== view);
  $$('#adminNav [data-view]').forEach(a => a.classList.toggle('selected', a.dataset.view === view));
  $('#viewTitle').textContent = $('#viewCrumb').textContent = TITLES[view];
  history.replaceState(null, '', '#' + view);
  closeSidebar(); window.scrollTo({top:0});
  stopView(); stopView = () => {};
  loadView(view);
}
$('#adminNav').addEventListener('click', e => { const a = e.target.closest('[data-view]'); if (a) { e.preventDefault(); go(a.dataset.view); } });
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== current) go(v); });
$('#sidebarToggle').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').hidden = false; };
$('#scrim').onclick = closeSidebar;
$('#userChip').onclick = () => { const dd = $('#userDd'); dd.hidden = !dd.hidden; $('#userChip').setAttribute('aria-expanded', String(!dd.hidden)); };
document.addEventListener('click', e => { if (!e.target.closest('.user-menu')) $('#userDd').hidden = true; });
function openSettingsTab(t) {
  $$('.tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('#tab-site').hidden = t !== 'site'; $('#tab-account').hidden = t !== 'account';
}
$$('.tabs [data-tab]').forEach(b => b.onclick = () => openSettingsTab(b.dataset.tab));
$('#ddSettings').onclick = () => { $('#userDd').hidden = true; go('settings'); openSettingsTab('account'); };

/* ============ Données ============ */
async function query(table, columns = '*', opts = {}) {
  let q = db.from(table).select(columns);
  if (opts.order) q = q.order(opts.order, {ascending: opts.ascending ?? false});
  if (opts.eq) for (const [k, v] of Object.entries(opts.eq)) q = q.eq(k, v);
  const {data, error} = await q; if (error) throw error; return data || [];
}
const skeleton = n => Array.from({length:n}, () => '<div class="skeleton"></div>').join('');
const empty = (icon, msg) => `<div class="admin-empty"><i data-lucide="${icon}" style="width:28px;height:28px;margin-bottom:6px"></i><div>${esc(msg)}</div></div>`;
const fullName = a => `${a.first_name || ''} ${a.last_name || ''}`.trim();
const classOf = a => a.class_name || 'Classe non renseignée';

/* ============ Pastille « en attente » du menu ============ */
function setPending(n) { const b = $('#navPending'); b.textContent = n || 0; b.hidden = !n; }
async function refreshPending() {
  if (!canAny(['volunteers','applications'])) return;
  const {count} = await db.from('applications').select('id', {count:'exact', head:true}).eq('status', 'pending');
  setPending(count);
}

/* ============ Membres ============ */
let membersCache = [];
function paintMembers() {
  const q = ($('#memberSearch').value || '').trim().toLowerCase();
  const rows = membersCache.filter(m => !q || (fullName(m) + ' ' + classOf(m)).toLowerCase().includes(q));
  $('#memberTotal').textContent = membersCache.length;
  $('#membersList').innerHTML = rows.length ? rows.map(m => `<div class="row member-row"><span class="avatar">${esc(initials(m.first_name, m.last_name))}</span><div class="who"><strong>${esc((m.last_name || '') + ' ' + (m.first_name || ''))}</strong><small>${esc(classOf(m))}</small></div></div>`).join('') : empty('users', q ? 'Aucun membre ne correspond.' : 'Aucun membre accepté pour le moment.');
  icons();
}
async function loadMembers() {
  $('#membersList').innerHTML = skeleton(4);
  try { membersCache = await query('applications', 'id,first_name,last_name,class_name,status', {eq:{status:'accepted'}, order:'last_name', ascending:true}); paintMembers(); }
  catch (e) { $('#membersList').innerHTML = empty('alert-circle', 'Chargement impossible.'); fail('Membres indisponibles', e.message); }
}
$('#memberSearch').addEventListener('input', paintMembers);
$('#refreshMembers').onclick = e => busy(e.currentTarget, async () => { await loadMembers(); ok('Liste des membres actualisée'); });

/* ============ Formulaires projets / événements ============ */
function fillForm(form, row) {
  for (const [k, v] of Object.entries(row)) { const el = form.elements.namedItem(k); if (el && el.type !== 'file') el.value = v ?? ''; }
  form.elements.namedItem('id').value = row.id; form.dataset.existingCover = row.cover_image || '';
}
function clearForm(form) { form.reset(); form.elements.namedItem('id').value = ''; delete form.dataset.existingCover; }
function formMsg(id, msg, good) { const el = $('#' + id); el.textContent = msg; el.className = 'wide form-msg ' + (good ? 'ok' : 'err'); }
async function coverValue(form, id, existing = null) {
  const file = form.elements.cover_file?.files?.[0]; if (!file) return existing || null;
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Photo invalide : JPG, PNG ou WebP, maximum 5 Mo.');
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg', path = `${id || 'public'}/${crypto.randomUUID()}.${ext}`;
  const {error} = await db.storage.from('club-media').upload(path, file, {upsert:false, contentType:file.type}); if (error) throw error;
  return db.storage.from('club-media').getPublicUrl(path).data.publicUrl;
}
const slug = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.random().toString(36).slice(2, 7);
const thumb = src => `<img src="${esc(src || '../assets/branding/club-solidarite-logo.png')}" alt="">`;

/* ============ Paramètres ============ */
async function loadSettings() {
  const f = $('#settingsForm'), a = $('#adminProfileForm');
  a.elements.full_name.value = displayName === session.user.email ? (me?.full_name || '') : displayName;
  a.elements.email.value = session.user.email || '';
  if (!adminOnly) { openSettingsTab('account'); return; }
  try {
    const {data, error} = await db.from('site_settings').select('setting_key,setting_value'); if (error) throw error;
    for (const r of data || []) { const el = f.elements.namedItem(r.setting_key); if (el && r.setting_value?.text != null) el.value = r.setting_value.text; }
  } catch (e) { fail('Paramètres du site indisponibles', e.message); }
}
$('#settingsForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!adminOnly) return; const f = new FormData(e.currentTarget);
  await busy(e.currentTarget.querySelector('[type=submit]'), async () => {
    try {
      for (const k of ['hero_announcement', 'site_notice', 'club_name']) {
        const {error} = await db.from('site_settings').upsert({setting_key:k, setting_value:{text:f.get(k)}, updated_by:session.user.id}, {onConflict:'setting_key'}); if (error) throw error;
      }
      ok('Paramètres enregistrés', 'Les changements sont visibles sur le site.'); formMsg('settingsStatus', 'Paramètres enregistrés.', true);
    } catch (err) { formMsg('settingsStatus', 'Erreur : ' + err.message, false); fail('Enregistrement impossible', err.message); }
  });
});
$('#adminProfileForm').addEventListener('submit', async e => {
  e.preventDefault();
  /* CORRECTIF : e.currentTarget vaut null dès qu'un « await » a eu lieu (l'événement est terminé).
     L'ancien code relisait e.currentTarget.elements APRÈS la mise à jour => TypeError alors que le nom était déjà enregistré. */
  const form = e.currentTarget, f = new FormData(form), full_name = String(f.get('full_name') || '').trim().replace(/\s+/g, ' '), email = String(f.get('email') || '').trim(), password = String(f.get('password') || ''), password2 = String(f.get('password2') || '');
  if (!full_name) { formMsg('adminProfileStatus', 'Le nom est obligatoire.', false); fail('Nom', 'Saisissez votre nom.'); return; }
  if (password && password !== password2) { formMsg('adminProfileStatus', 'Les mots de passe ne correspondent pas.', false); fail('Mot de passe', 'Les deux mots de passe ne correspondent pas.'); return; }
  await busy(form.querySelector('[type=submit]'), async () => {
    try {
      const emailChanged = email && email.toLowerCase() !== String(session.user.email).toLowerCase(), upd = {};
      if (emailChanged) upd.email = email; if (password) upd.password = password;
      if (Object.keys(upd).length) { const {error} = await db.auth.updateUser(upd); if (error) throw error; }
      const patch = {full_name};
      if (full_name !== (me?.full_name || '')) { const [first, ...rest] = full_name.split(' '); patch.first_name = first; patch.last_name = rest.join(' '); }
      // L'e-mail du profil est synchronisé par la base après confirmation du changement (déclencheur sync_profile_email).
      const {data:rows, error:pe} = await db.from('profiles').update(patch).eq('id', session.user.id).select('id,full_name,first_name,last_name');
      if (pe) throw pe;
      if (!rows?.length) throw new Error('Le nom n’a pas été enregistré (profil introuvable ou accès refusé).');   // pas de faux succès
      me = {...(me || {}), ...rows[0]}; displayName = rows[0].full_name; paintUser();
      form.elements.password.value = form.elements.password2.value = '';
      ok('Compte mis à jour', emailChanged ? 'Confirmez votre nouvel e-mail depuis votre boîte mail.' : password ? 'Mot de passe modifié.' : 'Votre nom a été enregistré.');
      formMsg('adminProfileStatus', 'Compte mis à jour.', true);
    } catch (err) { formMsg('adminProfileStatus', 'Erreur : ' + err.message, false); fail('Mise à jour impossible', err.message); }
  });
});

/* ============ Chargement des vues ============ */
const MODULES = {dashboard:'./admin-dashboard.js?v=7', events:'./admin-events.js?v=7', volunteers:'./admin-volunteers.js?v=7', team:'./admin-team.js?v=7', messages:'./admin-chat.js?v=7', management:'./admin-management.js?v=7'};
const loadedModules = {};
const ctx = {db, session, access, can, canAny, $, $$, esc, icons, toast, ok, fail, busy, dialog, askConfirm, dateFr, chip, skeleton, empty, initials, query, fullName, formMsg, go, setPending, refreshPending, getName: () => displayName};
async function loadView(v) {
  if (v === 'members') await loadMembers();
  if (v === 'settings') await loadSettings();
  if (MODULES[v]) {
    try {
      loadedModules[v] ??= (await import(MODULES[v])).init(ctx);
      const m = loadedModules[v]; stopView = () => m.stop?.();
      await m.load();
    } catch (e) { console.error(e); fail('Rubrique indisponible', e.message); }
  }
}
icons();
refreshPending();
go(location.hash.slice(1) || 'dashboard');
