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

## Décisions « À VALIDER » — défauts appliqués

Conformément au brief, les défauts sont appliqués et **signalés ici** (à confirmer côté usage Matthieu) :

1. **1 offre par lot** (toutes les magasins d'un mail reliés à une seule Offre). Basculable via `OFFER_GRANULARITY=local`.
2. **Container Azure privé + URL SAS longue durée** (lecture seule, TTL `AZURE_SAS_TTL_DAYS`, défaut 10 ans) — recommandé pour des données de baux.
3. **Propriétés `PDF`/`URL` de la DB Offres** : le type exact (file vs url vs texte) est **détecté à l'exécution** via le schéma de la data source (`PropsBuilder.fileOrUrl`), donc l'écriture s'adapte sans configuration.

Autres garde-fous : on n'écrit **que** les propriétés existantes et inscriptibles (les formules/rollups/champs internes sont ignorés automatiquement par `PropsBuilder`).

## Limitation connue à arbitrer — plaquette multi-centres (Terranae)

Le schéma d'extraction du brief (§6.2) modélise **un seul `centre` + N `locaux`**. Une plaquette de portefeuille type Terranae (≈50 centres dans un PDF de 141 pages) ne rentre pas dans un seul appel/objet. Le code traite fidèlement le cas « 1 centre + locaux » ; le cas **multi-centres** nécessite une étape supplémentaire (découpage du PDF par centre, ou extension du schéma vers `centres[]`) — à arbitrer avant de lancer Terranae en production. Signalé, non décidé silencieusement.

## Tests

`npm test` couvre la partie déterministe (extraction HTML/xlsx, tri & matching des pièces jointes, normalisation tél/montants, garde-fou, schémas zod). La validation IA de bout en bout (Zadig → 7 locaux, etc., cf. brief §11) requiert les fixtures réelles + une clé Anthropic ; brancher les `.eml` réels dans `tests/fixtures/` puis utiliser `POST /api/process` ou un runner local.
```
npm run typecheck   # vérifie la compilation
npm test            # tests unitaires déterministes
```
