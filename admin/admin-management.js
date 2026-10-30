/* Gestion des comptes : rôles et permissions. L'interface ne fait que refléter les règles ;
   admin_set_role / admin_update_account (SECURITY DEFINER) les appliquent côté serveur. */
import {TRACKS} from '../assets/academics.js';
export function init(ctx) {
  const {db, access, $, esc, icons, ok, fail, busy, dialog, askConfirm, dateFr, empty, skeleton} = ctx;
  const PAGE = 15; let accounts = [], roles = [], permCatalog = [], page = 1;
  const isSuper = !!access.is_super, myPerms = new Set(access.permissions || []);
  const roleOf = k => roles.find(r => r.role_key === k) || {role_key: k, label: k, rank: 0, default_permissions: []};
  const myRank = () => roleOf(access.role_key).rank;
  const level = a => [a.grade_level, a.track, a.class_number && 'classe ' + a.class_number].filter(Boolean).join(' · ') || '—';
  const effective = a => a.role_key === 'super_admin' ? permCatalog.map(p => p.perm_key) : [...new Set([...(roleOf(a.role_key).default_permissions || []), ...(a.permissions || [])])];
  const accessBadge = a => { const n = effective(a).length; return a.role_key === 'super_admin' ? '<span class="access-badge full">Accès complet</span>' : n ? `<span class="access-badge limited">${n} module${n > 1 ? 's' : ''}</span>` : '<span class="access-badge none">Aucun accès admin</span>'; };
  const canEdit = a => isSuper || (a.user_id !== ctx.session.user.id && a.role_rank < myRank());   // simple indication ; la base décide

  function filtered() {
    const q = $('#accSearch').value.trim().toLowerCase(), r = $('#accRole').value, s = $('#accSort').value;
    const list = accounts.filter(a => (!r || a.role_key === r) && (!q || (a.full_name + ' ' + a.email).toLowerCase().includes(q)));
    const byName = (x, y) => (x.full_name || x.email).localeCompare(y.full_name || y.email, 'fr');
    return list.sort(s === 'name_asc' ? byName : s === 'name_desc' ? (x, y) => byName(y, x) : s === 'date_asc' ? (x, y) => new Date(x.account_created_at) - new Date(y.account_created_at) : (x, y) => new Date(y.account_created_at) - new Date(x.account_created_at));
  }
  function paint() {
    const list = filtered(), pages = Math.max(1, Math.ceil(list.length / PAGE)); page = Math.min(page, pages);
    $('#accTotal').textContent = accounts.length;
    $('#accBody').innerHTML = list.slice((page - 1) * PAGE, page * PAGE).map(a => `<tr><td class="cell-name"><strong>${esc(a.full_name || '—')}</strong>${a.email_confirmed ? '' : '<small>E-mail non confirmé</small>'}</td><td>${esc(a.email)}</td><td>${esc(level(a))}</td><td><span class="role-chip">${esc(a.role_label)}</span></td><td>${a.functions.length ? `<div class="fn-list">${a.functions.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : '—'}</td><td class="nowrap">${a.account_created_at ? dateFr(a.account_created_at) : '—'}</td><td>${accessBadge(a)}</td><td class="r"><button class="btn ghost sm" data-acc="${esc(a.user_id)}" type="button"><i data-lucide="user-cog"></i> Gérer</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty-cell">Aucun compte ne correspond.</td></tr>';
    $('#accPager').innerHTML = `<span>${list.length} compte(s)</span><span class="pg"><button class="btn ghost sm" data-pg="-1" ${page <= 1 ? 'disabled' : ''} type="button">Précédent</button><span style="align-self:center">${page} / ${pages}</span><button class="btn ghost sm" data-pg="1" ${page >= pages ? 'disabled' : ''} type="button">Suivant</button></span>`;
    icons();
  }

  async function manage(a) {
    const editable = canEdit(a), inherited = new Set(roleOf(a.role_key).default_permissions || []);
    const roleOpts = roles.filter(r => isSuper || r.rank < myRank() || r.role_key === a.role_key).sort((x, y) => y.rank - x.rank).map(r => `<option value="${esc(r.role_key)}">${esc(r.label)}</option>`).join('');
    const permBox = (p, own) => { const inh = inherited.has(p.perm_key), locked = !isSuper && !myPerms.has(p.perm_key); return `<label class="${inh ? 'inherited' : locked ? 'locked' : ''}"><input type="checkbox" value="${esc(p.perm_key)}" ${inh || own ? 'checked' : ''} ${inh || locked || !editable ? 'disabled' : ''}> ${esc(p.label)}${inh ? ' <small>(rôle)</small>' : ''}</label>`; };
    const body = `<div class="detail-list"><section><b>E-mail</b><span>${esc(a.email)}</span></section><section><b>Compte créé le</b><span>${a.account_created_at ? dateFr(a.account_created_at) : '—'}</span></section><section><b>Dernière connexion</b><span>${a.last_sign_in_at ? dateFr(a.last_sign_in_at) : 'Jamais'}</span></section><section><b>Fonctions au club</b><span>${esc(a.functions.join(', ') || '—')}</span></section></div>
      <div class="f-row"><b>Informations du compte</b><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><input type="text" id="mgFirst" placeholder="Prénom" maxlength="80" value="${esc(a.first_name)}" ${editable ? '' : 'disabled'}><input type="text" id="mgLast" placeholder="Nom" maxlength="80" value="${esc(a.last_name)}" ${editable ? '' : 'disabled'}><select id="mgGrade" ${editable ? '' : 'disabled'}><option value="">Niveau —</option>${Object.keys(TRACKS).map(g => `<option>${g}</option>`).join('')}</select><select id="mgTrack" ${editable ? '' : 'disabled'}></select><input type="text" id="mgClass" placeholder="Classe" maxlength="20" value="${esc(a.class_number)}" ${editable ? '' : 'disabled'}></div></div>
      <div class="f-row"><label for="mgRole">Rôle</label><select id="mgRole" ${editable ? '' : 'disabled'}>${roleOpts}</select></div>
      <div class="f-row"><b>Permissions par module</b><div class="perm-grid" id="mgPerms">${permCatalog.map(p => permBox(p, (a.permissions || []).includes(p.perm_key))).join('')}</div></div>
      ${editable ? '' : '<p class="admin-help">Vous ne pouvez pas modifier ce compte (rang égal ou supérieur, ou votre propre compte).</p>'}`;
    let ov;
    const fillTrack = () => { const g = ov.querySelector('#mgGrade').value, t = ov.querySelector('#mgTrack'); t.innerHTML = '<option value="">Filière —</option>' + (TRACKS[g] || []).map(x => `<option>${x}</option>`).join(''); };
    const res = await dialog({title: a.full_name || a.email, icon: 'user-cog', body, confirm: editable ? 'Enregistrer' : '', cancel: 'Fermer', wide: true, onOpen: o => {
      ov = o; const g = o.querySelector('#mgGrade'); g.value = a.grade_level; fillTrack(); o.querySelector('#mgTrack').value = a.track; g.addEventListener('change', fillTrack);
      o.querySelector('#mgRole').value = a.role_key;
      o.querySelector('#mgRole').addEventListener('change', e => { const d = new Set(roleOf(e.target.value).default_permissions || []); o.querySelectorAll('#mgPerms label').forEach(l => { const c = l.querySelector('input'), inh = d.has(c.value); l.classList.toggle('inherited', inh); if (inh) { c.checked = true; c.disabled = true; } else if (c.disabled && !l.classList.contains('locked')) { c.disabled = false; c.checked = false; } }); });
    }});
    if (res === null || !editable) return;
    const role = ov.querySelector('#mgRole').value;
    const extra = [...ov.querySelectorAll('#mgPerms input:checked:not(:disabled)')].map(c => c.value);
    const info = {p_first: ov.querySelector('#mgFirst').value, p_last: ov.querySelector('#mgLast').value, p_grade: ov.querySelector('#mgGrade').value, p_track: ov.querySelector('#mgTrack').value, p_class: ov.querySelector('#mgClass').value};
    const infoChanged = info.p_first !== a.first_name || info.p_last !== a.last_name || info.p_grade !== a.grade_level || info.p_track !== a.track || info.p_class !== a.class_number;
    const roleChanged = role !== a.role_key || extra.slice().sort().join() !== (a.permissions || []).slice().sort().join();
    if (!infoChanged && !roleChanged) return;
    if (roleChanged) {
      const demote = roleOf(role).rank < roleOf(a.role_key).rank;
      if (!await askConfirm('Confirmer la modification des droits', `<b>${esc(a.full_name || a.email)}</b> : ${esc(roleOf(a.role_key).label)} → <b>${esc(roleOf(role).label)}</b>${extra.length ? ' + ' + extra.length + ' permission(s) ajoutée(s)' : ''}.${demote ? ' Cet utilisateur perdra une partie de ses accès.' : ''}`, 'Confirmer', demote ? 'bad' : 'good', 'shield-check')) return;
    }
    try {
      if (infoChanged) { const {error} = await db.rpc('admin_update_account', {p_target: a.user_id, ...info}); if (error) throw error; }
      if (roleChanged) { const {error} = await db.rpc('admin_set_role', {p_target: a.user_id, p_role: role, p_permissions: extra}); if (error) throw error; }
      ok('Compte mis à jour', a.full_name || a.email); await load();
    } catch (e) { fail('Modification refusée', e.message); await load(); }
  }

  async function loadAudit() {
    const host = $('#auditList');
    const {data, error} = await db.from('activity_logs').select('id,action,entity_type,entity_id,details,created_at,profiles:actor_id(full_name,email)').order('created_at', {ascending: false}).limit(30);
    if (error) { host.innerHTML = empty('alert-circle', 'Journal indisponible.'); return; }
    const L = {'role.assigned': 'Rôle attribué', 'role.changed': 'Rôle modifié', 'role.deleted': 'Rôle supprimé', 'account.updated': 'Compte modifié', 'application.status': 'Statut de candidature', 'team.added': 'Équipe : ajout', 'team.changed': 'Équipe : modification', 'team.removed': 'Équipe : retrait'};
    host.innerHTML = data.length ? data.map(l => `<div class="row audit-row"><div class="who"><strong>${esc(L[l.action] || l.action)}</strong><small>${esc(l.profiles?.full_name || l.profiles?.email || 'Système')} · ${esc(JSON.stringify(l.details || {}).slice(0, 140))}</small></div><span class="meta">${new Date(l.created_at).toLocaleString('fr-FR')}</span></div>`).join('') : empty('scroll-text', 'Aucune action enregistrée.');
  }

  async function load() {
    $('#accBody').innerHTML = `<tr><td colspan="8">${skeleton(4)}</td></tr>`;
    const [acc, r, p] = await Promise.all([db.rpc('admin_list_accounts'), db.from('club_roles').select('*'), db.from('club_permissions').select('*').order('label')]);
    if (acc.error || r.error || p.error) { $('#accBody').innerHTML = '<tr><td colspan="8" class="empty-cell">Chargement impossible.</td></tr>'; return fail('Gestion indisponible', (acc.error || r.error || p.error).message); }
    accounts = acc.data || []; roles = r.data || []; permCatalog = p.data || [];
    const sel = $('#accRole'), cur = sel.value; sel.innerHTML = '<option value="">Tous les rôles</option>' + roles.sort((x, y) => y.rank - x.rank).map(x => `<option value="${esc(x.role_key)}">${esc(x.label)}</option>`).join(''); sel.value = cur;
    paint(); loadAudit();
  }
  ['accSearch', 'accRole', 'accSort'].forEach(id => $('#' + id).addEventListener('input', () => { page = 1; paint(); }));
  $('#accPager').addEventListener('click', e => { const b = e.target.closest('[data-pg]'); if (b) { page += +b.dataset.pg; paint(); } });
  $('#accBody').addEventListener('click', e => { const b = e.target.closest('[data-acc]'); if (b) { const a = accounts.find(x => x.user_id === b.dataset.acc); if (a) manage(a); } });
  $('#refreshAccounts').onclick = e => busy(e.currentTarget, async () => { await load(); ok('Comptes actualisés'); });
  return {load};
}
