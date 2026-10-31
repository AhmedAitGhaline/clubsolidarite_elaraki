/* Transforme une entrée du journal en description humaine (JAMAIS de JSON brut affiché). */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const APP_STATUS = {pending:'En attente', accepted:'Acceptée', rejected:'Refusée', archived:'Archivée'};
const PERMS = {applications:'Candidatures', volunteers:'Bénévoles', members:'Membres', projects:'Projets', events:'Actions & Événements', chat:'Chat du club', chat_moderate:'Modération du chat', settings:'Paramètres', contact:'Messages de contact', team:'Équipe dirigeante', management:'Gestion'};
const FIELDS = {title:'Titre', event_date:'Date', end_date:'Date de fin', start_time:'Heure de début', end_time:'Heure de fin', location:'Lieu', category:'Catégorie', is_visible:'Visibilité', kind:'Type', summary:'Résumé', description:'Description', cover_image:'Image principale'};
const SETTINGS = {hero_announcement:'Annonce de la page d’accueil'};
const KIND = {event:'Événement', action:'Action'};
const fmtDate = d => { const t = new Date(d).toLocaleString('fr-FR', {day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit'}); return / à /.test(t) ? t : t.replace(/(\d{4}),? /, '$1 à '); };
export const CATEGORIES = {volunteers:'Bénévoles', members:'Membres', roles:'Rôles et permissions', events:'Actions & Événements', chat:'Chat', settings:'Paramètres'};

function category(l) {
  const a = l.action || '';
  if (a.startsWith('application.')) return 'volunteers';
  if (a.startsWith('member.') || a.startsWith('team.')) return 'members';
  if (a.startsWith('role.') || a.startsWith('permissions.') || a.startsWith('account.')) return 'roles';
  if (a.startsWith('event.') || a.startsWith('photo.')) return 'events';
  if (a.startsWith('chat.')) return 'chat';
  if (a.startsWith('setting.')) return 'settings';
  return 'other';
}
const val = (k, v) => v === null || v === undefined || v === '' ? '—' : k === 'is_visible' ? (v === true || v === 'true' ? 'Visible' : 'Masqué') : k === 'kind' ? (KIND[v] || v) : /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T12:00:00').toLocaleDateString('fr-FR', {day:'numeric', month:'long', year:'numeric'}) : String(v).replace(/^(\d{2}:\d{2}):\d{2}$/, '$1');
const permList = a => (a || []).map(p => PERMS[p] || p).join(', ') || 'Aucune permission supplémentaire';

/** @returns {{title,icon,tone,badge,lines:[label,value][],category,when,actor,target}} */
export function describe(l) {
  const o = l.old_values || {}, n = l.new_values || {}, m = l.details || {};
  const actor = l.actor_name || 'Système', target = l.target_name || '';
  const lines = []; let title = l.action, icon = 'activity', tone = 'info', badge = null;
  const who = (label, v = target) => v && lines.push([label, v]);
  const by = (label = 'Effectuée par') => lines.push([label, actor]);
  const kind = KIND[m.kind || n.kind || o.kind] || 'Événement', isAction = (m.kind || n.kind || o.kind) === 'action';
  switch (l.action) {
    case 'application.status': {
      const st = n.status; badge = st;
      title = st === 'accepted' ? 'Candidature acceptée' : st === 'rejected' ? 'Candidature refusée' : st === 'archived' ? 'Candidature archivée' : 'Statut de candidature modifié';
      icon = st === 'accepted' ? 'user-check' : st === 'rejected' ? 'user-x' : 'refresh-cw'; tone = st === 'accepted' ? 'ok' : st === 'rejected' ? 'bad' : 'wait';
      who('Candidat');
      if (o.status) lines.push(['Ancien statut', APP_STATUS[o.status] || o.status]); lines.push(['Nouveau statut', APP_STATUS[st] || st]); by(); break; }
    case 'application.received': title = 'Nouvelle candidature reçue'; icon = 'inbox'; tone = 'info'; badge = 'pending'; who('Candidat'); break;
    case 'application.resubmitted': title = 'Candidature renvoyée'; icon = 'rotate-cw'; tone = 'wait'; badge = 'pending'; who('Candidat'); by('Renvoyée par'); break;
    case 'application.self_updated': title = 'Candidature mise à jour par le candidat'; icon = 'pencil'; who('Candidat'); break;
    case 'application.updated': title = 'Informations d’un bénévole modifiées'; icon = 'pencil'; who('Bénévole'); if (m.notes_changed) lines.push(['Détail', 'Note interne modifiée']); by('Modifiées par'); break;
    case 'application.deleted': title = 'Candidature supprimée'; icon = 'trash-2'; tone = 'bad'; who('Candidat'); if (o.status) lines.push(['Statut au moment de la suppression', APP_STATUS[o.status] || o.status]); by('Supprimée par'); break;
    case 'member.added': title = 'Membre ajouté'; icon = 'user-plus'; tone = 'ok'; who('Membre'); by('Ajouté par'); break;
    case 'member.changed': title = 'Membre modifié'; icon = 'pencil'; who('Membre'); by('Modifié par'); break;
    case 'member.removed': title = 'Membre supprimé'; icon = 'user-minus'; tone = 'bad'; who('Membre'); by('Supprimé par'); break;
    case 'team.added': title = 'Membre ajouté à l’équipe dirigeante'; icon = 'award'; tone = 'ok'; who('Personne concernée'); lines.push(['Fonction', n.function || m.function || '—']); by('Ajouté par'); break;
    case 'team.changed': title = 'Équipe dirigeante modifiée'; icon = 'award'; who('Personne concernée'); if (o.person && o.person !== n.person) { lines.push(['Ancien titulaire', o.person]); lines.push(['Nouveau titulaire', n.person]); } lines.push(['Ancienne fonction', o.function || '—']); lines.push(['Nouvelle fonction', n.function || '—']); by('Modifiée par'); break;
    case 'team.removed': title = 'Membre retiré de l’équipe dirigeante'; icon = 'user-minus'; tone = 'bad'; who('Personne concernée'); lines.push(['Fonction retirée', o.function || m.function || '—']); by('Retiré par'); break;
    case 'role.assigned': title = 'Rôle attribué'; icon = 'shield-plus'; tone = 'ok'; who('Personne concernée'); lines.push(['Nouveau rôle', n.role || '—']); if (n.permissions?.length) lines.push(['Permissions', permList(n.permissions)]); by(); break;
    case 'role.changed': title = 'Rôle modifié'; icon = 'shield-check'; tone = 'wait'; who('Personne concernée'); lines.push(['Ancien rôle', o.role || '—']); lines.push(['Nouveau rôle', n.role || '—']); by(); break;
    case 'role.deleted': title = 'Rôle supprimé'; icon = 'shield-off'; tone = 'bad'; who('Personne concernée'); lines.push(['Rôle supprimé', o.role || '—']); by(); break;
    case 'permissions.changed': title = 'Permissions modifiées'; icon = 'key-round'; tone = 'wait'; who('Personne concernée'); lines.push(['Rôle', n.role || '—']); lines.push(['Anciennes permissions', permList(o.permissions)]); lines.push(['Nouvelles permissions', permList(n.permissions)]); by(); break;
    case 'account.updated': title = 'Informations de compte modifiées'; icon = 'user-cog'; who('Personne concernée'); {
      const diff = [['name', 'Nom'], ['grade_level', 'Niveau'], ['track', 'Filière'], ['class_number', 'Classe']].filter(([k]) => (o[k] ?? '') !== (n[k] ?? '')); diff.forEach(([k, t]) => lines.push([t, `${o[k] || '—'} → ${n[k] || '—'}`])); } by('Modifiées par'); break;
    case 'event.created': title = `${kind} créé${isAction ? 'e' : ''}`; icon = 'calendar-plus'; tone = 'ok'; who(kind); by('Créé' + (isAction ? 'e' : '') + ' par'); break;
    case 'event.updated': title = `${kind} modifié${isAction ? 'e' : ''}`; icon = 'calendar-cog'; who(kind); {
      const f = m.fields || []; Object.keys(n).forEach(k => lines.push([FIELDS[k] || k, `${val(k, o[k])} → ${val(k, n[k])}`]));
      const other = f.filter(k => !(k in n)).map(k => FIELDS[k] || k); if (other.length) lines.push(['Contenu modifié', other.join(', ')]); } by('Modifié' + (isAction ? 'e' : '') + ' par'); break;
    case 'event.published': title = `${kind} publié${isAction ? 'e' : ''}`; icon = 'globe'; tone = 'ok'; badge = 'published'; who(kind); by('Publié' + (isAction ? 'e' : '') + ' par'); break;
    case 'event.unpublished': title = `${kind} dépublié${isAction ? 'e' : ''}`; icon = 'eye-off'; tone = 'wait'; badge = 'draft'; who(kind); by('Dépublié' + (isAction ? 'e' : '') + ' par'); break;
    case 'event.deleted': title = `${kind} supprimé${isAction ? 'e' : ''}`; icon = 'trash-2'; tone = 'bad'; who(kind); by('Supprimé' + (isAction ? 'e' : '') + ' par'); break;
    case 'photo.added': title = 'Photo ajoutée'; icon = 'image-plus'; who('Action / Événement'); by('Ajoutée par'); break;
    case 'photo.removed': title = 'Photo supprimée'; icon = 'image-minus'; tone = 'bad'; who('Action / Événement'); by('Supprimée par'); break;
    case 'chat.pinned': title = 'Message épinglé'; icon = 'pin'; tone = 'ok'; who('Auteur du message'); if (m.excerpt) lines.push(['Message', m.excerpt]); by('Épinglé par'); break;
    case 'chat.unpinned': title = 'Message désépinglé'; icon = 'pin-off'; tone = 'wait'; who('Auteur du message'); if (m.excerpt) lines.push(['Message', m.excerpt]); by('Désépinglé par'); break;
    case 'chat.deleted': title = 'Message supprimé'; icon = 'message-square-x'; tone = 'bad'; who('Auteur du message'); if (m.excerpt) lines.push(['Message', m.excerpt]); by('Supprimé par'); break;
    case 'setting.changed': title = 'Paramètre modifié'; icon = 'settings'; tone = 'wait'; lines.push(['Paramètre', SETTINGS[target] || target]); if (o.text !== undefined || n.text !== undefined) { lines.push(['Ancienne valeur', o.text || '—']); lines.push(['Nouvelle valeur', n.text || '—']); } by('Modifié par'); break;
    default: title = 'Opération enregistrée'; who('Concerné'); by();
  }
  lines.push(['Date', fmtDate(l.created_at)]);
  return {title, icon, tone, badge, lines, category: category(l), when: l.created_at, actor, target, text: [title, actor, target].join(' ').toLowerCase()};
}

export function render(l) {
  const d = describe(l);
  return `<article class="audit-item ${d.tone}" data-cat="${d.category}"><span class="audit-ico"><i data-lucide="${d.icon}"></i></span><div class="audit-main"><header><strong>${esc(d.title)}</strong>${d.badge ? `<span class="chip ${esc(d.badge)}">${esc({...APP_STATUS, published:'Publié', draft:'Brouillon'}[d.badge] || d.badge)}</span>` : ''}</header><dl>${d.lines.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div></article>`;
}
/* Version compacte (tableau de bord) */
export function renderCompact(l) {
  const d = describe(l), rel = timeAgo(l.created_at);
  const detail = d.target ? `${esc(d.target)}` : '';
  return `<div class="row act-row ${d.tone}"><span class="act-ico"><i data-lucide="${d.icon}"></i></span><div class="who"><strong>${esc(d.title)}</strong><small>${esc(d.actor)}${detail ? ' → ' + detail : ''}${d.badge ? '' : ''}</small></div><span class="meta" title="${esc(fmtDate(l.created_at))}">${esc(rel)}</span></div>`;
}
export function timeAgo(d) {
  const s = Math.max(0, (Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'À l’instant'; if (s < 3600) return `Il y a ${Math.floor(s / 60)} min`; if (s < 86400) return `Il y a ${Math.floor(s / 3600)} h`;
  if (s < 604800) return `Il y a ${Math.floor(s / 86400)} j`; return new Date(d).toLocaleDateString('fr-FR', {day:'numeric', month:'short', year:'numeric'});
}

export const ACTIONS = ['application.status','application.received','application.resubmitted','application.self_updated','application.updated','application.deleted','member.added','member.changed','member.removed','team.added','team.changed','team.removed','role.assigned','role.changed','role.deleted','permissions.changed','account.updated','event.created','event.updated','event.published','event.unpublished','event.deleted','photo.added','photo.removed','chat.pinned','chat.unpinned','chat.deleted','setting.changed'];
export const CAT_PATTERNS = {volunteers:['application.'], members:['member.','team.'], roles:['role.','permissions.','account.'], events:['event.','photo.'], chat:['chat.'], settings:['setting.']};
/** Clés d'action dont le titre lisible contient le texte saisi (recherche par type d'action) */
export function actionsMatching(q) { q = q.toLowerCase(); return ACTIONS.filter(a => describe({action:a, created_at:new Date().toISOString()}).title.toLowerCase().includes(q)); }
