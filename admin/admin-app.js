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
const {data:me, error:meErr} = await db.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
if (meErr || !me || !['admin','editor'].includes(me.role)) { await db.auth.signOut(); location.replace('login.html'); throw new Error('Unauthorized'); }
const adminOnly = me.role === 'admin';
let displayName = me.full_name || session.user.email;

function paintUser() {
  $('#adminUserName').textContent = displayName;
  $('#ddName').textContent = displayName;
  $('#ddMail').textContent = session.user.email;
  $('#userAvatar').textContent = initials(...String(displayName).split(' ').filter(Boolean).slice(0, 2));
}
paintUser();
if (!adminOnly) $('#tabSite').hidden = true;
$('#boot').remove();

async function logout(btn) {
  await busy(btn, async () => { await db.auth.signOut(); toast('info', 'Déconnexion', 'À bientôt !', 1200); setTimeout(() => location.replace('login.html'), 500); });
}
$('#logoutButton').onclick = e => logout(e.currentTarget);
$('#ddLogout').onclick = e => logout(e.currentTarget);

/* ============ Navigation ============ */
const views = ['dashboard','members','applications','projects','events','messages','settings'];
const TITLES = {dashboard:'Tableau de bord', members:'Membres', applications:'Candidatures', projects:'Projets & Actions', events:'Événements', messages:'Chat du club', settings:'Paramètres'};
let current = 'dashboard', chatTimer = null;
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#scrim').hidden = true; }
function go(view) {
  if (!views.includes(view)) view = 'dashboard';
  current = view;
  views.forEach(v => $('#view-' + v).hidden = v !== view);
  $$('#adminNav [data-view]').forEach(a => a.classList.toggle('selected', a.dataset.view === view));
  $('#viewTitle').textContent = $('#viewCrumb').textContent = TITLES[view];
  history.replaceState(null, '', '#' + view);
  closeSidebar(); window.scrollTo({top:0});
  clearInterval(chatTimer);
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

/* ============ Tableau de bord ============ */
async function loadDashboard() {
  const host = $('#dashboardApplications'); host.innerHTML = skeleton(3);
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [m, p, ev, pr] = await Promise.all([
      db.from('applications').select('id', {count:'exact', head:true}).eq('status', 'accepted'),
      db.from('applications').select('id', {count:'exact', head:true}).eq('status', 'pending'),
      db.from('events').select('id', {count:'exact', head:true}).eq('status', 'published').gte('event_date', today),
      db.from('projects').select('id', {count:'exact', head:true}).in('status', ['ongoing','completed'])
    ]);
    $('#membersCount').textContent = m.count ?? '—'; $('#appsCount').textContent = p.count ?? '—';
    $('#upcomingCount').textContent = ev.count ?? '—'; $('#projectsCount').textContent = pr.count ?? '—';
    setPending(p.count);
    const {data, error} = await db.from('applications').select('*').order('submitted_at', {ascending:false}).limit(6);
    if (error) throw error;
    host.innerHTML = data.length ? data.map(a => `<div class="row"><span class="avatar">${esc(initials(a.first_name, a.last_name))}</span><div class="who"><strong>${esc(fullName(a))}</strong><small>${esc(classOf(a))}</small></div><span class="meta">${dateFr(a.submitted_at)}</span>${chip(a.status || 'pending')}<div class="acts"><button class="btn ghost sm" data-app-detail="${esc(a.id)}" type="button"><i data-lucide="eye"></i> Voir</button></div></div>`).join('') : empty('inbox', 'Aucune candidature pour le moment.');
  } catch (e) { host.innerHTML = empty('alert-circle', 'Chargement impossible.'); fail('Tableau de bord indisponible', e.message); }
  icons();
}
function setPending(n) { const b = $('#navPending'); b.textContent = n || 0; b.hidden = !n; }
$('#dashboardApplications').addEventListener('click', e => { const b = e.target.closest('[data-app-detail]'); if (b) showApplication(b.dataset.appDetail, b); });

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

