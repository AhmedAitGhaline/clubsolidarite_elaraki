/* Section « Bénévoles » : toutes les candidatures, recherche, filtres, tri, détail, statut, note interne. */
export function init(ctx) {
  const {db, $, esc, icons, ok, fail, busy, dialog, askConfirm, dateFr, chip, empty, skeleton} = ctx;
  const PAGE = 15; let rows = [], page = 1;
  const name = a => `${a.first_name || ''} ${a.last_name || ''}`.trim() || '—';
  const level = a => [a.grade_level, a.track, a.class_number && 'classe ' + a.class_number].filter(Boolean).join(' · ') || a.class_name || '—';
  const areasOf = a => a.interest_area ? [a.interest_area] : [];

  function filtered() {
    const q = $('#volSearch').value.trim().toLowerCase(), st = $('#volStatus').value, gr = $('#volGrade').value, dir = $('#volSort').value;
    const list = rows.filter(a => (!st || a.status === st) && (!gr || (a.grade_level || a.class_name || '').includes(gr))
      && (!q || [name(a), a.email, level(a), a.phone, a.interest_area].join(' ').toLowerCase().includes(q)));
    return list.sort((x, y) => (new Date(x.submitted_at) - new Date(y.submitted_at)) * (dir === 'asc' ? 1 : -1));
  }
  function paint() {
    const list = filtered(), pages = Math.max(1, Math.ceil(list.length / PAGE)); page = Math.min(page, pages);
    $('#volTotal').textContent = rows.length;
    $('#volBody').innerHTML = list.slice((page - 1) * PAGE, page * PAGE).map(a => `<tr><td class="cell-name"><strong>${esc(name(a))}</strong><small>${esc(a.email)}${a.phone ? ' · ' + esc(a.phone) : ''}</small></td><td>${esc(level(a))}</td><td class="clip" title="${esc(a.interest_area || '')}">${esc(a.interest_area || '—')}</td><td class="nowrap">${dateFr(a.submitted_at)}</td><td>${chip(a.status)}</td><td class="r"><button class="btn ghost sm" data-vol="detail" data-id="${esc(a.id)}" type="button"><i data-lucide="eye"></i> Voir</button> <button class="icon-btn danger" data-vol="delete" data-id="${esc(a.id)}" title="Supprimer la candidature" aria-label="Supprimer la candidature" type="button"><i data-lucide="trash-2"></i></button> ${a.status === 'pending' ? `<button class="btn good sm" data-vol="accepted" data-id="${esc(a.id)}" type="button">Accepter</button> <button class="btn bad sm" data-vol="rejected" data-id="${esc(a.id)}" type="button">Refuser</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="6" class="empty-cell">Aucune candidature ne correspond.</td></tr>`;
    $('#volPager').innerHTML = `<span>${list.length} résultat(s)</span><span class="pg"><button class="btn ghost sm" data-pg="-1" ${page <= 1 ? 'disabled' : ''} type="button">Précédent</button><span style="align-self:center">${page} / ${pages}</span><button class="btn ghost sm" data-pg="1" ${page >= pages ? 'disabled' : ''} type="button">Suivant</button></span>`;
    icons();
  }
  async function load() {
    $('#volBody').innerHTML = `<tr><td colspan="6">${skeleton(3)}</td></tr>`;
    const {data, error} = await db.from('applications').select('*').order('submitted_at', {ascending: false});
    if (error) { $('#volBody').innerHTML = `<tr><td colspan="6" class="empty-cell">Chargement impossible.</td></tr>`; fail('Bénévoles indisponibles', error.message); return; }
    rows = data || []; paint(); ctx.refreshPending();
  }
  async function setStatus(a, status, note) {
    const patch = {status}; if (note !== undefined) patch.internal_notes = note || null;
    if (status === 'accepted') patch.rejection_reason = null;
    const {data, error} = await db.from('applications').update(patch).eq('id', a.id).select('id,status,internal_notes');
    if (error) throw error; if (!data?.length) throw new Error('Modification refusée.');
    Object.assign(a, data[0]);
  }
  async function detail(a) {
    const F = [['Nom complet', name(a)], ['E-mail institutionnel', a.email], ['Niveau scolaire', a.grade_level], ['Filière', a.track], ['Classe', a.class_number || a.class_name], ['Téléphone', a.phone], ['Motivations', a.motivation], ['Compétences', a.skills], ['Domaines d’implication', a.interest_area], ['Disponibilités', a.availability], ['Informations complémentaires', a.extra_info], ['Date de candidature', dateFr(a.submitted_at)]];
    const body = `<p style="margin:4px 0 0">${chip(a.status)}</p><div class="detail-list">${F.filter(x => x[1]).map(([k, v]) => `<section><b>${esc(k)}</b><span>${esc(v)}</span></section>`).join('')}</div>
      <div class="f-row"><label for="vdStatus">Statut</label><select id="vdStatus"><option value="pending">En attente</option><option value="accepted">Acceptée</option><option value="rejected">Refusée</option></select></div>
      <div class="f-row"><label for="vdNote">Note interne (facultatif — jamais visible par l’élève)</label><textarea id="vdNote" rows="3" maxlength="1000" style="width:100%">${esc(a.internal_notes || '')}</textarea></div>`;
    let ov; const r = await dialog({title: 'Candidature bénévole', icon: 'file-text', body, confirm: 'Enregistrer', cancel: 'Fermer', wide: true, onOpen: o => { ov = o; o.querySelector('#vdStatus').value = a.status === 'archived' ? 'pending' : a.status; }});
    if (r === null) return;
    const status = ov.querySelector('#vdStatus').value, note = ov.querySelector('#vdNote').value.trim();
    if (status === a.status && note === (a.internal_notes || '')) return;
    try { await setStatus(a, status, note); ctx.refreshPending(); ok('Candidature mise à jour', `${name(a)} : ${{pending: 'en attente', accepted: 'acceptée', rejected: 'refusée'}[status]}.`); paint(); }
    catch (e) { fail('Mise à jour impossible', e.message); }
  }
  $('#volBody').addEventListener('click', async e => {
    const b = e.target.closest('[data-vol]'); if (!b) return;
    const a = rows.find(x => x.id === b.dataset.id); if (!a) return;
    if (b.dataset.vol === 'detail') return detail(a);
    if (b.dataset.vol === 'delete') {
      if (!await askConfirm('Supprimer cette candidature ?', `La candidature de <b>${esc(name(a))}</b> sera supprimée définitivement. Cette opération sera enregistrée dans le journal d’audit.`, 'Supprimer', 'bad', 'trash-2')) return;
      await busy(b, async () => { const {data, error} = await db.from('applications').delete().eq('id', a.id).select('id');
        if (error || !data?.length) return fail('Suppression impossible', error?.message || 'Suppression refusée.');
        rows = rows.filter(x => x.id !== a.id); ok('Candidature supprimée', name(a)); paint(); ctx.refreshPending(); });
      return;
    }
    const acc = b.dataset.vol === 'accepted';
    if (!await askConfirm(acc ? 'Accepter la candidature' : 'Refuser la candidature', `<b>${esc(name(a))}</b> sera ${acc ? 'accepté(e)' : 'refusé(e)'}. Le statut sera visible dans son espace personnel.`, acc ? 'Accepter' : 'Refuser', acc ? 'good' : 'bad', acc ? 'user-check' : 'user-x')) return;
    await busy(b, async () => { try { await setStatus(a, b.dataset.vol); ok('Statut enregistré', name(a)); paint(); ctx.refreshPending(); } catch (err) { fail('Action impossible', err.message); } });
  });
  ['volSearch', 'volStatus', 'volGrade', 'volSort'].forEach(id => $('#' + id).addEventListener('input', () => { page = 1; paint(); }));
  $('#volPager').addEventListener('click', e => { const b = e.target.closest('[data-pg]'); if (b) { page += +b.dataset.pg; paint(); } });
  $('#refreshVolunteers').onclick = e => busy(e.currentTarget, async () => { await load(); ok('Bénévoles actualisés'); });
  return {load};
}
