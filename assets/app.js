(() => {
 const events=window.CLUB_EVENTS||[];
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
 grid.addEventListener('click',e=>{const b=e.target.closest('[data-event]');if(b)openEvent(b.dataset.event)});
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
 $('#volunteerForm').addEventListener('submit',async e=>{
  e.preventDefault();const form=e.currentTarget, status=$('#volunteerStatus'),btn=form.querySelector('button[type="submit"]');
  btn.disabled=true;btn.textContent='Envoi en cours…';
  const f=new FormData(form);
  try{
   const auth=window.CLUB_AUTH;
   if(!auth) throw new Error('Connectez-vous avec votre compte @elaraki.ac.ma avant de candidater.');
   const {data: sessionData}=await auth.auth.getSession(); const user=sessionData.session?.user;
   if(!user) throw new Error('Vous devez créer un compte ou vous connecter avant de déposer une candidature.');
   const {data: profile,error:profileErr}=await auth.from('profiles').select('first_name,last_name,email,grade_level,track,class_number').eq('id',user.id).single();
   if(profileErr||!profile) throw new Error('Profil scolaire introuvable. Complétez votre profil sur la page de compte.');
   const data={user_id:user.id,first_name:profile.first_name,last_name:profile.last_name,email:user.email,class_name:[profile.grade_level,profile.track,profile.class_number].filter(Boolean).join(' · '),phone:f.get('phone').trim()||null,interest_area:f.get('interest_area'),motivation:f.get('motivation').trim(),availability:f.get('availability').trim()||null,consent:true,status:'pending'};
   const {data:rows,error}=await auth.from('applications').insert(data).select('id'); if(error) throw error;setStatus(status,'Candidature enregistrée. Référence : '+(rows[0]?.id||'confirmée')+'. Le bureau pourra l’examiner.',true);form.reset();
  }catch(err){setStatus(status,err.message==='SUPABASE_NOT_CONFIGURED'?'Le formulaire est prêt, mais il n’est pas encore connecté : configurez Supabase pour transmettre la candidature en toute sécurité.':err.message);}
  finally{btn.disabled=false;btn.innerHTML='Envoyer ma candidature <span>→</span>'}
 });
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