/* ============ Candidatures ============ */
let appsCache = [], appFilter = 'all';
function paintApplications() {
  const count = s => appsCache.filter(a => (a.status || 'pending') === s).length;
  const F = [['all', 'Toutes', appsCache.length], ['pending', 'En attente', count('pending')], ['accepted', 'Acceptées', count('accepted')], ['rejected', 'Refusées', count('rejected')]];
  $('#appFilters').innerHTML = F.map(([k, l, n]) => `<button type="button" data-filter="${k}" class="${appFilter === k ? 'on' : ''}">${l}<b>${n}</b></button>`).join('');
  setPending(count('pending'));
  const rows = appsCache.filter(a => appFilter === 'all' || (a.status || 'pending') === appFilter);
  $('#applicationsList').innerHTML = rows.length ? rows.map(a => {
    const id = esc(a.id), st = a.status || 'pending';
    let acts = `<button class="btn ghost sm" data-app-detail="${id}" type="button"><i data-lucide="eye"></i> Voir la candidature</button>`;
    if (st === 'pending') acts += `<button class="btn good sm" data-app-action="accept" data-id="${id}" type="button"><i data-lucide="check"></i> Accepter</button><button class="btn bad sm" data-app-action="reject" data-id="${id}" type="button"><i data-lucide="x"></i> Refuser</button>`;
    else acts += `<button class="icon-btn danger" data-app-action="delete" data-id="${id}" type="button" title="Supprimer" aria-label="Supprimer"><i data-lucide="trash-2"></i></button>`;
    return `<article class="app-card"><span class="avatar">${esc(initials(a.first_name, a.last_name))}</span><div class="head"><strong>${esc(fullName(a))}</strong><small>${esc(classOf(a))} · ${dateFr(a.submitted_at)}${a.interest_area ? ' · ' + esc(a.interest_area) : ''}</small></div><div class="status">${chip(st)}</div>${a.motivation ? `<p class="excerpt">${esc(a.motivation)}</p>` : ''}<div class="acts">${acts}</div></article>`;
  }).join('') : empty('inbox', appFilter === 'all' ? 'Aucune candidature reçue.' : 'Aucune candidature dans cette catégorie.');
  icons();
}
async function loadApplications() {
  $('#applicationsList').innerHTML = skeleton(3);
  try { appsCache = await query('applications', '*', {order:'submitted_at'}); paintApplications(); }
  catch (e) { $('#applicationsList').innerHTML = empty('alert-circle', 'Chargement impossible.'); fail('Candidatures indisponibles', e.message); }
}
$('#appFilters').addEventListener('click', e => { const b = e.target.closest('[data-filter]'); if (b) { appFilter = b.dataset.filter; paintApplications(); } });
$('#refreshApplications').onclick = e => busy(e.currentTarget, async () => { await loadApplications(); ok('Candidatures actualisées'); });

async function showApplication(id, btn) {
  await busy(btn, async () => {
    const {data:a, error} = await db.from('applications').select('*').eq('id', id).single();
    if (error || !a) { fail('Candidature introuvable', error?.message); return; }
    const F = [['Nom complet', fullName(a)], ['E-mail', a.email], ['Téléphone', a.phone], ['Classe', a.class_name], ['Domaine d’intérêt', a.interest_area], ['Date de dépôt', dateFr(a.submitted_at)], ['Disponibilités', a.availability], ['Motivation', a.motivation], ['Motif du refus', a.rejection_reason]];
    const body = `<p style="margin:4px 0 0">${chip(a.status || 'pending')}</p><div class="detail-list">${F.filter(x => x[1]).map(([k, v]) => `<section><b>${esc(k)}</b><span>${esc(v)}</span></section>`).join('')}</div>`;
    await dialog({title:'Détail de la candidature', icon:'file-text', body, confirm:'Fermer', cancel:'', wide:true});
  });
}

