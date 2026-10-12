# Club de Solidarité — ELARAKI International School of Morocco

Site public responsive et espace d’administration préparés à partir de la maquette fournie, des deux logos joints et des photographies historiques de l’archive « Evenements Club Solidarité ».

## Contenu
- `index.html` : vitrine publique, mission, domaines d’action, projets, événements filtrables, galerie dans une fenêtre modale, candidature bénévole et contact.
- `assets/style.css` : identité institutionnelle bleu/blanc, responsive desktop/mobile.
- `assets/events-data.js` : événements et images locales importés depuis l’archive.
- `assets/events/` : copies des photographies historiques originales, classées par événement.
- `assets/branding/` : logos fournis.
- `admin/login.html` et `admin/index.html` : écrans de connexion et tableau de bord préparatoire.
- `supabase/schema.sql` : tables relationnelles, contraintes et politiques RLS.
- `supabase/seed-events.sql` : données initiales des six événements documentés.
- `privacy.html` : modèle de politique de confidentialité à valider par l’école.

## Lancer localement
Ouvrir `index.html` dans un navigateur pour examiner la vitrine. Pour tester correctement les formulaires, les routes et les fichiers, il est préférable de lancer un serveur statique local (par exemple l’extension Live Server de VS Code).

## Configuration Supabase
1. Créer un projet Supabase.
2. Dans SQL Editor, exécuter `supabase/schema.sql`.
3. Exécuter `supabase/seed-events.sql` si les événements doivent aussi être présents dans la base. Vérifier les dates et statuts avant de publier.
4. Dans `assets/config.js`, remplir `supabaseUrl` et `supabaseAnonKey` avec l’URL du projet et la clé publique/anon. N’ajoutez jamais la clé `service_role` à ce fichier.
5. Créer le premier utilisateur dans Supabase Authentication. Puis attribuer le rôle `admin` à son UUID via la requête commentée dans `schema.sql`, exécutée par le propriétaire du projet.
6. Tester les policies RLS avec un utilisateur non connecté, un utilisateur standard et un administrateur.

Les formulaires public d’application et de contact font un POST REST vers Supabase et affichent une erreur si la configuration manque ou si l’insertion échoue. Aucune réussite n’est simulée.

## Limites à régler avant production
- Le flux de connexion utilise maintenant Supabase Auth (`signInWithPassword`) et vérifie le rôle `admin` ou `editor` dans `public.profiles`. Le tableau de bord redirige les visiteurs non connectés et offre une déconnexion réelle. Le panneau reste partiel : tous les écrans CRUD ne sont pas implémentés, et les policies RLS doivent être testées avant production.
- Les listes d’événements publiques sont servies depuis le fichier statique `assets/events-data.js`; elles ne sont pas encore chargées dynamiquement depuis la base.
- Les images historiques sont dans les fichiers du site statique. Pour les gérer via le panel, créer un bucket Supabase Storage privé/public approprié, mettre en place ses policies et un outil d’importation.
- Les statistiques affichées dans le Hero sont des valeurs illustratives de la maquette. Confirmez-les ou remplacez-les avant publication.
- Le texte de confidentialité doit être validé par l’établissement et complété avec le responsable du traitement et les durées de conservation.
- Ajoutez une protection anti-spam/rate limit pour les formulaires avant lancement public.
- Les dates sont des dates de référence tirées des dossiers/texte source, pas toujours des dates confirmées de réalisation.

## Déploiement Cloudflare Pages
Téléversez le dossier du projet dans un dépôt GitHub et connectez-le à Cloudflare Pages. Pour ce site statique, le dossier racine est `elaraki-solidarite-final` (ou son contenu à la racine du dépôt) et aucune commande de build n’est nécessaire. Si vous déplacez les fichiers à la racine du dépôt, gardez les chemins relatifs intacts.

## Références historiques
Les descriptions reprennent et reformulent les fichiers texte présents dans l’archive fournie. Les photographies ont été copiées sans écraser les originaux fournis. L’événement « ELARAKI’s Got Talent » est daté « Mars 2019 » car la date de tenue exacte n’est pas confirmée dans le texte.
