/* Chat du club : envoi, modification, suppression, temps réel et indicateur « est en train d'écrire ».
   Les permissions sont appliquées par la base (RLS + déclencheur chat_messages_guard) ; l'interface ne fait que les refléter. */
export function init(ctx) {
  const {db, session, can, $, esc, icons, toast, fail, busy, askConfirm, dateFr, empty} = ctx;
  const uid = session.user.id, CHANNEL = 'club-chat', TYPING_TTL = 5000, TYPING_REFRESH = 2000, TYPING_IDLE = 3000;
  const host = $('#chatMessages'), form = $('#chatForm'), input = form.elements.message, indicator = $('#typingIndicator');
  const canModerate = can('chat_moderate'), canPin = ['super_admin', 'admin'].includes(ctx.access.role_key);   // l'interface reflète la règle ; chat_set_pin() la vérifie côté base
  const COLS = 'id,user_id,author_name,message,created_at,edited_at,pinned_at,pinned_by';
  let messages = new Map(), editingId = null, dbChannel = null, typingChannel = null, typingReady = false;
  let pollTimer = null, sweepTimer = null, idleTimer = null, lastSent = 0, iAmTyping = false;
  const typers = new Map();   // user_id -> {name, ts}

  const signature = () => [...messages.values()].map(m => m.id + ':' + (m.edited_at || '') + ':' + (m.pinned_at || '')).join('|');
  const time = d => new Date(d).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
  const firstName = n => String(n || 'Un membre').trim().split(/\s+/)[0] || 'Un membre';

  function render(keepScroll = false) {
    const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 80;
    const list = [...messages.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    host.innerHTML = list.map(m => {
      const mine = m.user_id === uid, isEdit = editingId === m.id;
      const items = [];
      if (mine) items.push(`<button type="button" role="menuitem" data-act="edit" data-id="${esc(m.id)}"><i data-lucide="pencil"></i> Modifier</button>`);
      if (canPin) items.push(`<button type="button" role="menuitem" data-act="${m.pinned_at ? 'unpin' : 'pin'}" data-id="${esc(m.id)}"><i data-lucide="${m.pinned_at ? 'pin-off' : 'pin'}"></i> ${m.pinned_at ? 'Désépingler le message' : 'Épingler le message'}</button>`);
      if (mine || canModerate) items.push(`<button type="button" role="menuitem" class="del" data-act="delete" data-id="${esc(m.id)}"><i data-lucide="trash-2"></i> Supprimer</button>`);
      const acts = !isEdit && items.length ? `<span class="msg-acts"><button type="button" class="menu-btn" data-act="menu" aria-haspopup="menu" aria-label="Actions du message" aria-expanded="false">⋯</button><div class="msg-menu" role="menu" hidden>${items.join('')}</div></span>` : '';
      const body = isEdit
        ? `<div class="chat-edit"><textarea rows="2" maxlength="2000" aria-label="Modifier le message">${esc(m.message)}</textarea><small class="form-msg err" data-edit-err></small><div class="acts"><button type="button" class="btn ghost sm" data-act="cancel">Annuler</button><button type="button" class="btn sm" data-act="save" data-id="${esc(m.id)}">Enregistrer</button></div></div>`
        : `<p>${esc(m.message)}</p>`;
      return `<div class="chat-message ${mine ? 'mine' : ''} ${m.pinned_at ? 'pinned' : ''}" data-msg="${esc(m.id)}"><div class="head"><strong>${m.pinned_at ? '<i data-lucide="pin" class="pin-ico" title="Message épinglé"></i> ' : ''}${esc(m.author_name || 'Membre du club')}</strong>${acts}</div>${body}<small>${dateFr(m.created_at)} · ${time(m.created_at)}</small>${m.edited_at ? ' <span class="edited">· Modifié</span>' : ''}</div>`;
    }).join('') || empty('message-circle', 'Aucun message. Lancez la conversation.');
    if (!keepScroll || atBottom) host.scrollTop = host.scrollHeight;
    renderPinned();
    if (isEditing()) { const t = host.querySelector('.chat-edit textarea'); t?.focus(); t?.setSelectionRange(t.value.length, t.value.length); }
    icons();
  }
  const isEditing = () => editingId !== null;
  function renderPinned() {
    const pins = [...messages.values()].filter(m => m.pinned_at).sort((a, b) => new Date(b.pinned_at) - new Date(a.pinned_at)), box = $('#pinnedBox');
    box.hidden = !pins.length; if (!pins.length) return;
    $('#pinnedTitle').textContent = pins.length > 1 ? `Messages épinglés (${pins.length})` : 'Message épinglé';
    $('#pinnedList').innerHTML = pins.map(m => `<button type="button" class="pinned-item" data-jump="${esc(m.id)}"><strong>${esc(m.author_name || 'Membre du club')}</strong><span>${esc(m.message)}</span><small>${dateFr(m.created_at)}</small></button>`).join('');
  }
  $('#pinnedToggle').addEventListener('click', e => { const l = $('#pinnedList'), open = l.hidden; l.hidden = !open; e.currentTarget.setAttribute('aria-expanded', String(open)); });
  $('#pinnedList').addEventListener('click', e => { const b = e.target.closest('[data-jump]'); if (!b) return; const el = host.querySelector(`[data-msg="${b.dataset.jump}"]`); el?.scrollIntoView({block: 'center', behavior: 'smooth'}); el?.classList.add('flash'); setTimeout(() => el?.classList.remove('flash'), 1600); });
  const closeMenus = () => host.querySelectorAll('.msg-menu').forEach(x => { x.hidden = true; x.previousElementSibling?.setAttribute('aria-expanded', 'false'); });
  document.addEventListener('click', e => { if (!e.target.closest('.msg-acts')) closeMenus(); });

  async function fetchAll(silent) {
    const {data, error} = await db.from('chat_messages').select(COLS).order('created_at', {ascending:false}).limit(500);
    if (error) { host.innerHTML = empty('alert-circle', 'Le chat est indisponible.'); if (!silent) fail('Chat indisponible', error.message); return; }
    const before = signature();
    const fresh = new Map(data.reverse().map(m => [m.id, m]));
    if (silent && editingId && fresh.has(editingId)) { /* ne pas écraser une modification en cours */ }
    messages = fresh;
    if (!silent || signature() !== before) render(silent);
  }

  /* ---- Envoi ---- */
  async function onSend(e) {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    await busy(form.querySelector('button'), async () => {
      const {data, error} = await db.from('chat_messages').insert({user_id: uid, author_name: ctx.getName(), message: text}).select(COLS).single();
      if (error) { fail('Message non envoyé', error.message); return; }
      input.value = ''; stopTyping(); messages.set(data.id, data); render(); toast('success', 'Message envoyé', '', 1200);
    });
  }

  /* ---- Modifier / supprimer ---- */
  async function onClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'menu') { const menu = b.nextElementSibling, open = menu.hidden; closeMenus(); menu.hidden = !open; b.setAttribute('aria-expanded', String(open)); icons(); return; }
    closeMenus();
    if (act === 'pin' || act === 'unpin') {
      await busy(b, async () => {
        const {data, error} = await db.rpc('chat_set_pin', {p_id: id, p_pin: act === 'pin'});
        if (error) { fail('Action refusée', error.message); return; }
        const m = messages.get(id); if (m) { m.pinned_at = data.pinned ? new Date().toISOString() : null; m.pinned_by = data.pinned ? uid : null; }
        render(true); toast('success', act === 'pin' ? 'Message épinglé' : 'Message désépinglé', '', 1600);
      });
      return;
    }
    if (act === 'edit') { editingId = id; render(true); return; }
    if (act === 'cancel') { editingId = null; render(true); return; }
    if (act === 'save') {
      const box = b.closest('.chat-edit'), text = box.querySelector('textarea').value.trim(), err = box.querySelector('[data-edit-err]');
      if (!text) { err.textContent = 'Un message ne peut pas être vide.'; return; }
      if (text === messages.get(id)?.message) { editingId = null; render(true); return; }
      await busy(b, async () => {
        const {data, error} = await db.from('chat_messages').update({message: text}).eq('id', id).eq('user_id', uid).select(COLS);
        if (error || !data?.length) { err.textContent = error?.message || 'Modification refusée : vous ne pouvez modifier que vos propres messages.'; return; }
        messages.set(id, data[0]); editingId = null; render(true); toast('success', 'Message modifié', '', 1500);
      });
    }
    if (act === 'delete') {
      const m = messages.get(id); if (!m) return;
      if (!await askConfirm('Supprimer ce message ?', 'Il sera supprimé définitivement pour tous les membres.', 'Supprimer')) return;
      await busy(b, async () => {
        const {data, error} = await db.from('chat_messages').delete().eq('id', id).select('id');
        if (error || !data?.length) { fail('Suppression impossible', error?.message || 'Vous n’avez pas le droit de supprimer ce message.'); return; }
        messages.delete(id); if (editingId === id) editingId = null; render(true); toast('success', 'Message supprimé', '', 1500);
      });
    }
  }

  /* ---- Temps réel : messages (postgres_changes, filtré par RLS) ---- */
  function subscribeMessages() {
    dbChannel = db.channel('club-chat-db')
      .on('postgres_changes', {event: '*', schema: 'public', table: 'chat_messages'}, payload => {
        if (payload.eventType === 'DELETE') { messages.delete(payload.old.id); if (editingId === payload.old.id) editingId = null; }
        else { const m = payload.new; if (editingId === m.id && m.user_id !== uid) editingId = null; messages.set(m.id, m); }
        render(true);
      }).subscribe();
  }

  /* ---- Indicateur de saisie : Broadcast sur un canal PRIVÉ (autorisé par RLS realtime.messages), aucune écriture en base ---- */
  async function subscribeTyping() {
    try { await db.realtime.setAuth(); } catch { /* version du client sans setAuth explicite */ }
    typingChannel = db.channel(CHANNEL, {config: {private: true, broadcast: {self: false}}});
    typingChannel.on('broadcast', {event: 'typing'}, ({payload}) => {
      if (!payload || payload.user_id === uid) return;
      typers.set(payload.user_id, {name: firstName(payload.name), ts: Date.now()}); paintTyping();
    }).on('broadcast', {event: 'stop'}, ({payload}) => { if (payload) typers.delete(payload.user_id); paintTyping(); })
      .subscribe(status => {
        typingReady = status === 'SUBSCRIBED';
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('Indicateur de saisie indisponible (canal privé non autorisé — migration v3 ?)');
      });
  }
  function paintTyping() {
    const now = Date.now();
    for (const [k, v] of typers) if (now - v.ts > TYPING_TTL) typers.delete(k);   // expiration : jamais d'indicateur fantôme
    const names = [...typers.values()].map(v => v.name);
    if (!names.length) { indicator.hidden = true; indicator.innerHTML = ''; return; }
    const txt = names.length === 1 ? `${esc(names[0])} est en train d’écrire…`
      : names.length === 2 ? `${esc(names[0])} et ${esc(names[1])} sont en train d’écrire…`
      : `${names.length} personnes sont en train d’écrire…`;
    indicator.innerHTML = `<span class="typing-dots"><i></i><i></i><i></i></span><span>${txt}</span>`; indicator.hidden = false;
  }
  const send = (event) => { if (typingReady) typingChannel.send({type: 'broadcast', event, payload: {user_id: uid, name: ctx.getName()}}); };
  function stopTyping() { clearTimeout(idleTimer); if (iAmTyping) { iAmTyping = false; send('stop'); } }
  function onInput() {
    if (!input.value.trim()) return stopTyping();
    const now = Date.now(); iAmTyping = true;
    if (now - lastSent > TYPING_REFRESH) { lastSent = now; send('typing'); }
    clearTimeout(idleTimer); idleTimer = setTimeout(stopTyping, TYPING_IDLE);
  }

  form.addEventListener('submit', onSend);
  host.addEventListener('click', onClick);
  input.addEventListener('input', onInput);
  input.addEventListener('blur', stopTyping);
  window.addEventListener('pagehide', () => { stopTyping(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopTyping(); });

  return {
    async load() {
      lastSent = 0; editingId = null; typers.clear(); paintTyping();
      await fetchAll(false);
      if (!dbChannel) subscribeMessages();
      if (!typingChannel) await subscribeTyping();
      clearInterval(pollTimer); clearInterval(sweepTimer);
      pollTimer = setInterval(() => { if (!editingId) fetchAll(true); }, 20000);   // filet de sécurité si le temps réel est coupé
      sweepTimer = setInterval(paintTyping, 1000);
    },
    stop() {
      stopTyping(); clearInterval(pollTimer); clearInterval(sweepTimer); typers.clear(); paintTyping();
      if (dbChannel) { db.removeChannel(dbChannel); dbChannel = null; }
      if (typingChannel) { db.removeChannel(typingChannel); typingChannel = null; typingReady = false; }
    }
  };
}