$('#applicationsList').addEventListener('click', async e => {
  const d = e.target.closest('[data-app-detail]'); if (d) return showApplication(d.dataset.appDetail, d);
  const b = e.target.closest('[data-app-action]'); if (!b) return;
  const id = b.dataset.id, act = b.dataset.appAction, a = appsCache.find(x => x.id === id), name = a ? fullName(a) : 'cet élève';
  try {
    if (act === 'accept') {
      if (!await askConfirm('Accepter la candidature', `<b>${esc(name)}</b> deviendra membre du club. Cette décision est définitive : vous ne pourrez plus refuser cette candidature ensuite.`, 'Accepter', 'good', 'user-check')) return;
      await busy(b, async () => {
        const {data, error} = await db.from('applications').update({status:'accepted', reviewed_at:new Date().toISOString(), reviewed_by:session.user.id, rejection_reason:null}).eq('id', id).eq('status', 'pending').select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('Cette candidature n’est plus en attente.');
      });
      ok('Candidature acceptée', `${name} est maintenant membre du club.`);
    } else if (act === 'reject') {
      const reason = await dialog({title:'Refuser la candidature', icon:'user-x', tone:'bad', text:`Indiquez le motif du refus pour <b>${esc(name)}</b>.`, body:'<textarea rows="3" maxlength="500" placeholder="Motif du refus (obligatoire)" style="width:100%"></textarea>', confirm:'Refuser', confirmClass:'bad'});
      if (reason === null) return;
      if (!String(reason).trim()) { fail('Motif obligatoire', 'Saisissez le motif du refus pour continuer.'); return; }
      await busy(b, async () => {
        const {data, error} = await db.from('applications').update({status:'rejected', reviewed_at:new Date().toISOString(), reviewed_by:session.user.id, rejection_reason:String(reason).trim()}).eq('id', id).eq('status', 'pending').select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('Cette candidature n’est plus en attente.');
      });
      ok('Candidature refusée', `${name} a été refusé(e).`);
    } else if (act === 'delete') {
      if (!await askConfirm('Supprimer définitivement ?', `La candidature de <b>${esc(name)}</b> sera supprimée${a?.status === 'accepted' ? ' et l’élève ne sera plus membre du club' : ''}. Cette action est irréversible.`, 'Supprimer')) return;
      await busy(b, async () => { const {error} = await db.from('applications').delete().eq('id', id); if (error) throw error; });
      ok('Candidature supprimée', name);
    }
    await loadApplications();
  } catch (err) { fail('Action impossible', err.message); await loadApplications(); }
});

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

/* ---- Projets ---- */
async function loadProjects() {
  const host = $('#projectsList'); host.innerHTML = skeleton(3);
  try {
    const rows = await query('projects', '*', {order:'created_at'});
    host.innerHTML = rows.length ? rows.map(x => `<div class="row thumb">${thumb(x.cover_image)}<div class="who"><strong>${esc(x.title)}</strong><small>${esc(x.category)}${x.short_description ? ' · ' + esc(x.short_description) : ''}</small></div>${chip(x.status)}<div class="acts"><button class="icon-btn" data-project-edit="${esc(x.id)}" title="Modifier" aria-label="Modifier" type="button"><i data-lucide="pencil"></i></button><button class="icon-btn danger" data-project-delete="${esc(x.id)}" data-name="${esc(x.title)}" title="Supprimer" aria-label="Supprimer" type="button"><i data-lucide="trash-2"></i></button></div></div>`).join('') : empty('folder-open', 'Aucun projet. Créez votre premier projet ci-dessus.');
  } catch (e) { host.innerHTML = empty('alert-circle', 'Chargement impossible.'); fail('Projets indisponibles', e.message); }
  icons();
}
$('#projectsList').addEventListener('click', async e => {
  const edit = e.target.closest('[data-project-edit]'), del = e.target.closest('[data-project-delete]');
  try {
    if (edit) { await busy(edit, async () => { const {data, error} = await db.from('projects').select('*').eq('id', edit.dataset.projectEdit).single(); if (error) throw error; fillForm($('#projectForm'), data); $('#projectFormTitle').textContent = 'Modifier le projet'; $('#projectFormPanel').scrollIntoView({behavior:'smooth'}); }); toast('info', 'Mode modification', 'Le projet est chargé dans le formulaire.', 2500); }
    if (del) {
      if (!await askConfirm('Supprimer ce projet ?', `« ${esc(del.dataset.name)} » sera supprimé définitivement.`, 'Supprimer')) return;
      await busy(del, async () => { const {error} = await db.from('projects').delete().eq('id', del.dataset.projectDelete); if (error) throw error; });
      ok('Projet supprimé', del.dataset.name); await loadProjects();
    }
  } catch (err) { fail('Action impossible', err.message); }
});
$('#projectForm').addEventListener('submit', async e => {
  e.preventDefault(); const form = e.currentTarget, f = new FormData(form), id = f.get('id') || null, title = String(f.get('title')).trim(), btn = form.querySelector('[type=submit]');
  await busy(btn, async () => {
    try {
      const mediaId = id || crypto.randomUUID(), cover = await coverValue(form, mediaId, form.dataset.existingCover || null);
      const payload = {title, category:f.get('category'), short_description:f.get('short_description'), description:f.get('description'), cover_image:cover, status:f.get('status')};
      const {error} = id ? await db.from('projects').update(payload).eq('id', id) : await db.from('projects').insert({...payload, id:mediaId, slug:slug(title)});
      if (error) throw error;
      ok(id ? 'Projet mis à jour' : 'Projet créé', title); formMsg('projectStatus', 'Projet enregistré.', true);
      clearForm(form); $('#projectFormTitle').textContent = 'Créer un projet'; await loadProjects();
    } catch (err) { formMsg('projectStatus', 'Erreur : ' + err.message, false); fail('Enregistrement impossible', err.message); }
  });
});
$('#resetProject').onclick = () => { clearForm($('#projectForm')); $('#projectFormTitle').textContent = 'Créer un projet'; formMsg('projectStatus', '', true); toast('info', 'Formulaire réinitialisé', '', 1800); };
$('#refreshProjects').onclick = e => busy(e.currentTarget, async () => { await loadProjects(); ok('Projets actualisés'); });

