import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { esc } from './academics.js';

const $ = s => document.querySelector(s), root = $('#annonce'), cfg = window.CLUB_CONFIG || {};
$('#year').textContent = new Date().getFullYear();
const state = (title, text) => { root.innerHTML = `<div class="annonce-state"><h1>${esc(title)}</h1><p>${esc(text)}</p><a class="button button-primary" href="index.html#evenements">Retour aux annonces</a></div>`; };
const key = new URLSearchParams(location.search).get('e');
const paragraphs = t => String(t || '').split(/\n{2,}/).map(x => x.trim()).filter(Boolean).map(x => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');

async function main() {
  if (!key) return state('Annonce introuvable', 'Aucune annonce n’a été indiquée.');
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return state('Service indisponible', 'La configuration du site est incomplète.');
  const db = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
  // Seules les annonces PUBLIÉES sont affichées (en plus de la politique RLS côté base).
  const { data: ev, error } = await db.from('events').select('id,title,summary,description,event_date,published_at,category,location,cover_image')
    .eq('status', 'published').eq(isId ? 'id' : 'slug', key).maybeSingle();
  if (error) return state('Chargement impossible', 'Une erreur est survenue. Réessayez plus tard.');
  if (!ev) return state('Annonce introuvable', 'Cette annonce n’existe pas ou n’est plus publiée.');
  const { data: imgs } = await db.from('event_images').select('image_url,alt_text,caption,sort_order').eq('event_id', ev.id).order('sort_order', { ascending: true });
  const gallery = (imgs || []).map(i => ({ src: i.image_url, alt: i.alt_text || ev.title, caption: i.caption || '' }));
  const cover = ev.cover_image || '';
  const dateSrc = ev.published_at || ev.event_date;
  const fmt = d => d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  document.title = `${ev.title} — Club de Solidarité ELARAKI`;
  root.innerHTML = `${cover ? `<div class="annonce-cover"><img src="${esc(cover)}" alt="${esc(ev.title)}"></div>` : ''}
    <header class="annonce-head"><div class="annonce-meta">${ev.category ? `<span class="annonce-tag">${esc(ev.category)}</span>` : ''}${ev.event_date ? `<span>📅 ${esc(fmt(ev.event_date))}</span>` : ''}${ev.location ? `<span>📍 ${esc(ev.location)}</span>` : ''}</div>
    <h1>${esc(ev.title)}</h1>${ev.summary ? `<p class="annonce-lead">${esc(ev.summary)}</p>` : ''}${ev.published_at ? `<small class="annonce-pub">Publiée le ${esc(fmt(ev.published_at))}</small>` : ''}</header>
    <div class="annonce-body">${paragraphs(ev.description) || ''}</div>
    ${gallery.length ? `<section class="annonce-gallery" aria-label="Photos"><h2>Photos</h2><div class="gallery-grid">${gallery.map((g, i) => `<button type="button" data-i="${i}" aria-label="Agrandir la photo ${i + 1}"><img src="${esc(g.src)}" alt="${esc(g.alt)}" loading="lazy"></button>`).join('')}</div></section>` : ''}`;
  if (gallery.length) bindLightbox(gallery);
}

function bindLightbox(list) {
  const lb = $('#lightbox'), img = lb.querySelector('img'), count = lb.querySelector('.lb-count'); let i = 0;
  const show = n => { i = (n + list.length) % list.length; img.src = list[i].src; img.alt = list[i].alt; count.textContent = `${i + 1} / ${list.length}${list[i].caption ? ' — ' + list[i].caption : ''}`; };
  const open = n => { show(n); lb.hidden = false; document.body.style.overflow = 'hidden'; lb.querySelector('.lb-close').focus(); };
  const close = () => { lb.hidden = true; document.body.style.overflow = ''; };
  root.querySelector('.gallery-grid').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) open(+b.dataset.i); });
  lb.querySelector('.lb-close').onclick = close; lb.querySelector('.prev').onclick = () => show(i - 1); lb.querySelector('.next').onclick = () => show(i + 1);
  lb.addEventListener('click', e => { if (e.target === lb) close(); });
  document.addEventListener('keydown', e => { if (lb.hidden) return; if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') show(i - 1); if (e.key === 'ArrowRight') show(i + 1); });
  const single = list.length < 2; lb.querySelectorAll('.lb-nav').forEach(b => b.hidden = single);
}
main().catch(() => state('Chargement impossible', 'Une erreur est survenue. Réessayez plus tard.'));
