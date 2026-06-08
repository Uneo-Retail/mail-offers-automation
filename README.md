# mail-offers-automation

Automatisation : détection & centralisation d'offres immobilières commerciales reçues par mail (Outlook M365) vers Notion, pour **Uneo Retail**.

Pipeline serverless (Vercel, Node/TypeScript) : polling delta Microsoft Graph → extraction multi-format → classification/extraction via Claude → écriture structurée dans Notion → notification à soi-même. Spécifications complètes dans [`docs/`](./docs).

## Architecture

```
api/poll.ts  (cron */10)
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
5. Déployer sur Vercel (le cron est défini dans `vercel.json`). Protéger le cron via `CRON_SECRET`.

Endpoints : `GET /api/health` (ping), `GET /api/poll` (cron), `POST /api/process { messageId }` (replay debug).

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

## Limitation connue à arbitrer — plaquette multi-centres (Terranae)

Le schéma d'extraction du brief (§6.2) modélise **un seul `centre` + N `locaux`**. Une plaquette de portefeuille type Terranae (≈50 centres dans un PDF de 141 pages) ne rentre pas dans un seul appel/objet. Le code traite fidèlement le cas « 1 centre + locaux » ; le cas **multi-centres** nécessite une étape supplémentaire (découpage du PDF par centre, ou extension du schéma vers `centres[]`) — à arbitrer avant de lancer Terranae en production. Signalé, non décidé silencieusement.

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