/* ---- Événements ---- */
async function loadEvents() {
  const host = $('#eventsList'); host.innerHTML = skeleton(3);
  try {
    const rows = await query('events', '*', {order:'event_date'});
    host.innerHTML = rows.length ? rows.map(x => `<div class="row thumb">${thumb(x.cover_image)}<div class="who"><strong>${esc(x.title)}</strong><small>${x.event_date ? dateFr(x.event_date) : 'Date à définir'} · ${esc(x.category)}${x.location ? ' · ' + esc(x.location) : ''}</small></div>${chip(x.status)}<div class="acts"><button class="icon-btn" data-event-edit="${esc(x.id)}" title="Modifier" aria-label="Modifier" type="button"><i data-lucide="pencil"></i></button><button class="icon-btn danger" data-event-delete="${esc(x.id)}" data-name="${esc(x.title)}" title="Supprimer" aria-label="Supprimer" type="button"><i data-lucide="trash-2"></i></button></div></div>`).join('') : empty('calendar-x', 'Aucun événement. Ajoutez un événement ci-dessus.');
  } catch (e) { host.innerHTML = empty('alert-circle', 'Chargement impossible.'); fail('Événements indisponibles', e.message); }
  icons();
}
$('#eventsList').addEventListener('click', async e => {
  const edit = e.target.closest('[data-event-edit]'), del = e.target.closest('[data-event-delete]');
  try {
    if (edit) { await busy(edit, async () => { const {data, error} = await db.from('events').select('*').eq('id', edit.dataset.eventEdit).single(); if (error) throw error; fillForm($('#eventForm'), data); $('#eventFormTitle').textContent = 'Modifier l’événement'; $('#eventFormPanel').scrollIntoView({behavior:'smooth'}); }); toast('info', 'Mode modification', 'L’événement est chargé dans le formulaire.', 2500); }
    if (del) {
      if (!await askConfirm('Supprimer cet événement ?', `« ${esc(del.dataset.name)} » sera supprimé définitivement.`, 'Supprimer')) return;
      await busy(del, async () => { const {error} = await db.from('events').delete().eq('id', del.dataset.eventDelete); if (error) throw error; });
      ok('Événement supprimé', del.dataset.name); await loadEvents();
    }
  } catch (err) { fail('Action impossible', err.message); }
});
$('#eventForm').addEventListener('submit', async e => {
  e.preventDefault(); const form = e.currentTarget, f = new FormData(form), id = f.get('id') || null, title = String(f.get('title')).trim(), btn = form.querySelector('[type=submit]');
  await busy(btn, async () => {
    try {
      const mediaId = id || crypto.randomUUID(), cover = await coverValue(form, mediaId, form.dataset.existingCover || null);
      const payload = {title, event_date:f.get('event_date'), location:f.get('location') || null, category:f.get('category'), summary:f.get('summary'), description:f.get('description') || '', cover_image:cover, status:f.get('status'), date_type:'actual', published_at:f.get('status') === 'published' ? new Date().toISOString() : null};
      const {error} = id ? await db.from('events').update(payload).eq('id', id) : await db.from('events').insert({...payload, id:mediaId, slug:slug(title)});
      if (error) throw error;
      ok(id ? 'Événement mis à jour' : 'Événement créé', title + (payload.status === 'published' ? ' — publié sur le site.' : ' — enregistré en brouillon.')); formMsg('eventStatus', 'Événement enregistré.', true);
      clearForm(form); $('#eventFormTitle').textContent = 'Ajouter un événement à venir'; await loadEvents();
    } catch (err) { formMsg('eventStatus', 'Erreur : ' + err.message, false); fail('Enregistrement impossible', err.message); }
  });
});
$('#resetEvent').onclick = () => { clearForm($('#eventForm')); $('#eventFormTitle').textContent = 'Ajouter un événement à venir'; formMsg('eventStatus', '', true); toast('info', 'Formulaire réinitialisé', '', 1800); };
$('#refreshEvents').onclick = e => busy(e.currentTarget, async () => { await loadEvents(); ok('Événements actualisés'); });

