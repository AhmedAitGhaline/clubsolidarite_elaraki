/* Tableau de bord : indicateurs, graphiques SVG, activité récente — toutes les valeurs viennent de Supabase. */
import {renderCompact} from './audit-format.js';
export function init(ctx) {
  const {db, $, $$, esc, icons, fail, canAny, can, go, dateFr, chip, empty, initials, fullName, access} = ctx;
  let stats = null, range = 12, busyLoad = false;
  const C = {blue:'#0755d9', navy:'#052c68', green:'#16a34a', amber:'#f59e0b', red:'#dc2626', sky:'#38bdf8', grid:'#e3ebf5', text:'#64748b'};
  const monthLabel = ym => new Date(ym + '-15T12:00:00').toLocaleDateString('fr-FR', {month:'short'}).replace('.', '');
  const monthFull = ym => new Date(ym + '-15T12:00:00').toLocaleDateString('fr-FR', {month:'long', year:'numeric'});
  const nice = v => { if (v <= 4) return 4; const p = 10 ** Math.floor(Math.log10(v)), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

  /* ---------- graphiques SVG ---------- */
  function frame(max, labels, W = 520, H = 230, L = 34, R = 12, T = 12, B = 28, rightMax = null) {
    const iw = W - L - R, ih = H - T - B, top = nice(max || 1);
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const y = T + ih - (ih * i / 4), v = Math.round(top * i / 4);
      g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="${C.grid}"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="${C.text}">${v}</text>`;
      if (rightMax) g += `<text x="${W - R + 2}" y="${y + 4}" font-size="10" fill="${C.green}" text-anchor="start">${Math.round(rightMax * i / 4)}</text>`;
    }
    const step = iw / labels.length, skip = labels.length > 8 ? 2 : 1;
    labels.forEach((l, i) => { if (i % skip === 0 || i === labels.length - 1) g += `<text x="${L + step * i + step / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${C.text}">${esc(l)}</text>`; });
    return {g, L, T, ih, iw, step, top, W, H};
  }
  const svg = (inner, W, H, label) => `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
  function barChart(rows, key, color, label) {
    const fr = frame(Math.max(...rows.map(r => r[key]), 1), rows.map(r => monthLabel(r.month)));
    const bw = Math.min(26, fr.step * .6);
    const bars = rows.map((r, i) => { const h = fr.ih * r[key] / fr.top, x = fr.L + fr.step * i + (fr.step - bw) / 2;
      return `<rect class="bar" x="${x}" y="${fr.T + fr.ih - h}" width="${bw}" height="${Math.max(h, r[key] ? 2 : 0)}" rx="4" fill="${color}"><title>${esc(monthFull(r.month))} : ${r[key]}</title></rect>`; }).join('');
    return svg(fr.g + bars, fr.W, fr.H, label);
  }
  function stackedChart(rows, label) {
    const fr = frame(Math.max(...rows.map(r => r.events + r.actions), 1), rows.map(r => monthLabel(r.month)));
    const bw = Math.min(26, fr.step * .6);
    const bars = rows.map((r, i) => { const x = fr.L + fr.step * i + (fr.step - bw) / 2, he = fr.ih * r.events / fr.top, ha = fr.ih * r.actions / fr.top;
      return `<rect class="bar" x="${x}" y="${fr.T + fr.ih - he}" width="${bw}" height="${he}" fill="${C.blue}" rx="3"><title>${esc(monthFull(r.month))} : ${r.events} événement(s)</title></rect><rect class="bar" x="${x}" y="${fr.T + fr.ih - he - ha}" width="${bw}" height="${ha}" fill="${C.green}" rx="3"><title>${esc(monthFull(r.month))} : ${r.actions} action(s)</title></rect>`; }).join('');
    return svg(fr.g + bars, fr.W, fr.H, label) + `<div class="legend"><span><i style="background:${C.blue}"></i>Événements</span><span><i style="background:${C.green}"></i>Actions</span></div>`;
  }
  function volunteersChart(rows, label) {
    const rmax = nice(Math.max(...rows.map(r => r.accepted_total), 1));
    const fr = frame(Math.max(...rows.map(r => r.accepted), 1), rows.map(r => monthLabel(r.month)), 520, 230, 34, 30, 12, 28, rmax);
    const bw = Math.min(22, fr.step * .55);
    const bars = rows.map((r, i) => { const h = fr.ih * r.accepted / fr.top, x = fr.L + fr.step * i + (fr.step - bw) / 2; return `<rect class="bar" x="${x}" y="${fr.T + fr.ih - h}" width="${bw}" height="${h}" rx="4" fill="${C.sky}"><title>${esc(monthFull(r.month))} : ${r.accepted} nouveau(x) bénévole(s)</title></rect>`; }).join('');
    const pts = rows.map((r, i) => [fr.L + fr.step * i + fr.step / 2, fr.T + fr.ih - fr.ih * r.accepted_total / rmax]);
    const line = `<polyline fill="none" stroke="${C.green}" stroke-width="2.5" stroke-linejoin="round" points="${pts.map(p => p.join(',')).join(' ')}"/>` + pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#fff" stroke="${C.green}" stroke-width="2"><title>${esc(monthFull(rows[i].month))} : ${rows[i].accepted_total} bénévole(s) au total</title></circle>`).join('');
    return svg(fr.g + bars + line, fr.W, fr.H, label) + `<div class="legend"><span><i style="background:${C.sky}"></i>Nouveaux bénévoles (axe gauche)</span><span><i style="background:${C.green}"></i>Total cumulé (axe droit)</span></div>`;
  }
  function donut(parts, label) {
    const total = parts.reduce((s, p) => s + p.v, 0), R = 62, r = 40, cx = 90, cy = 90;
    if (!total) return `<p class="chart-empty">Aucune candidature pour le moment.</p>`;
    let a0 = -Math.PI / 2, paths = '';
    parts.filter(p => p.v).forEach(p => {
      const a1 = a0 + (p.v / total) * Math.PI * 2 - (parts.filter(x => x.v).length > 1 ? 0.02 : 0), big = a1 - a0 > Math.PI ? 1 : 0;
      const pt = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
      if (parts.filter(x => x.v).length === 1) paths += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${p.c}" stroke-width="${R - r}"><title>${esc(p.l)} : ${p.v}</title></circle>`;
      else paths += `<path d="M${pt(R, a0)} A${R},${R} 0 ${big} 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 ${big} 0 ${pt(r, a0)}Z" fill="${p.c}"><title>${esc(p.l)} : ${p.v} (${Math.round(p.v / total * 100)} %)</title></path>`;
      a0 += (p.v / total) * Math.PI * 2;
    });
    return `<div class="donut-wrap">${svg(paths + `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="26" font-weight="800" fill="${C.navy}">${total}</text><text x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="10" fill="${C.text}">candidatures</text>`, 180, 180, label)}<ul class="donut-legend">${parts.map(p => `<li><i style="background:${p.c}"></i><span>${esc(p.l)}</span><b>${p.v}</b><small>${Math.round(p.v / total * 100)} %</small></li>`).join('')}</ul></div>`;
  }

  /* ---------- cartes ---------- */
  const delta = (cur, prev, goodWhenUp = true) => {
    if (cur == null || prev == null) return '';
    if (!prev && !cur) return '<span class="delta flat">= vs mois dernier</span>';
    if (!prev) return `<span class="delta up">+${cur} vs mois dernier</span>`;
    const p = Math.round((cur - prev) / prev * 100), cls = p === 0 ? 'flat' : (p > 0) === goodWhenUp ? 'up' : 'down';
    return `<span class="delta ${cls}">${p > 0 ? '▲ +' : p < 0 ? '▼ ' : '= '}${p}% vs mois dernier</span>`;
  };
  function card({icon, tone, title, value, sub = '', dl = '', go: target}) {
    return `<button class="stat-card ${tone}" ${target ? `data-go="${target}"` : ''} type="button"><span class="stat-ico"><i data-lucide="${icon}"></i></span><div><small>${esc(title)}</small><strong>${value}</strong>${dl}${sub ? `<em>${esc(sub)}</em>` : ''}</div></button>`;
  }
  function paintStats() {
    const v = stats?.volunteers, e = stats?.events, t = stats?.team, cards = [];
    if (v) cards.push(
      card({icon:'users', tone:'blue', title:'Bénévoles (inscriptions)', value:v.total, dl:delta(v.received_this_month, v.received_prev_month), sub:`${v.received_this_month} reçue(s) ce mois`, go:'volunteers'}),
      card({icon:'clock', tone:'amber', title:'Candidatures en attente', value:v.pending, sub: v.pending ? 'À traiter' : 'Tout est traité', go:'volunteers'}),
      card({icon:'user-check', tone:'green', title:'Bénévoles acceptés', value:v.accepted, dl:delta(v.accepted_this_month, v.accepted_prev_month), sub:`${v.accepted_this_month} accepté(s) ce mois`, go:'volunteers'}),
      card({icon:'user-x', tone:'red', title:'Candidatures refusées', value:v.rejected, dl:delta(v.rejected_this_month, v.rejected_prev_month, false), sub:`${v.rejected_this_month} refusée(s) ce mois`, go:'volunteers'}));
    if (e) cards.push(card({icon:'calendar-check', tone:'sky', title:'Actions & événements réalisés', value:e.done, dl:delta(e.done_this_month, e.done_prev_month), sub:`${e.done_events} événement(s) · ${e.done_actions} action(s)`, go:'events'}));
    if (t) cards.push(card({icon:'shield-check', tone:'navy', title:'Administrateurs · Équipe dirigeante', value:`${t.admins} <span class="sep">·</span> ${t.leaders}`, sub:`${t.admins} admin(s) dont ${t.super_admins} Super Admin`, go: can('team') ? 'team' : 'management'}));
    $('#dashStats').innerHTML = cards.join('') || empty('bar-chart-3', 'Aucun indicateur disponible pour vos permissions.');
  }
  function paintCharts() {
    const v = stats?.volunteers, e = stats?.events, slice = a => a.slice(-range);
    const put = (k, html) => { const c = $(`[data-chart="${k}"]`); if (!c) return; c.hidden = !html; if (html) c.querySelector('.chart-body').innerHTML = html; };
    put('received', v && barChart(slice(v.monthly), 'received', C.blue, 'Candidatures reçues par mois'));
    put('split', v && donut([{l:'Acceptées', v:v.accepted, c:C.green}, {l:'En attente', v:v.pending, c:C.amber}, {l:'Refusées', v:v.rejected, c:C.red}], 'Répartition des candidatures'));
    put('volunteers', v && volunteersChart(slice(v.monthly), 'Évolution des bénévoles'));
    put('activity', e && stackedChart(slice(e.monthly), 'Activité du club'));
    $('#dashCharts').hidden = !(v || e);
  }
  function paintGlobal() {
    const v = stats?.volunteers, e = stats?.events, t = stats?.team, rows = [];
    if (v) { const dec = v.accepted + v.rejected; rows.push(['Taux d’acceptation', dec ? Math.round(v.accepted / dec * 100) + ' %' : '—'], ['Candidatures traitées', `${v.accepted + v.rejected} / ${v.total}`]); }
    if (e) rows.push(['À venir', e.upcoming], ['En cours', e.ongoing], ['Brouillons', e.drafts], ['Événements réalisés', e.done_events], ['Actions réalisées', e.done_actions]);
    if (t) rows.push(['Comptes enregistrés', t.accounts], ['Membres de l’équipe dirigeante', t.leaders]);
    $('#dashGlobal').innerHTML = rows.map(([k, x]) => `<div><dt>${esc(k)}</dt><dd>${x}</dd></div>`).join('') || '<div><dt>Aucune donnée</dt></div>';
  }
  function paintShortcuts() {
    const S = [['volunteers', 'hand-heart', 'Traiter les candidatures', ['volunteers','applications']], ['events', 'calendar-plus', 'Créer une action / un événement', ['events']], ['team', 'award', 'Équipe dirigeante', ['team']], ['messages', 'messages-square', 'Ouvrir le chat', ['chat']], ['management', 'shield-check', 'Gérer les comptes', ['management']], ['settings', 'settings', 'Paramètres', ['settings']]];
    $('#dashShortcuts').innerHTML = S.filter(s => canAny(s[3])).map(([v, i, l]) => `<button class="shortcut" data-go="${v}" type="button"><i data-lucide="${i}"></i><span>${esc(l)}</span><i data-lucide="chevron-right"></i></button>`).join('');
  }

  /* ---------- listes ---------- */
  const phase = ev => { const now = Date.now(), st = new Date(`${ev.event_date}T${(ev.start_time || '00:00').slice(0, 5)}:00`).getTime(), en = new Date(`${ev.end_date || ev.event_date}T${(ev.end_time || '23:59').slice(0, 5)}:59`).getTime(); return now < st ? 'upcoming' : now <= en ? 'ongoing' : 'past'; };
  async function loadUpcoming() {
    const host = $('#dashUpcoming'); if (!can('events')) return;
    const {data, error} = await db.from('events').select('id,title,event_date,start_time,end_date,end_time,location,kind,status,is_visible').eq('status', 'published').gte('event_date', new Date(Date.now() - 864e5 * 30).toISOString().slice(0, 10)).order('event_date').limit(40);
    if (error) { host.innerHTML = empty('alert-circle', 'Chargement impossible.'); return; }
    const list = data.filter(x => phase(x) !== 'past').slice(0, 5);
    host.innerHTML = list.length ? list.map(x => { const d = new Date(x.event_date + 'T12:00:00'); return `<div class="row ev-row"><span class="date-badge"><b>${d.getDate()}</b><small>${d.toLocaleDateString('fr-FR', {month:'short'}).replace('.', '')}</small></span><div class="who"><strong>${esc(x.title)}</strong><small>${x.kind === 'action' ? 'Action' : 'Événement'}${x.start_time ? ' · ' + x.start_time.slice(0, 5) : ''}${x.location ? ' · ' + esc(x.location) : ''}</small></div>${phase(x) === 'ongoing' ? '<span class="chip ongoing">En cours</span>' : ''}${x.is_visible ? '' : '<span class="chip draft">Masqué</span>'}</div>`; }).join('') : empty('calendar-x', 'Aucun événement à venir.');
  }
  async function loadApps() {
    const host = $('#dashboardApplications'); if (!canAny(['volunteers', 'applications'])) return;
    const {data, error} = await db.from('applications').select('id,first_name,last_name,class_name,status,submitted_at').order('submitted_at', {ascending:false}).limit(5);
    if (error) { host.innerHTML = empty('alert-circle', 'Chargement impossible.'); return; }
    host.innerHTML = data.length ? data.map(a => `<div class="row"><span class="avatar">${esc(initials(a.first_name, a.last_name))}</span><div class="who"><strong>${esc(fullName(a))}</strong><small>${esc(a.class_name)}</small></div><span class="meta">${dateFr(a.submitted_at)}</span>${chip(a.status || 'pending')}</div>`).join('') : empty('inbox', 'Aucune candidature pour le moment.');
  }
  async function loadActivity() {
    const host = $('#dashActivity');
    const {data, error} = await db.from('activity_logs').select('*').order('created_at', {ascending:false}).limit(10);
    if (error) { host.innerHTML = empty('alert-circle', 'Chargement impossible.'); return; }
    host.innerHTML = data.length ? data.map(renderCompact).join('') : empty('activity', 'Aucune activité enregistrée pour le moment.');
  }

  $('#dashRange').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; range = +b.dataset.m; $$('#dashRange button').forEach(x => x.classList.toggle('on', x === b)); paintCharts(); icons(); });
  $('#dashRefresh').onclick = e => ctx.busy(e.currentTarget, async () => { await load(); ctx.ok('Tableau de bord actualisé'); });

  async function load() {
    if (busyLoad) return; busyLoad = true;
    const name = (ctx.getName() || '').split(' ')[0];
    $('#dashHello').textContent = name ? `Bonjour, ${name}` : 'Bienvenue';
    { const d = new Date().toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long', year:'numeric'}); $('#dashDate').textContent = d.charAt(0).toUpperCase() + d.slice(1) + ' · ' + access.role_label; }
    paintShortcuts();
    try {
      const {data, error} = await db.rpc('admin_dashboard_stats'); if (error) throw error;
      stats = data; paintStats(); paintCharts(); paintGlobal();
      if (stats.volunteers) ctx.setPending(stats.volunteers.pending);
    } catch (e) { $('#dashStats').innerHTML = empty('alert-circle', 'Statistiques indisponibles.'); fail('Statistiques indisponibles', e.message + ' — la migration v4 est-elle appliquée ?'); }
    await Promise.all([loadActivity(), loadUpcoming(), loadApps()]);
    icons(); busyLoad = false;
  }
  return {load};
}
