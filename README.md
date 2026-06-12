# mail-offers-automation

Automatisation : détection & centralisation d'offres immobilières commerciales reçues par mail (Outlook M365) vers Notion, pour **Uneo Retail**.

Pipeline serverless (Vercel, Node/TypeScript) : polling delta Microsoft Graph → extraction multi-format → classification/extraction via Claude → écriture structurée dans Notion → notification à soi-même. Spécifications complètes dans [`docs/`](./docs).

## Architecture

```
api/poll.ts  (cron externe GitHub Actions */30)
  └─ Graph /messages/delta ─→ pour chaque nouveau mail :
       guard technique → extraction (html/xlsx/pdf/lien) → classify (Haiku)
       → extract (Sonnet) → upload Azure → Notion (contact→broker, emplacement,
         N magasins, offre) → mail de confirmation → marquer traité (Supabase)
```

| Domaine | Module |
|---|---|
| Graph (auth, delta, messages) | `src/graph/` |
| Extraction déterministe | `src/extract/` |
| IA (classify/extract, schemas, prompts) | `src/ai/` |
| Écriture Notion | `src/notion/` |
| Stockage fichiers | `src/storage/azureBlob.ts` |
| Notifications | `src/mail/reply.ts` |
| État / dédoublonnage | `src/state/supabase.ts` |
| Orchestration | `src/pipeline.ts`, `api/poll.ts` |

## Mise en route

1. `npm install`
2. Copier `.env.example` → `.env` et renseigner les secrets (Graph, Anthropic, Notion, Azure, Supabase). Setup Azure/Entra : voir `docs/ARCHITECTURE.md §12`.
3. Créer les tables Supabase : exécuter `db/schema.sql`.
4. `npm run typecheck` et `npm test` (les tests déterministes tournent sans credentials).
5. Déployer sur Vercel. Protéger `/api/poll` via `CRON_SECRET`.

Endpoints : `GET /api/health` (ping), `GET /api/poll` (cron), `POST /api/process { messageId }` (replay debug).

### Déclenchement périodique : cron externe GitHub Actions

Le plan Vercel gratuit n'autorise qu'**un cron par jour** — insuffisant pour poller la boîte régulièrement. Le cron natif Vercel a donc été retiré de `vercel.json` et remplacé par le workflow GitHub Actions [`.github/workflows/poll.yml`](./.github/workflows/poll.yml), planifié **toutes les 30 min** (`*/30`), qui appelle `/api/poll` avec le `CRON_SECRET` en header `Authorization: Bearer`.

- **Prérequis (une fois)** — repo GitHub, *Settings → Secrets and variables → Actions*, poser deux secrets :
  - `POLL_URL` = `https://<projet>.vercel.app/api/poll`
  - `CRON_SECRET` = **identique** à la variable d'environnement `CRON_SECRET` posée dans Vercel (sinon le workflow reçoit un `401`).
- **Déclenchement manuel** possible via l'onglet *Actions → Run workflow* (utile pour l'amorçage delta et les tests).
- **Repasser au cron natif Vercel** (`*/10`) le jour d'un upgrade Pro : réintroduire le bloc `crons` dans `vercel.json`, remonter `maxDuration` à `300`, et désactiver/supprimer ce workflow.

## Console admin (frontend de supervision)

