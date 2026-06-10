# Architecture technique — Automatisation offres immobilières → Notion

> Spec de référence pour le build. Destinée à être lue par un humain et donnée à l'IA pour générer le code.
> Voir `CONTEXTE_PROJET.md` pour le contexte métier et l'historique des décisions.

---

## 1. Vue d'ensemble

Service serverless (Vercel, Node/TypeScript) qui :
1. récupère périodiquement les nouveaux mails de la boîte M365 du client (Microsoft Graph, polling delta),
2. extrait le contenu (corps, PDF, xlsx, liens, gros PDF),
3. classe/route chaque mail via IA (offre exploitable / bruit / faible complétude),
4. extrait les données structurées des offres (tableau de locaux + contact broker),
5. héberge les fichiers (Azure Blob) et écrit dans Notion en respectant la hiérarchie Centre → Local → Offre → Broker,
6. trace l'état pour ne jamais retraiter deux fois un mail.

---

## 2. Modèle de données Notion (cible d'écriture)

Hiérarchie réelle :

```
Emplacements (= CENTRE, niveau parent)
   └─ Magasins (= LOCAL, niveau enfant)   ← relation Emplacement ↔ Magasins
         └─ Offres                         ← relation Offres ↔ Magasin (1 offre ↔ N magasins)
         └─ Brokers (= SOCIÉTÉ/agence)     ← relation Brokers ↔ Magasin
               └─ Contacts (= PERSONNES)   ← relation Brokers ↔ Contacts ; email/tél portés ICI
```
⚠️ Broker est une SOCIÉTÉ (Marcle Immobilier, Terranae), PAS une personne. Les personnes sont dans la DB **Contacts** : `Nom complet` (title), `E-mail` (email), `Portable` (phone_number), `Rôle/Périmètre` (text), `Adresse Postale` (text), + relations `Broker` / `Bailleur` / `Entreprise` (un contact peut être lié à l'un des trois). Le matching email→tél se fait sur Contacts, puis on remonte au Broker. Règle par défaut MVP : contact d'une offre entrante → rattaché à **Broker**.

DB et data source IDs (API Notion version data sources, en-tête `Notion-Version` récent + `data_source_id`) :
- **Offres** : `collection://29b545f7-7d1b-80db-87c4-000b800d1928`
- **Magasins** : `collection://29a545f7-7d1b-8198-8c48-000b58d15f80`
- **Emplacements** : `collection://29a545f7-7d1b-8126-a235-000b671734c4`
- **Brokers** (société) : `collection://29a545f7-7d1b-8042-a782-000b9e431263`
- **Contacts** (personnes, email/tél) : `collection://29a545f7-7d1b-80ba-b5bc-000bb889c53a`
- **Bailleurs** : `collection://29a545f7-7d1b-8005-9f35-000bc22e5e4b`
- **Gestionnaires** : `collection://29b545f7-7d1b-807d-8b5f-000bbf71c058`
- **Villes** : `collection://29a545f7-7d1b-80d2-a35c-000ba4ede17a`

### Ordre de création (important : enfants avant parents pour avoir les IDs à relier)
1. Résoudre/créer **Contact** (personne) : matching email → tél normalisé sur la DB Contacts. Remonter/créer le **Broker** (société) lié.
2. Résoudre/créer **Emplacement** (centre) si applicable.
3. Créer les **N Magasins** (locaux), reliés à l'Emplacement + au Broker.
4. Créer/mettre à jour l'**Offre**, reliée aux N Magasins + Broker.
5. Marquer le mail comme traité.

### Mapping Magasins (champs écrits par l'IA) — voir CONTEXTE §4
Title `Nom`, `Adresse complète`, `Surface RDC/R-1/R+1/R+2`, `Surface Pondérée` (←surface au bail), `Loyer annuel fixe` (←loyer HT/HC), `Loyer annuel variable`, `Charges locatives annuelle`, `Droit au bail` (←prix de cession), `TF annuelle`, `Type d'Emplacement` (select), `Durée ferme` (multi-select), dates de bail (vide si "non communiqué"), `Année du bail`, `Notes` (déversoir + environnement commercial), `Documents`+`Plan local/CC` (URLs Azure), relations `Brokers`, `Offres`, `Emplacement`.
NE PAS toucher : formules, `Occupant`, `Enseigne(s)`, champs internes client (cf CONTEXTE §4).

### Mapping Emplacements (centre, écrit seulement pour plaquettes/centres)
Title `Nom`, `Adresse complète`, `Type d'emplacement` (select), `Locomotive` (select), `Superficie m² ` (←GLA), `Surface m² hypermarché`, `Flux visiteurs (en M)` (text), `Description`, `Plan du centre` (file→URL Azure), `Présentation / PROCOS` (file), relations `Ville`, `Gestionnaires`, `Bailleurs`, `Magasins`.
⚠️ `Checked by Make` existe → automatisation Make préexistante à auditer avant déploiement.

### Mapping Offres
Title `Nom` (ex. "Lot Zadig & Voltaire — cession" ou "Terranae — Grand Maine"), `État`="À étudier" (défaut), relation `Magasin` (N), relation `Brokers`, `PDF`/`URL` (lien Azure ou source), `Date`, `Notes`.
Hors scope : `Entreprise`.

---

## 3. Architecture & hébergement

- **Vercel** : fonctions serverless (cron + handlers). Plan permettant les Cron Jobs.
- **Supabase** : table d'état (mails traités, deltaLink Graph, logs de routage). Déjà connecté.
- **Azure Blob Storage** : hébergement des fichiers (PDF offres, plans, photos). Container dédié.
- **Anthropic API** : Haiku (classification), Sonnet (extraction).
- **Microsoft Graph** : lecture mails M365.

### Déclenchement : POLLING DELTA (DÉCIDÉ) — webhook abandonné
**Retenu : polling delta sur cron** (`/messages/delta`), toutes les 5–15 min.
- Avantages : pas d'abonnement à renouveler, pas de validation token, pas d'endpoint public exposé, état = un seul `deltaLink` persistant. Robuste et maintenable (critère prioritaire).
- Quasi temps réel suffisant pour des centaines de mails/semaine.

Alternative documentée : **webhook** (Graph subscriptions). Plus réactif mais 3 fragilités : abonnement expire (~3 j, 4230 min max pour mail) → cron de renouvellement obligatoire ; validation token à renvoyer sous 10 s à la création ; endpoint public. À n'envisager que si la latence devient un vrai besoin.

---

## 4. Structure du repo

```
/
├─ api/
│  ├─ poll.ts            # CRON : delta query Graph → enqueue nouveaux mails → traite
│  ├─ process.ts         # (optionnel) traitement d'un mail isolé (debug/replay)
│  └─ health.ts          # ping/監視
├─ src/
│  ├─ graph/
│  │  ├─ auth.ts         # token client_credentials
│  │  ├─ messages.ts     # delta query, get message, get attachments
│  ├─ extract/
│  │  ├─ router.ts       # dispatch selon format
│  │  ├─ pdf.ts          # PDF → vision (petit) | texte-first (gros)
│  │  ├─ xlsx.ts         # xlsx → CSV/texte
│  │  ├─ html.ts         # corps HTML → texte ; fetch page liée
│  │  └─ attachments.ts  # tri PJ : données vs plans/photos ; matching filename→local
│  ├─ ai/
│  │  ├─ classify.ts     # Haiku : routage
│  │  ├─ extractOffer.ts # Sonnet : JSON structuré (tool use forcé)
│  │  └─ schemas.ts      # schémas JSON (zod) des sorties
│  ├─ notion/
│  │  ├─ client.ts
│  │  ├─ resolve.ts      # resolve-then-create (broker, emplacement)
│  │  ├─ magasins.ts     # création locaux
│  │  ├─ emplacements.ts # création centre
│  │  ├─ offres.ts       # création offre
│  │  └─ propsMap.ts     # mapping JSON → propriétés Notion (IDs)
│  ├─ storage/
│  │  └─ azureBlob.ts    # upload + URL
│  ├─ state/
│  │  └─ supabase.ts     # deltaLink, mails traités, logs
│  └─ config.ts          # env vars typées
├─ docs/
│  ├─ CONTEXTE_PROJET.md
│  └─ ARCHITECTURE.md    # ce fichier
├─ .env.example
├─ vercel.json           # config crons
└─ package.json
```

Dépendances clés : `@azure/storage-blob`, `@anthropic-ai/sdk`, `@notionhq/client`, `xlsx` (SheetJS), `pdf-parse`/`pdfjs`, `node-html-parser`, `zod`, `@supabase/supabase-js`. Auth Graph : fetch direct sur le token endpoint (pas besoin de `@azure/msal-node` pour client_credentials).

---

## 5. Pipeline de traitement (détaillé)

```
poll (cron)
 └─ Graph: GET /users/{mailbox}/mailFolders/inbox/messages/delta?$deltaLink=...
     pour chaque message nouveau :
        ├─ état: déjà traité (messageId) ? → skip
        ├─ garde-fou technique: auto-reply / no-content / interne ? → log "ignoré", marquer traité
        ├─ extract.router(message)
        │    ├─ corps HTML → texte
        │    ├─ PJ: classer données (xlsx/pdf-offre) vs médias (plans/photos)
        │    ├─ xlsx → CSV texte
        │    ├─ pdf offre: <N pages → vision ; gros → texte-first + rasteriser pages utiles
        │    └─ liens dans le corps → fetch page (si pertinent)
        ├─ ai.classify (Haiku) → { route: "offre"|"bruit"|"faible_completude", confiance }
        │    └─ si bruit → log + marquer traité, STOP
        ├─ ai.extractOffer (Sonnet, tool use forcé) → { locaux[], centre?, broker }
        ├─ storage: upload fichiers → URLs ; matching filename→local pour plans/photos
        ├─ notion.resolve broker (email→tél) → brokerPageId
        ├─ notion.resolve/create emplacement (si centre) → emplacementPageId
        ├─ notion.create N magasins (champs + URLs + relations broker/emplacement) → magasinIds[]
        ├─ notion.create offre (relations magasins + broker + liens) → offreId
        └─ état: marquer messageId traité (+ log: route, nb locaux, ids créés)
```

Idempotence : tout est gardé par `messageId`. Un re-run du cron ne recrée rien.

---

## 6. Couche d'extraction multi-format

Le routeur décide par type MIME + extension + taille :
- **Corps mail** : HTML → texte propre (retirer signatures, citations de transfert).
- **xlsx** (SheetJS) : chaque feuille → CSV texte, en-têtes préservés. C'est souvent LE porteur de données (cas Zadig).
- **PDF offre** : si < ~10 pages → envoyer en `document` base64 à Sonnet (vision). Si gros (Terranae, 141 p.) → `pdftotext` d'abord ; envoyer le texte ; rasteriser uniquement les pages identifiées comme plans si besoin visuel.
- **Liens HTML** dans le corps → fetch + extraction texte de la page cible (offres hébergées).
- **Tri des PJ** : distinguer *données* (xlsx, pdf descriptif) des *médias* (plan, photo). Heuristique sur le nom de fichier ("PLAN", "PHOTO", "CODATA") + type.
- **Matching PJ → local** : le filename contient l'identifiant du local ("ANNECY CV SOMMEILLER"). Normaliser (majuscules, sans accents/ponctuation) et matcher contre le `Nom`/adresse de chaque local extrait. Plan → `Plan local/CC`, photo → `Documents`.

---

## 7. Classification / routage (Haiku)

Entrée : objet + expéditeur + texte du corps + liste/aperçu des PJ (noms + 1er extrait texte). Sortie JSON (tool use forcé) :
```json
{ "route": "offre | bruit | faible_completude",
  "type_offre": "location | cession | plaquette_portefeuille | inconnu",
  "confiance": 0.0,
  "raison": "courte justification" }
```
Règles de prompt :
- "offre" = proposition concrète d'un ou plusieurs locaux/lots commerciaux par un bailleur/broker/gestionnaire, avec assez d'info pour créer des fiches.
- "faible_completude" = catalogue/plaquette de portefeuille (centres, surfaces dispo) sans conditions commerciales précises → à traiter mais en enrichissement Centre.
- "bruit" = tout le reste (admin, newsletter, relation client sans bien, etc.).
- Ne jamais inventer ; si incertain, "inconnu" + confiance basse.
- Pas de pré-filtre mots-clés en amont : c'est ici que se fait toute la décision métier.

Seuil : sous une confiance basse, router vers une file "à vérifier manuellement" (État Notion ou label) plutôt que créer/jeter.

---

## 8. Extraction structurée (Sonnet, tool use forcé)

Schéma de sortie (zod côté code) :
```json
{
  "centre": {
    "nom": "string|null", "adresse_complete": "string|null",
    "type_emplacement": "Rue|Office|Retail Park|Pied d'Immeuble|Local commercial|Zone commercial|Centre Commercial|Travel Retail|null",
    "locomotive": "string|null", "superficie_m2": "number|null",
    "surface_hypermarche_m2": "number|null", "flux_visiteurs_M": "string|null",
    "description": "string|null"
  } ,
  "broker": {
    "nom": "string|null", "societe": "string|null",
    "email": "string|null", "telephone": "string|null",
    "source": "expediteur | document"
  },
  "locaux": [
    {
      "nom": "string",
      "adresse_complete": "string|null",
      "type_emplacement": "…|null",
      "surface_rdc": "number|null", "surface_r_moins_1": "number|null",
      "surface_r_plus_1": "number|null", "surface_r_plus_2": "number|null",
      "surface_ponderee": "number|null",
      "loyer_annuel_fixe": "number|null", "loyer_annuel_variable_pct": "number|null",
      "charges_locatives_annuelles": "number|null",
      "droit_au_bail": "number|null", "tf_annuelle": "number|null",
      "duree_ferme": ["3 ans"|"6 ans"|…],
      "date_fin_bail": "YYYY-MM-DD|null", "annee_bail": "string|null",
      "environnement_commercial": "string|null",
      "fichiers": { "plan": "filename|null", "photo": "filename|null" }
    }
  ]
}
```
Règles de prompt :
- Parser les surfaces composées ("98 m² RDC 86 m² R+1") dans les bons champs.
- "En attente" / "non communiqué" / vide → `null`, jamais d'invention.
- Détecter le type (location vs cession) ; `prix de cession` → `droit_au_bail`.
- `environnement_commercial` (enseignes mitoyennes) → ira dans `Notes`.
- Normaliser le téléphone : ne garder que les chiffres.
- Déduire `type_emplacement` du nom si explicite ("CV"→Rue, "CC"→Centre Commercial), sinon null.
- Retourner un objet par local, même pour des dizaines.

---

## 9. Écriture Notion (resolve-then-create)

- **Contact + Broker (deux niveaux)** : query data source **Contacts**, filtre `E-mail` (type email) `equals` contact.email → clé fiable. Si trouvé → remonter au `Broker` lié (créer/lier la société si absente). Si absent → créer Contact (`Nom complet`, `E-mail`, `Portable`, `Rôle/Périmètre`), résoudre/créer Broker (société) par `Nom` normalisé, lier `Contact.Broker`. Puis `Magasin.Brokers` → Broker.
  - ⚠️ **Fallback téléphone** : Notion ne normalise PAS côté serveur ; un filtre `equals` sur `Portable` échoue si les formats diffèrent ("+33 (0)7…" vs "0762…"). Donc le fallback tél = récupérer un jeu de candidats et comparer en CODE après `replace("[^0-9]", "")`. Email = clé exacte ; téléphone = secours best-effort.
  - Règle par défaut : contact d'offre entrante → rattaché à `Broker` (pas `Bailleur`/`Entreprise`), à raffiner si Matthieu catégorise autrement.
- **Emplacement** : pour MVP, matching léger par `Nom` normalisé + `Ville` ; sinon créer. (Le matching robuste est une V2.)
- **Magasins** : création systématique, un par local. Relations : `Emplacement` (si centre), `Brokers`.
- **Offre** : une offre par mail (lot), reliée aux N magasins. (Si Matthieu préfère une offre par local, c'est un paramètre à basculer.)
- **Fichiers** : passer des `external` file objects `{type:"external", external:{url: <azure>}}` dans les propriétés file. (Upload natif Notion possible mais plus lourd ; external URL retenu.)
- Utiliser la version d'API Notion gérant les **data sources** et les `data_source_id` listés au §2.

---

## 10. Stockage Azure Blob

- Container dédié (ex. `offres-uneo`). Un "dossier" logique par mail (`{messageId}/...`).
- Upload via `@azure/storage-blob` `BlockBlobClient.uploadData(buffer)`.
- URL : pour Notion durable, soit container en accès **blob public (lecture seule)**, soit **SAS longue durée**. Décision finale au code. Garder les données de baux dans un container privé + SAS est plus prudent côté confidentialité.
- Conserver l'URL dans `Documents` / `Plan local/CC` (Magasins) et `Plan du centre` (Emplacements).

---

## 11. État & dédoublonnage (Supabase)

Tables :
- `processed_messages` : `message_id` (PK), `processed_at`, `route`, `nb_locaux`, `notion_offre_id`, `status`, `error`.
- `graph_state` : `key` ("inbox_delta"), `delta_link`, `updated_at`.
- `routing_log` : trace des décisions IA (audit, calibrage des prompts).

Le `deltaLink` persistant rend le polling incrémental et idempotent.

---

## 12. Setup Microsoft Azure AD / Entra (manuel, par Théo)

1. Portail Entra → App registrations → New registration (single tenant).
2. Récupérer `client_id`, `tenant_id`. Créer un **client secret** → `client_secret`.
3. API permissions → Microsoft Graph → **Application permissions** → `Mail.Read` + `Mail.ReadWrite` + `Mail.Send` → **Grant admin consent**. (`Mail.ReadWrite` + `Mail.Send` sont nécessaires aux notifications : createReply → PATCH du brouillon → send, avec destinataire forcé sur la boîte connectée.)
4. **Restreindre la portée à la seule boîte** de Matthieu via Application Access Policy (Exchange Online PowerShell : `New-ApplicationAccessPolicy`). Bonne pratique sécurité : sans ça l'app peut lire toutes les boîtes du tenant.
5. Token : `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`, body `grant_type=client_credentials&scope=https://graph.microsoft.com/.default&client_id=…&client_secret=…`.

---

## 13. Variables d'environnement (.env.example)

```
# Microsoft Graph
MS_TENANT_ID=
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_MAILBOX=matthieu@uneo-retail.com
# Anthropic
ANTHROPIC_API_KEY=
MODEL_CLASSIFY=claude-haiku-...
MODEL_EXTRACT=claude-sonnet-...
# Notion
NOTION_TOKEN=
NOTION_DS_OFFRES=
NOTION_DS_MAGASINS=
NOTION_DS_EMPLACEMENTS=
NOTION_DS_BROKERS=
# Azure Blob
AZURE_STORAGE_CONNECTION_STRING=
AZURE_BLOB_CONTAINER=offres-uneo
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
```

---

## 14. Risques & points ouverts

1. ~~Make préexistant~~ : RÉSOLU — plus aucune automatisation Make branchée (ancien crash test abandonné). `Checked by Make` est un résidu inerte.
2. **Broker vs Bailleur** : au niveau Contact, une personne peut être liée à Broker / Bailleur / Entreprise. Règle par défaut MVP : offre entrante → Broker. À confirmer avec Matthieu pour les gros gestionnaires (Terranae : Broker ou Bailleur ?).
3. ~~DB Contacts~~ RÉSOLU : `E-mail` + `Portable` + `Nom complet` présents. Matching = email exact, tél en fallback code-side.
4. **1 offre/N magasins vs N offres** : retenu 1 offre par lot ; basculable.
5. **Confidentialité fichiers** : container Azure privé + SAS recommandé pour des données de baux.
6. **Coût Sonnet sur gros PDF** : texte-first limite la casse ; surveiller.
7. **Faux positifs/négatifs de routage** : prévoir une file "à vérifier" + logs pour calibrer les prompts sur données réelles.
8. **Type exact `PDF`/`URL` de la DB Offres** (file ou url) : à vérifier pour le mapping.
