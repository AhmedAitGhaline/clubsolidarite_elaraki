/* Équipe dirigeante : fonctions libres associées à des comptes existants (indépendant des rôles d'administration). */
export function init(ctx) {
  const {db, $, esc, icons, ok, fail, busy, askConfirm, skeleton, empty, initials} = ctx;
  const form = $('#teamForm'); let profiles = [], team = [];
  const label = p => `${p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email} — ${p.email}`;
  const msg = (t, good) => { const el = $('#teamStatus'); el.textContent = t; el.className = 'wide form-msg ' + (t ? (good ? 'ok' : 'err') : ''); };

  function fillSelect(selected = '') {
    const q = $('#teamFind').value.trim().toLowerCase(), sel = $('#teamUser');
    const list = profiles.filter(p => !q || label(p).toLowerCase().includes(q) || p.id === selected);
    sel.innerHTML = '<option value="">— Choisir un compte —</option>' + list.map(p => `<option value="${esc(p.id)}">${esc(label(p))}</option>`).join('');
    sel.value = selected || ''; syncEmail();
  }
  function syncEmail() { const p = profiles.find(x => x.id === $('#teamUser').value); form.elements.email.value = p?.email || ''; }
  $('#teamFind').addEventListener('input', () => fillSelect($('#teamUser').value));
  $('#teamUser').addEventListener('change', syncEmail);
  function reset() { form.reset(); form.elements.id.value = ''; $('#teamFind').value = ''; fillSelect(); $('#teamFormTitle').textContent = 'Ajouter un membre à l’équipe dirigeante'; msg(''); }
  $('#resetTeam').onclick = reset;
  $('#refreshTeam').onclick = e => busy(e.currentTarget, async () => { await load(); ok('Équipe actualisée'); });
  $('#teamSearch').addEventListener('input', paint);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(form), id = f.get('id') || null, user_id = f.get('user_id'), fn = String(f.get('function_title') || '').trim();
    if (!user_id) { msg('Sélectionnez un compte existant : la personne doit d’abord disposer d’un compte enregistré.'); return; }
    if (!fn) { msg('La fonction est obligatoire.'); return; }
    const payload = {user_id, function_title: fn, display_order: Math.max(0, parseInt(f.get('display_order'), 10) || 0), description: String(f.get('description') || '').trim() || null};
    await busy(form.querySelector('[type=submit]'), async () => {
      try {
        const {data, error} = id ? await db.from('club_team').update(payload).eq('id', id).select('id') : await db.from('club_team').insert(payload).select('id');
        if (error) throw error.code === '23505' ? new Error('Cette personne occupe déjà cette fonction.') : error;
        if (!data?.length) throw new Error('Enregistrement refusé.');
        ok(id ? 'Fonction modifiée' : 'Membre ajouté', fn); reset(); await load();
      } catch (err) { msg('Erreur : ' + err.message); fail('Enregistrement impossible', err.message); }
    });
  });

  function paint() {
    const q = $('#teamSearch').value.trim().toLowerCase();
    const list = team.filter(t => !q || [t.function_title, t.profiles?.full_name, t.profiles?.email].join(' ').toLowerCase().includes(q));
    $('#teamTotal').textContent = team.length;
    $('#teamList').innerHTML = list.map(t => { const p = t.profiles || {}; return `<div class="row"><span class="avatar">${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : esc(initials(p.first_name, p.last_name))}</span><div class="who"><strong>${esc(p.full_name || p.email || 'Compte')}</strong><small>${esc(t.function_title)} · ${esc(p.email || '')}</small></div><span class="meta">Ordre ${t.display_order}</span><div class="acts"><button class="icon-btn" data-team-edit="${esc(t.id)}" title="Modifier" aria-label="Modifier" type="button"><i data-lucide="pencil"></i></button><button class="icon-btn danger" data-team-del="${esc(t.id)}" title="Retirer de l’équipe" aria-label="Retirer de l’équipe" type="button"><i data-lucide="user-minus"></i></button></div></div>`; }).join('') || empty('award', q ? 'Aucun résultat.' : 'Aucun membre dans l’équipe dirigeante.');
    icons();
  }
  $('#teamList').addEventListener('click', async e => {
    const ed = e.target.closest('[data-team-edit]'), del = e.target.closest('[data-team-del]');
    if (ed) { const t = team.find(x => x.id === ed.dataset.teamEdit); if (!t) return;
      form.elements.id.value = t.id; form.elements.function_title.value = t.function_title; form.elements.display_order.value = t.display_order; form.elements.description.value = t.description || '';
      $('#teamFind').value = ''; fillSelect(t.user_id); $('#teamFormTitle').textContent = 'Modifier la fonction'; $('#teamFormPanel').scrollIntoView({behavior: 'smooth'}); }
    if (del) { const t = team.find(x => x.id === del.dataset.teamDel); if (!t) return;
      if (!await askConfirm('Retirer de l’équipe ?', `<b>${esc(t.profiles?.full_name || 'Ce membre')}</b> ne sera plus « ${esc(t.function_title)} ». Son compte et ses autres droits ne sont pas modifiés.`, 'Retirer', 'bad', 'user-minus')) return;
      await busy(del, async () => { const {data, error} = await db.from('club_team').delete().eq('id', t.id).select('id');
        if (error || !data?.length) return fail('Action impossible', error?.message || 'Suppression refusée.'); ok('Membre retiré de l’équipe', t.function_title); await load(); });
    }
  });

  async function load() {
    $('#teamList').innerHTML = skeleton(3);
    const [p, t] = await Promise.all([
      db.from('profiles').select('id,full_name,first_name,last_name,email,avatar_url').order('full_name'),
      db.from('club_team').select('id,user_id,function_title,description,display_order,profiles(full_name,first_name,last_name,email,avatar_url)').order('display_order').order('created_at')
    ]);
    if (p.error || t.error) { $('#teamList').innerHTML = empty('alert-circle', 'Chargement impossible.'); return fail('Équipe indisponible', (p.error || t.error).message); }
    profiles = p.data || []; team = t.data || []; fillSelect($('#teamUser').value); paint();
  }
  return {load};
}
