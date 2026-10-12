import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cfg = window.CLUB_CONFIG || {};
const form = document.querySelector('#loginForm');
const status = document.querySelector('#loginStatus');
const notice = document.querySelector('#authNotice');
const submit = form?.querySelector('button[type="submit"], button:not([type])');
function show(message, error = true) {
  if (status) { status.textContent = message; status.style.color = error ? '#b42318' : '#167647'; }
}
if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
  show('Configuration manquante : vérifiez assets/config.js (URL du projet et clé publique).');
  if (submit) submit.disabled = true;
} else {
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  // If a valid admin/editor session already exists, skip the login form.
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', sessionData.session.user.id).maybeSingle();
    if (profile && ['admin','editor'].includes(profile.role)) location.replace('index.html');
    else await supabase.auth.signOut();
  }
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = String(form.elements.email.value || '').trim();
    const password = String(form.elements.password.value || '');
    if (submit) { submit.disabled = true; submit.textContent = 'Connexion…'; }
    show('Vérification de vos identifiants…', false);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const { data: profile, error: profileError } = await supabase
        .from('profiles').select('role, full_name').eq('id', data.user.id).maybeSingle();
      if (profileError) throw new Error('Connexion réussie, mais le rôle n’a pas pu être vérifié. Vérifiez la table profiles et ses policies RLS.');
      if (!profile || !['admin','editor'].includes(profile.role)) {
        await supabase.auth.signOut();
        throw new Error('Ce compte n’a pas de rôle autorisé. Attribuez-lui le rôle admin ou editor dans public.profiles.');
      }
      show('Connexion réussie. Ouverture du tableau de bord…', false);
      location.replace('index.html');
    } catch (err) {
      show(err?.message || 'Échec de la connexion. Vérifiez votre e-mail, votre mot de passe et la configuration Supabase.');
    } finally {
      if (submit) { submit.disabled = false; submit.textContent = 'Se connecter →'; }
    }
  });
}
