import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cfg = window.CLUB_CONFIG || {};
const status = document.querySelector('#authStatus');
function deny(message) {
  if (status) status.textContent = message;
  location.replace('login.html');
}
if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
  if (status) status.textContent = 'Configuration Supabase manquante. Le tableau de bord reste inaccessible.';
  document.querySelector('.admin-main')?.setAttribute('hidden', '');
  location.replace('login.html');
} else {
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) {
    deny('Session absente. Veuillez vous connecter.');
  } else {
    const { data: profile, error: profileError } = await supabase.from('profiles').select('role, full_name').eq('id', session.user.id).maybeSingle();
    if (profileError || !profile || !['admin','editor'].includes(profile.role)) {
      await supabase.auth.signOut();
      deny('Accès refusé : rôle administrateur ou éditeur requis.');
    } else {
      if (status) status.textContent = 'Connecté — accès vérifié par Supabase.';
      const userEl = document.querySelector('#adminUserName');
      if (userEl) userEl.textContent = profile.full_name || session.user.email || 'Utilisateur autorisé';
      document.querySelector('.admin-main')?.removeAttribute('hidden');
      const logout = document.querySelector('#logoutButton');
      logout?.addEventListener('click', async () => {
        logout.disabled = true; logout.textContent = 'Déconnexion…';
        await supabase.auth.signOut();
        location.replace('login.html');
      });
      const count = async (table, apply = q => q) => {
        let q = supabase.from(table).select('*', { count: 'exact', head: true });
        q = apply(q); const result = await q; if (result.error) throw result.error; return result.count ?? 0;
      };
      try {
        const [members, apps, upcoming, projects] = await Promise.all([
          count('members', q => q.eq('status','active')),
          count('applications', q => q.eq('status','pending')),
          count('events', q => q.eq('status','published').gte('event_date', new Date().toISOString().slice(0,10))),
          count('projects', q => q.eq('status','completed'))
        ]);
        for (const [id, value] of [['membersCount',members],['appsCount',apps],['upcomingCount',upcoming],['projectsCount',projects]]) {
          const el = document.getElementById(id); if (el) el.textContent = String(value);
        }
      } catch (err) {
        if (status) status.textContent = 'Connecté, mais certaines statistiques sont indisponibles. Vérifiez les tables et les policies RLS Supabase.';
      }
      try {
        const { data, error } = await supabase.from('applications').select('id, first_name, last_name, email, interest_area, submitted_at, status').order('submitted_at', {ascending:false}).limit(5);
        const list = document.querySelector('#applicationsList');
        if (!error && list) {
          if (!data?.length) { list.textContent = 'Aucune candidature pour le moment.'; list.className = 'admin-empty'; }
          else { list.className = ''; list.innerHTML = data.map(a => `<div class="admin-event"><div><strong>${escapeHtml(a.first_name)} ${escapeHtml(a.last_name)}</strong><small>${escapeHtml(a.interest_area || 'Sans domaine')} · ${new Date(a.submitted_at).toLocaleDateString('fr-FR')}</small><small>${escapeHtml(a.email)}</small></div></div>`).join(''); }
        }
      } catch (_) {}
    }
  }
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
