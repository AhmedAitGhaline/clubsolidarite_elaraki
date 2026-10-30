/* Valeurs scolaires uniques (inscription, profil, candidature, administration) — ne pas dupliquer ailleurs. */
export const TRACKS = {
  'Tronc Commun': ['Scientifique', 'Lettre'],
  '1 Bac': ['Sciences Maths', 'Sciences Experimentales', 'Sciences Economiques'],
  '2 Bac': ['Sciences Maths A', 'Sciences Maths B', 'Sciences Physiques', 'Sciences Economiques']
};
export const GRADES = Object.keys(TRACKS);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Remplit une liste de filières. `selected` est réappliqué APRÈS la reconstruction des options.
   Une ancienne valeur absente de la liste est conservée (marquée) au lieu d'être remplacée en silence. */
export function fillTrackSelect(select, grade, selected = '') {
  const list = TRACKS[grade] || [];
  let html = `<option value="">${grade ? 'Choisir' : 'Choisir le niveau d’abord'}</option>` + list.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  if (selected && !list.includes(selected)) html += `<option value="${esc(selected)}">${esc(selected)} (valeur actuelle — à vérifier)</option>`;
  select.innerHTML = html;
  select.value = selected || '';
}

export const APP_STATUS = { pending: 'En attente', accepted: 'Acceptée', rejected: 'Refusée', archived: 'Archivée' };
export const AREAS = ['Organisation des événements', 'Communication et réseaux sociaux', 'Logistique', 'Actions solidaires', 'Développement durable', 'Création de contenu et design', 'Informatique et développement web', 'Autre'];