Une console web (Next.js, App Router) supervise les mails traités : liste filtrable, détail (résumé IA, raison d'échec, lien Notion) et **timeline « live »** du traitement en cours.

- **Accès** : `https://<projet>.vercel.app/admin` (la racine `/` redirige vers `/admin`).
- **Authentification** : Basic Auth via le middleware. À l'invite du navigateur, laisser l'identifiant vide ou quelconque et saisir le mot de passe = variable d'env **`ADMIN_PASSWORD`** (jamais exposée au client).
- **Pages** : `/admin` (liste : date, sujet, expéditeur, statut, nb locaux, lien Notion ; filtres + recherche ; indicateur « en cours ») ; `/admin/[messageId]` (détail + déroulé des étapes, animé en quasi temps réel).
- **Bouton « Déclencher un traitement »** : appelle `/api/poll` côté serveur (header `Authorization: Bearer CRON_SECRET` ajouté par la route `/api/admin/trigger` ; le secret reste serveur).
- **Live** : la timeline est rafraîchie par **polling serveur** (toutes les 2,5 s) via `/api/admin/messages/[id]` — aucune clé Supabase n'est envoyée au navigateur. *Option* : pour du vrai Supabase Realtime côté client, ajouter une **policy SELECT** sur `processing_events` pour le rôle `anon` + utiliser une clé **publishable/anon restreinte** (jamais la `service_role`).

### Données & migrations

Le pipeline écrit un flux d'événements (table **`processing_events`**) lu par la console. Appliquer les SQL de `db/` sur Supabase :
- `db/processing_events.sql` (table + index + RLS activée sans policy + publication Realtime),
- `db/processed_messages_add_subject.sql` (colonnes `subject`/`sender`, additives).

L'écriture d'événements est **best-effort** : un échec n'interrompt jamais le pipeline.

### Variables d'environnement ajoutées
- **`ADMIN_PASSWORD`** — mot de passe d'accès à la console (obligatoire ; sans lui les routes `/admin` renvoient `500`).
- Réutilise `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (lecture serveur, jamais côté navigateur) et `CRON_SECRET` (bouton de déclenchement).

### Changement de configuration Vercel (front Next + fonctions)
L'ajout du front modifie le build :
- `vercel.json` ne contient plus `buildCommand`/`outputDirectory` (qui neutralisaient le build) — Vercel **détecte Next.js** (présence de la dépendance `next`) et lance `next build`. Le bloc `functions` (avec `includeFiles` pdfjs) est conservé pour `api/poll.ts` et `api/process.ts`.
- Les fonctions serverless **historiques** `api/poll.ts`, `api/health.ts`, `api/process.ts` (au format Vercel Functions, hors `app/`) **coexistent** avec l'app Next et restent déployées telles quelles. À vérifier au premier déploiement : `GET /api/health` et `GET /api/poll` répondent toujours.
- Deux `tsconfig` : `tsconfig.backend.json` (NodeNext, utilisé par `npm run typecheck` et les fonctions) et `tsconfig.json` (Next, app). `next.config.mjs` ajoute un `extensionAlias` `.js → .ts` pour que le front réutilise les modules backend (`src/**`).

Scripts : `npm run dev` (front local), `npm run build` (`next build`), `npm run typecheck` (backend), `npm run typecheck:web` (app), `npm test` (tests backend).

### Amorçage delta (important au 1er run)

Le **tout premier** appel à `/api/poll` sur une boîte non amorcée **ne traite aucun mail** : il parcourt le delta jusqu'au `@odata.deltaLink` final et le persiste (réponse `{ "primed": true, "processed": 0 }`). C'est une « ligne de départ maintenant » — sans ça, le premier cron traiterait tout l'historique de l'inbox (coût IA massif + base Notion polluée). Les runs suivants ne traitent que les mails reçus **après** l'amorçage.

- `FORCE_BACKFILL=true` : force le traitement de ce que renvoie le delta dès le 1er run (rattrapage volontaire de l'historique). Absent par défaut → jamais de backfill.
- `MAX_BATCH` (défaut 40) : borne dure du nombre de mails traités par exécution. Au-delà, seuls les plus anciens sont traités et le deltaLink **n'avance pas** — le reste est drainé aux crons suivants (idempotent via `processed_messages`).

## Décisions « À VALIDER » — défauts appliqués

Conformément au brief, les défauts sont appliqués et **signalés ici** (à confirmer côté usage Matthieu) :

1. **1 offre par lot** (toutes les magasins d'un mail reliés à une seule Offre). Basculable via `OFFER_GRANULARITY=local`.
2. **Container Azure privé + URL SAS longue durée** (lecture seule, TTL `AZURE_SAS_TTL_DAYS`, défaut 10 ans) — recommandé pour des données de baux.
3. **Propriétés `PDF`/`URL` de la DB Offres** : le type exact (file vs url vs texte) est **détecté à l'exécution** via le schéma de la data source (`PropsBuilder.fileOrUrl`), donc l'écriture s'adapte sans configuration.

Autres garde-fous : on n'écrit **que** les propriétés existantes et inscriptibles (les formules/rollups/champs internes sont ignorés automatiquement par `PropsBuilder`).

## Plaquette dense (multi-centres type Terranae) — signalée, pas extraite en masse

Décision produit : on ne tente PAS l'extraction exhaustive d'une grosse plaquette de portefeuille (≈50 centres / 141 pages). L'IA tenterait de tout extraire et produirait un résultat long, partiel et peu fiable. Comportement retenu :

- détection « plaquette dense » = `route = faible_completude` **ET** (plus de `DENSE_BROCHURE_MAX_CENTERS` centres distincts **OU** PDF de plus de `DENSE_BROCHURE_MAX_PAGES` pages), ou le modèle pose lui-même `dense_brochure=true` (mode signalement) ;
- aucune création en masse de Magasins/Emplacements : on crée une **seule** page Offre « à traiter manuellement » (État « À étudier ») avec en Notes un court résumé + le lien Azure vers le PDF ;
- notification dédiée à soi-même : « Document dense reçu : plaquette de portefeuille (~N centres). Traitement automatique non effectué… À consulter manuellement : `<lien PDF>` ».

Le garde-fou ne s'applique **qu'aux** `faible_completude` : les offres normales (Zadig, Paris IX, Villeneuve) ne sont jamais concernées. Seuils : `DENSE_BROCHURE_MAX_CENTERS` (défaut 5), `DENSE_BROCHURE_MAX_PAGES` (défaut 30).

## Tests

```
npm run typecheck     # vérifie la compilation
npm test              # tests unitaires déterministes (sans credentials)
npm run test:fixtures # runner de validation sur mails réels (classify + extract)
```

`npm test` couvre la partie déterministe (extraction HTML/xlsx, tri & matching des pièces jointes, normalisation tél/montants, garde-fou, amorçage/troncature, schémas zod, parseur `.eml`, comparateur).

### Runner de validation IA — `npm run test:fixtures`

Confronte le cœur IA (classify + extract) à de vrais mails **avant** tout déploiement, et mesure l'écart aux sorties attendues. N'appelle **ni Notion, ni Azure, ni Graph** : il valide la compréhension, pas l'écriture. C'est le test anti-« crash test » — on n'a pas vocation à déployer tant qu'il n'est pas vert sur les cas de référence (et **zéro faux positif** sur les fixtures de bruit).

- Requiert `ANTHROPIC_API_KEY` dans l'environnement pour la partie IA. **Sans clé**, seule l'extraction déterministe s'exécute et la partie IA est SKIP (pas de plantage).
- Code de sortie ≠ 0 si un cas échoue (utilisable en CI).

**Format des fixtures** — un sous-dossier par cas dans `tests/fixtures/<cas>/` :
- `expected.json` (golden, requis) ;
- le mail, au choix : `mail.eml` (MIME brut, le plus fidèle) **ou** `mail.json` (objet `IncomingMail` partiel : `subject`, `from`, `bodyText`/`bodyHtml`, et `attachments: [{ name, contentType, file }]` pointant vers des fichiers joints du dossier).

**Format `expected.json`** (validation partielle : seuls les champs présents sont vérifiés) :
```jsonc
{
  "route": "offre",                 // attendu de la classification
  "type_offre": "cession",
  "nb_locaux": 7,
  "centre_present": false,
  "broker": { "societe": "Marcle Immobilier",
              "contact": { "email": "...", "telephone": "0609501861" } }, // tél comparé en chiffres
  "locaux_all": { "loyer_annuel_fixe": null },  // contrainte sur CHAQUE local (ici : pas de prix)
  "locaux": [ { "match": "Annecy", "surface_rdc": 86, "loyer_annuel_fixe": 33224 } ] // match = sous-chaîne nom/adresse
}
```
`null` attendu ⇒ le champ obtenu doit être absent/null. Les montants sont comparés en numérique.

Fixtures fournies : 3 cas de **bruit** (facture, newsletter piège, relance) avec `{ "route": "bruit" }`, plus les golden **Zadig** et **Terranae** (brief §11) — déposer leurs `mail.eml` réels (ignorés par git pour confidentialité des baux) pour exécuter la partie IA.
