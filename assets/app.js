(() => {
 const staticEvents=window.CLUB_EVENTS||[]; let events=[...staticEvents], upcoming=[];
 const $=s=>document.querySelector(s);
 const grid=$('#eventGrid'), search=$('#eventSearch'), year=$('#eventYear'), category=$('#eventCategory');
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const prettyDate=e=>e.dateLabel||e.date;
 function renderEvents(){
  const q=(search.value||'').trim().toLocaleLowerCase('fr');
  const filtered=events.filter(e=>(!q||(e.title+' '+e.description+' '+e.category).toLocaleLowerCase('fr').includes(q))&&(!year.value||e.date.startsWith(year.value))&&(!category.value||e.category===category.value));
  grid.innerHTML=filtered.map(e=>`<article class="event-card"><div class="event-image"><img src="${esc(e.cover)}" alt="${esc(e.title)}" loading="lazy"><span class="event-category">${esc(e.category)}</span></div><div class="event-content"><div class="event-date">${esc(prettyDate(e))}</div><h3>${esc(e.title)}</h3><p>${esc(e.description)}</p><button type="button" data-event="${esc(e.id)}">Voir l’événement →</button></div></article>`).join('');
  $('#eventEmpty').hidden=filtered.length>0;
  grid.scrollLeft=0;
  const prev=$('#eventsPrev'), next=$('#eventsNext');
  const updateArrows=()=>{const mobile=matchMedia('(max-width: 600px)').matches;const tablet=matchMedia('(max-width: 900px)').matches;const visible=mobile?3:6;const needs=filtered.length>visible;prev.hidden=next.hidden=!needs;prev.disabled=grid.scrollLeft<=2;next.disabled=grid.scrollLeft+grid.clientWidth>=grid.scrollWidth-2;};
  if(prev&&!prev.dataset.bound){prev.dataset.bound='1';prev.addEventListener('click',()=>grid.scrollBy({left:-grid.clientWidth,behavior:'smooth'}));next.addEventListener('click',()=>grid.scrollBy({left:grid.clientWidth,behavior:'smooth'}));grid.addEventListener('scroll',updateArrows,{passive:true});window.addEventListener('resize',updateArrows);}
  requestAnimationFrame(updateArrows);
  if(window.lucide)window.lucide.createIcons();
 }
 [search,year,category].forEach(el=>el.addEventListener('input',renderEvents));
 renderEvents();
 /* ---- Événements & actions : onglets, contenu de la base (publié + visible) fusionné avec les archives historiques ---- */
 const FR_DATE=d=>new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
 const stamp=(d,t,end)=>new Date(d+'T'+((t||(end?'23:59':'00:00')).slice(0,5))+(end?':59':':00')).getTime();
 const LOGO='assets/branding/club-solidarite-logo.png';
 function phaseOf(x){const now=Date.now();return now<stamp(x.event_date,x.start_time,false)?'upcoming':now<=stamp(x.end_date||x.event_date,x.end_time,true)?'ongoing':'past';}
 function rest(path,opts){const c=window.CLUB_CONFIG||{};if(!c.supabaseUrl||!c.supabaseAnonKey)return Promise.reject(new Error('SUPABASE_NOT_CONFIGURED'));return fetch(c.supabaseUrl.replace(/\/$/,'')+'/rest/v1/'+path,{...opts,headers:{apikey:c.supabaseAnonKey,Authorization:'Bearer '+c.supabaseAnonKey,'Content-Type':'application/json',...(opts&&opts.headers)}}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();});}
 function toItem(x){return {id:x.slug,title:x.title,date:x.event_date,dateLabel:FR_DATE(x.event_date)+(x.start_time?' · '+x.start_time.slice(0,5):''),category:x.category,description:x.summary||'',cover:x.cover_image||LOGO,images:[],href:'annonce.html?e='+encodeURIComponent(x.slug)};}
 function buildFilters(){
  const y=[...new Set(events.map(e=>String(e.date).slice(0,4)))].sort().reverse(), cur=year.value;
  year.innerHTML='<option value="">Toutes les années</option>'+y.map(v=>`<option>${esc(v)}</option>`).join('');year.value=cur;
  const c=[...new Set(events.map(e=>e.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr')), cc=category.value;
  category.innerHTML='<option value="">Toutes les catégories</option>'+c.map(v=>`<option>${esc(v)}</option>`).join('');category.value=cc;
 }
 function renderUpcoming(){
  const grid=$('#upcomingGrid');
  grid.innerHTML=upcoming.map((x,i)=>{const d=new Date(x.event_date+'T12:00:00'),now=x.phase==='ongoing';
   return `<a class="up-card ${i===0?'is-next':''}" href="${esc(x.href)}"><div class="up-image"><img src="${esc(x.cover)}" alt="" loading="lazy" ${x.cover===LOGO?'class="placeholder"':''}><span class="up-badge ${now?'now':''}">${now?'En cours':i===0?'Prochain rendez-vous':'À venir'}</span><span class="up-date"><b>${d.getDate()}</b><small>${esc(d.toLocaleDateString('fr-FR',{month:'short'}).replace('.',''))}</small></span></div><div class="up-body"><h3>${esc(x.title)}</h3><div class="up-meta"><span>${esc(x.kind==='action'?'Action':'Événement')}</span>${x.start_time?`<span>🕒 ${esc(x.start_time.slice(0,5))}</span>`:''}${x.location?`<span>📍 ${esc(x.location)}</span>`:''}</div><p>${esc(x.summary||'')}</p><span class="up-more">Découvrir →</span></div></a>`;}).join('');
  $('#upcomingEmpty').hidden=upcoming.length>0;$('#upCount').textContent=upcoming.length;
 }
 function showTab(name){
  const up=name==='upcoming';
  $('#tabUpcoming').setAttribute('aria-selected',String(up));$('#tabArchives').setAttribute('aria-selected',String(!up));
  $('#panelUpcoming').hidden=!up;$('#panelArchives').hidden=up;if(!up)renderEvents();
 }
 document.querySelectorAll('.event-tabs [data-tab]').forEach(b=>{b.addEventListener('click',()=>showTab(b.dataset.tab));b.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const o=b.dataset.tab==='upcoming'?'archives':'upcoming';showTab(o);$('#tab'+(o==='upcoming'?'Upcoming':'Archives')).focus();}});});
 async function loadDbEvents(){
  let rows=[],hidden=[];
  try{
   [rows,hidden]=await Promise.all([
    rest('events?select=id,slug,title,summary,event_date,end_date,start_time,end_time,category,location,cover_image,kind&status=eq.published&is_visible=eq.true&event_date=not.is.null&order=event_date.asc'),
    rest('rpc/hidden_event_slugs',{method:'POST',body:JSON.stringify({p_slugs:staticEvents.map(e=>e.id)})}).catch(()=>[])
   ]);
  }catch(e){ /* hors-ligne ou non configuré : on garde les archives historiques */ }
  const withPhase=rows.map(r=>({...r,phase:phaseOf(r)}));
  upcoming=withPhase.filter(r=>r.phase!=='past').map(r=>({...r,href:'annonce.html?e='+encodeURIComponent(r.slug),cover:r.cover_image||LOGO})).sort((a,b)=>(a.phase==='ongoing'?0:1)-(b.phase==='ongoing'?0:1)||stamp(a.event_date,a.start_time)-stamp(b.event_date,b.start_time));
  const dbPast=withPhase.filter(r=>r.phase==='past'),dbSlugs=new Set(rows.map(r=>r.slug)),hide=new Set(hidden||[]);
  const staticKept=staticEvents.filter(e=>!hide.has(e.id));
  const staticIds=new Set(staticEvents.map(e=>e.id));
  events=[...staticKept,...dbPast.filter(r=>!staticIds.has(r.slug)).map(toItem)].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  buildFilters();renderEvents();renderUpcoming();$('#arCount').textContent=events.length;
  showTab(upcoming.length?'upcoming':'archives');
  if(window.lucide)window.lucide.createIcons();
 }
 buildFilters();renderUpcoming();$('#arCount').textContent=events.length;showTab('archives');loadDbEvents();
 const modal=$('#eventModal');
 function openEvent(id){
  const e=events.find(x=>x.id===id);if(!e)return;
  $('#modalCover').src=e.cover;$('#modalCover').alt=e.title;
  $('#modalMeta').textContent=`${prettyDate(e)} · ${e.category} · date de référence`;
  $('#modalTitle').textContent=e.title;$('#modalDescription').textContent=e.description;
  $('#modalGallery').innerHTML=e.images.map((src,i)=>`<img src="${esc(src)}" alt="${esc(e.title)} — photo ${i+1}" loading="lazy" tabindex="0" data-large="${esc(src)}">`).join('');
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';$('.modal-close').focus();
 }
 function closeModal(){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');document.body.style.overflow='';}
 grid.addEventListener('click',e=>{const b=e.target.closest('[data-event]');if(!b)return;const it=events.find(x=>x.id===b.dataset.event);if(it&&it.href)location.href=it.href;else openEvent(b.dataset.event)});
 $('#modalGallery').addEventListener('click',e=>{const im=e.target.closest('[data-large]');if(im){$('#modalCover').src=im.dataset.large;}});
 $('#modalGallery').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-large]')){e.preventDefault();$('#modalCover').src=e.target.dataset.large;}});
 modal.addEventListener('click',e=>{if(e.target.hasAttribute('data-close-modal'))closeModal()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal.classList.contains('open'))closeModal()});
 const menu=$('#menuToggle'), nav=$('#mainNav');
 menu.addEventListener('click',()=>{const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Fermer le menu':'Ouvrir le menu');menu.textContent=open?'×':'☰'});
 nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('open');menu.setAttribute('aria-expanded','false');menu.textContent='☰'}));
 $('#year').textContent=new Date().getFullYear();
 async function insertToSupabase(table,data){
  const c=window.CLUB_CONFIG||{};
  if(!c.supabaseUrl||!c.supabaseAnonKey)throw new Error('SUPABASE_NOT_CONFIGURED');
  const res=await fetch(c.supabaseUrl.replace(/\/$/,'')+'/rest/v1/'+table,{method:'POST',headers:{'Content-Type':'application/json','apikey':c.supabaseAnonKey,'Authorization':'Bearer '+c.supabaseAnonKey,'Prefer':'return=representation'},body:JSON.stringify(data)});
  if(!res.ok){let msg='Impossible d’enregistrer. Vérifiez la configuration.';try{const j=await res.json();if(j.message)msg=j.message}catch{}throw new Error(msg)}
  return res.json();
 }
 function setStatus(el,msg,ok=false){el.textContent=msg;el.style.color=ok?'#167447':'#b42318'}
 $('#contactForm').addEventListener('submit',async e=>{
  e.preventDefault();const form=e.currentTarget,status=$('#contactStatus'),btn=form.querySelector('button');btn.disabled=true;btn.textContent='Envoi en cours…';
  const f=new FormData(form),data={name:f.get('name').trim(),email:f.get('email').trim().toLowerCase(),subject:f.get('subject').trim(),message:f.get('message').trim(),status:'new'};
  try{await insertToSupabase('contact_messages',data);setStatus(status,'Votre message a été enregistré. Merci !',true);form.reset();
  }catch(err){setStatus(status,err.message==='SUPABASE_NOT_CONFIGURED'?'Le formulaire est prêt, mais la réception n’est pas configurée. Aucun message n’a été envoyé.':err.message);}
  finally{btn.disabled=false;btn.textContent='Envoyer le message →'}
 });
 // Mark nav item corresponding to the visible anchor.
 const links=[...nav.querySelectorAll('a[href^="#"]')];
 const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){links.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+entry.target.id));}}),{rootMargin:'-35% 0px -55% 0px'});
 document.querySelectorAll('main section[id]').forEach(s=>observer.observe(s));
})();