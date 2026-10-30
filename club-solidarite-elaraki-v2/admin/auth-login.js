import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cfg = window.CLUB_CONFIG || {};
const form = document.querySelector('#loginForm');
const status = document.querySelector('#loginStatus');
const notice = document.querySelector('#authNotice');
const submit = form?.querySelector('button[type="submit"], button:not([type])');
function show(message, error = true) {
  if (status) { status.textContent = message; status.style.color = error ? '#b91c1c' : '#15803d'; }
}
if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
  show('Configuration manquante : vérifiez assets/config.js (URL du projet et clé publique).');
  if (submit) submit.disabled = true;
} else {
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  // Session existante : on ne redirige que si la base confirme des permissions d'administration.
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session) {
    const { data: acc } = await supabase.rpc('my_access');
    if (acc?.permissions?.length) location.replace('index.html');
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
      const { data: acc, error: accErr } = await supabase.rpc('my_access');
      if (accErr) throw new Error('Connexion réussie, mais les autorisations n’ont pas pu être vérifiées. Vérifiez que la migration Supabase v3 a été exécutée.');
      if (!acc?.permissions?.length) {
        await supabase.auth.signOut();
        throw new Error('Ce compte n’est pas autorisé à accéder à l’administration.');
      }
      show('Connexion réussie. Ouverture du tableau de bord…', false);
      location.replace('index.html');
    } catch (err) {
      show(err?.message || 'Échec de la connexion. Vérifiez votre e-mail, votre mot de passe et la configuration Supabase.');
    } finally {
      if (submit) { submit.disabled = false; submit.textContent = 'Se connecter'; }
    }
  });
}