/* ============ Chat ============ */
let lastChatCount = -1;
async function loadChat(silent = false) {
  const host = $('#chatMessages');
  try {
    const rows = await query('chat_messages', 'id,user_id,author_name,message,created_at', {order:'created_at'});
    if (silent && rows.length === lastChatCount) return;
    lastChatCount = rows.length;
    host.innerHTML = rows.map(m => `<div class="chat-message ${m.user_id === session.user.id ? 'mine' : ''}"><strong>${esc(m.author_name || 'Membre du bureau')}</strong><p>${esc(m.message)}</p><small>${dateFr(m.created_at)} · ${new Date(m.created_at).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}</small></div>`).join('') || empty('message-circle', 'Aucun message. Lancez la conversation.');
    host.scrollTop = host.scrollHeight; icons();
  } catch (e) { host.innerHTML = empty('alert-circle', 'Le chat nécessite la migration SQL v2.'); if (!silent) fail('Chat indisponible', e.message); }
}
$('#chatForm').addEventListener('submit', async e => {
  e.preventDefault(); const form = e.currentTarget, input = form.elements.message, msg = input.value.trim(); if (!msg) return;
  await busy(form.querySelector('button'), async () => {
    const {error} = await db.from('chat_messages').insert({user_id:session.user.id, author_name:displayName, message:msg});
    if (error) { fail('Message non envoyé', error.message); return; }
    input.value = ''; await loadChat(); toast('success', 'Message envoyé', '', 1500);
  });
});

/* ============ Paramètres ============ */
async function loadSettings() {
  const f = $('#settingsForm'), a = $('#adminProfileForm');
  a.elements.full_name.value = displayName === session.user.email ? (me.full_name || '') : displayName;
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
  e.preventDefault(); const f = new FormData(e.currentTarget), full_name = String(f.get('full_name') || '').trim(), email = String(f.get('email') || '').trim(), password = String(f.get('password') || ''), password2 = String(f.get('password2') || '');
  if (password && password !== password2) { formMsg('adminProfileStatus', 'Les mots de passe ne correspondent pas.', false); fail('Mot de passe', 'Les deux mots de passe ne correspondent pas.'); return; }
  await busy(e.currentTarget.querySelector('[type=submit]'), async () => {
    try {
      const upd = {}; if (email && email !== session.user.email) upd.email = email; if (password) upd.password = password;
      if (Object.keys(upd).length) { const {error} = await db.auth.updateUser(upd); if (error) throw error; }
      const {error:pe} = await db.from('profiles').update({full_name, email, updated_at:new Date().toISOString()}).eq('id', session.user.id); if (pe) throw pe;
      displayName = full_name; paintUser(); e.currentTarget.elements.password.value = e.currentTarget.elements.password2.value = '';
      ok('Compte mis à jour', upd.email ? 'Confirmez votre nouvel e-mail depuis votre boîte mail.' : password ? 'Mot de passe modifié.' : 'Vos informations ont été enregistrées.');
      formMsg('adminProfileStatus', 'Compte mis à jour.', true);
    } catch (err) { formMsg('adminProfileStatus', 'Erreur : ' + err.message, false); fail('Mise à jour impossible', err.message); }
  });
});

/* ============ Chargement des vues ============ */
async function loadView(v) {
  if (v === 'dashboard') await loadDashboard();
  if (v === 'members') await loadMembers();
  if (v === 'applications') await loadApplications();
  if (v === 'projects') await loadProjects();
  if (v === 'events') await loadEvents();
  if (v === 'messages') { lastChatCount = -1; await loadChat(); chatTimer = setInterval(() => loadChat(true), 10000); }
  if (v === 'settings') await loadSettings();
}
icons();
go(location.hash.slice(1) || 'dashboard');
