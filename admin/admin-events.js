/* Annonces & événements : formulaire enrichi (description complète, image principale, galerie), aperçu, publication, suppression. */
export function init(ctx) {
  const {db, $, esc, icons, toast, ok, fail, busy, dialog, askConfirm, dateFr, chip, skeleton, empty, query} = ctx;
  const BUCKET = 'club-media', MAX = 5 * 1024 * 1024, MAX_PHOTOS = 12, TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const form = $('#eventForm');
  let cover = {url: '', path: '', file: null, objectUrl: '', removed: false};
  let gallery = [];            // {id?, url, path, file?, objectUrl?}
  let removedImages = [];      // lignes event_images à supprimer à l'enregistrement
  let editingStatusBefore = null, existingPublishedAt = null;

  const slug = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.random().toString(36).slice(2, 7);
  const extOf = t => t === 'image/png' ? 'png' : t === 'image/webp' ? 'webp' : 'jpg';
  const pathFromUrl = u => { const m = String(u || '').match(/\/club-media\/(.+)$/); return m ? decodeURIComponent(m[1].split('?')[0]) : ''; };
  const msg = (t, good) => { const el = $('#eventStatus'); el.textContent = t; el.className = 'wide form-msg ' + (t ? (good ? 'ok' : 'err') : ''); };
  const paragraphs = t => String(t || '').split(/\n{2,}/).map(x => x.trim()).filter(Boolean).map(x => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');

  function checkFile(f) {
    if (!TYPES.includes(f.type)) return `« ${f.name} » : format non autorisé (JPG, PNG ou WebP).`;
    if (f.size > MAX) return `« ${f.name} » dépasse 5 Mo.`;
    return '';
  }
  function paintMedia() {
    $('#coverPreview').innerHTML = (cover.objectUrl || cover.url) && !cover.removed ? `<div class="media-item"><img src="${esc(cover.objectUrl || cover.url)}" alt=""><button type="button" class="rm" data-rm-cover aria-label="Retirer l’image principale">×</button><span class="tag">Principale</span></div>` : '';
    $('#galleryPreview').innerHTML = gallery.map((g, i) => `<div class="media-item"><img src="${esc(g.objectUrl || g.url)}" alt=""><button type="button" class="rm" data-rm="${i}" aria-label="Retirer cette photo">×</button>${g.file ? '<span class="tag">Nouvelle</span>' : ''}</div>`).join('');
  }
  $('#coverFile').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const bad = checkFile(f); if (bad) { fail('Image refusée', bad); e.target.value = ''; return; }
    if (cover.objectUrl) URL.revokeObjectURL(cover.objectUrl);
    cover = {...cover, file: f, objectUrl: URL.createObjectURL(f), removed: false}; paintMedia();
  });
  $('#galleryFiles').addEventListener('change', e => {
    for (const f of e.target.files) {
      const bad = checkFile(f); if (bad) { fail('Photo refusée', bad); continue; }
      if (gallery.length >= MAX_PHOTOS) { fail('Limite atteinte', `${MAX_PHOTOS} photos maximum.`); break; }
      gallery.push({file: f, objectUrl: URL.createObjectURL(f)});
    }
    e.target.value = ''; paintMedia();
  });
  $('#coverPreview').addEventListener('click', e => { if (e.target.closest('[data-rm-cover]')) { cover.removed = true; cover.file = null; if (cover.objectUrl) URL.revokeObjectURL(cover.objectUrl); cover.objectUrl = ''; paintMedia(); } });
  $('#galleryPreview').addEventListener('click', e => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    const [g] = gallery.splice(+b.dataset.rm, 1);
    if (g.id) removedImages.push(g); if (g.objectUrl) URL.revokeObjectURL(g.objectUrl); paintMedia();
  });

  function reset() {
    form.reset(); form.elements.id.value = '';
    [cover.objectUrl, ...gallery.map(g => g.objectUrl)].forEach(u => u && URL.revokeObjectURL(u));
    cover = {url: '', path: '', file: null, objectUrl: '', removed: false}; gallery = []; removedImages = []; editingStatusBefore = null; existingPublishedAt = null;
    $('#eventFormTitle').textContent = 'Ajouter une annonce / un événement à venir'; paintMedia(); msg('');
  }

  function validate() {
    const f = new FormData(form), errs = [];
    if (!String(f.get('title')).trim()) errs.push('Le titre est obligatoire.');
    if (!f.get('event_date')) errs.push('La date de l’événement est obligatoire.');
    if (!String(f.get('summary')).trim()) errs.push('L’annonce courte est obligatoire.');
    if (String(f.get('description')).trim().length < 10) errs.push('La description complète est obligatoire (10 caractères minimum).');
    return errs;
  }
  function buildPreview() {
    const f = new FormData(form), c = cover.removed ? '' : (cover.objectUrl || cover.url);
    return `<div class="preview-ann">${c ? `<img class="cv" src="${esc(c)}" alt="">` : ''}<small>${esc(f.get('category') || '')}${f.get('event_date') ? ' · ' + dateFr(f.get('event_date') + 'T12:00:00') : ''}${f.get('location') ? ' · ' + esc(f.get('location')) : ''}</small><h3>${esc(f.get('title') || 'Sans titre')}</h3><p><b>${esc(f.get('summary') || '')}</b></p><div>${paragraphs(f.get('description')) || '<em>Aucune description</em>'}</div>${gallery.length ? `<div class="gal">${gallery.map(g => `<img src="${esc(g.objectUrl || g.url)}" alt="">`).join('')}</div>` : ''}<p>${chip(f.get('status') === 'published' ? 'published' : 'draft')}</p></div>`;
  }
  $('#previewEvent').onclick = () => dialog({title: 'Aperçu de l’annonce', icon: 'eye', body: buildPreview(), confirm: 'Fermer', cancel: '', wide: true});

  async function upload(file, folder, uploaded) {
    const path = `${folder}/${crypto.randomUUID()}.${extOf(file.type)}`;
    const {error} = await db.storage.from(BUCKET).upload(path, file, {upsert: false, contentType: file.type});
    if (error) throw new Error(`Téléversement de « ${file.name} » impossible : ${error.message}`);
    uploaded.push(path);
    return {path, url: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl};
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const errs = validate(); if (errs.length) { msg(errs.join(' ')); fail('Formulaire incomplet', errs[0]); return; }
    const f = new FormData(form), id = f.get('id') || null, title = String(f.get('title')).trim(), uploaded = [];
    await busy(form.querySelector('[type=submit]'), async () => {
      try {
        const eventId = id || crypto.randomUUID(), folder = `events/${eventId}`;
        let coverUrl = cover.removed ? null : (cover.url || null);
        if (cover.file) coverUrl = (await upload(cover.file, folder, uploaded)).url;
        const status = f.get('status'), pubDate = f.get('published_date');
        const published_at = status !== 'published' ? null : pubDate ? new Date(pubDate + 'T12:00:00').toISOString() : (existingPublishedAt || new Date().toISOString());
        const payload = {title, event_date: f.get('event_date'), location: f.get('location') || null, category: f.get('category'), summary: String(f.get('summary')).trim(), description: String(f.get('description')).trim(), cover_image: coverUrl, status, date_type: 'actual', published_at};
        const {data: saved, error} = id
          ? await db.from('events').update(payload).eq('id', id).select('id')
          : await db.from('events').insert({...payload, id: eventId, slug: slug(title)}).select('id');
        if (error) throw error;
        if (!saved?.length) throw new Error('L’annonce n’a pas été enregistrée (accès refusé).');
        // photos de la galerie
        let order = gallery.filter(g => g.id).length;
        const rows = [];
        for (const g of gallery.filter(x => x.file)) { const up = await upload(g.file, folder, uploaded); rows.push({event_id: eventId, image_url: up.url, storage_path: up.path, alt_text: title, sort_order: order++}); }
        if (rows.length) { const {error: ie} = await db.from('event_images').insert(rows); if (ie) throw ie; }
        if (removedImages.length) {
          const {error: de} = await db.from('event_images').delete().in('id', removedImages.map(r => r.id)); if (de) throw de;
          const paths = removedImages.map(r => r.path || pathFromUrl(r.url)).filter(Boolean); if (paths.length) await db.storage.from(BUCKET).remove(paths);
        }
        ok(id ? 'Annonce mise à jour' : 'Annonce créée', title + (status === 'published' ? ' — publiée sur le site.' : ' — enregistrée en brouillon.'));
        reset(); await load();
      } catch (err) {
        if (uploaded.length) await db.storage.from(BUCKET).remove(uploaded);   // pas de fichiers orphelins après un échec
        msg('Erreur : ' + err.message); fail('Enregistrement impossible', err.message);
      }
    });
  });
  $('#resetEvent').onclick = () => { reset(); toast('info', 'Formulaire réinitialisé', '', 1500); };
  $('#refreshEvents').onclick = e => busy(e.currentTarget, async () => { await load(); ok('Annonces actualisées'); });

  $('#eventsList').addEventListener('click', async e => {
    const edit = e.target.closest('[data-event-edit]'), del = e.target.closest('[data-event-delete]');
    try {
      if (edit) await busy(edit, async () => {
        const {data: ev, error} = await db.from('events').select('*').eq('id', edit.dataset.eventEdit).single(); if (error) throw error;
        const {data: imgs, error: ie} = await db.from('event_images').select('*').eq('event_id', ev.id).order('sort_order'); if (ie) throw ie;
        reset();
        for (const k of ['id', 'title', 'event_date', 'location', 'category', 'summary', 'description', 'status']) form.elements.namedItem(k).value = ev[k] ?? '';
        form.elements.published_date.value = ev.published_at ? ev.published_at.slice(0, 10) : '';
        existingPublishedAt = ev.published_at; editingStatusBefore = ev.status;
        cover = {url: ev.cover_image || '', path: pathFromUrl(ev.cover_image), file: null, objectUrl: '', removed: false};
        gallery = (imgs || []).map(i => ({id: i.id, url: i.image_url, path: i.storage_path || pathFromUrl(i.image_url)}));
        paintMedia(); $('#eventFormTitle').textContent = 'Modifier l’annonce'; $('#eventFormPanel').scrollIntoView({behavior: 'smooth'});
        toast('info', 'Mode modification', 'L’annonce est chargée dans le formulaire.', 2200);
      });
      if (del) {
        if (!await askConfirm('Supprimer cette annonce ?', `« ${esc(del.dataset.name)} » et ses photos seront supprimées définitivement.`, 'Supprimer')) return;
        await busy(del, async () => {
          const id = del.dataset.eventDelete;
          const {data: imgs} = await db.from('event_images').select('storage_path,image_url').eq('event_id', id);
          const {data: ev} = await db.from('events').select('cover_image').eq('id', id).maybeSingle();
          const {data: gone, error} = await db.from('events').delete().eq('id', id).select('id');
          if (error) throw error; if (!gone?.length) throw new Error('Suppression refusée.');
          const paths = [...(imgs || []).map(i => i.storage_path || pathFromUrl(i.image_url)), pathFromUrl(ev?.cover_image)].filter(Boolean);
          if (paths.length) await db.storage.from(BUCKET).remove(paths);
          ok('Annonce supprimée', del.dataset.name); if (form.elements.id.value === id) reset(); await load();
        });
      }
    } catch (err) { fail('Action impossible', err.message); }
  });

  async function load() {
    const host = $('#eventsList'); host.innerHTML = skeleton(3);
    try {
      const rows = await query('events', 'id,slug,title,event_date,category,location,status,cover_image', {order: 'event_date'});
      host.innerHTML = rows.length ? rows.map(x => `<div class="row thumb"><img src="${esc(x.cover_image || '../assets/branding/club-solidarite-logo.png')}" alt=""><div class="who"><strong>${esc(x.title)}</strong><small>${x.event_date ? dateFr(x.event_date + 'T12:00:00') : 'Date à définir'} · ${esc(x.category)}${x.location ? ' · ' + esc(x.location) : ''}</small></div>${chip(x.status)}<div class="acts">${x.status === 'published' ? `<a class="icon-btn" href="../annonce.html?e=${encodeURIComponent(x.slug)}" target="_blank" rel="noopener" title="Voir sur le site" aria-label="Voir sur le site"><i data-lucide="external-link"></i></a>` : ''}<button class="icon-btn" data-event-edit="${esc(x.id)}" title="Modifier" aria-label="Modifier" type="button"><i data-lucide="pencil"></i></button><button class="icon-btn danger" data-event-delete="${esc(x.id)}" data-name="${esc(x.title)}" title="Supprimer" aria-label="Supprimer" type="button"><i data-lucide="trash-2"></i></button></div></div>`).join('') : empty('calendar-x', 'Aucune annonce. Ajoutez-en une ci-dessus.');
    } catch (e) { host.innerHTML = empty('alert-circle', 'Chargement impossible.'); fail('Annonces indisponibles', e.message); }
    icons();
  }
  return {load};
}
