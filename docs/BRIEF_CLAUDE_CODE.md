# Brief Claude Code — Automatisation extraction d'offres immobilières → Notion

> Document d'exécution destiné à Claude Code. Lis-le entièrement avant d'écrire la moindre ligne.
> Compléments : `CONTEXTE_PROJET.md` (historique des décisions) et `ARCHITECTURE.md` (détail technique).
> Client final : Uneo Retail (Matthieu Duquesnoy). Développeur : Théo Gouman.

---

## 0. Comment utiliser ce brief (méta-instructions)

1. **Build phasé.** Construis dans l'ordre de la §7, et valide chaque phase contre ses critères AVANT de passer à la suivante. Ne génère pas tout le système d'un coup.
2. **Les cas de test sont la définition de "correct".** Le système est réussi quand il produit les sorties attendues sur les exemples réels (§11). Tu dois pouvoir t'auto-vérifier dessus.
3. **Les décisions de ce brief sont prises — ne les réinvente pas.** Le stack, le modèle de données, les règles de routage et d'extraction sont arrêtés. Ne propose pas Make, ni webhook, ni un autre modèle de données.
4. **Les points marqués « À VALIDER » ne sont pas tranchés** : applique la valeur par défaut indiquée et signale-la, ne décide pas silencieusement autre chose.
5. **Priorité absolue : la qualité de compréhension des mails.** Mieux vaut rejeter proprement un mail (avec notification) que créer une fiche fausse. Un faux positif pollue la base du client ; c'est le pire résultat.

---

## 1. Contexte & objectif

Uneo Retail est un intermédiaire en immobilier commercial. Sa boîte Outlook (Microsoft 365) reçoit plusieurs centaines de mails/semaine. Une minorité sont des **offres** : des brokers (agents, bailleurs, gestionnaires d'actifs nationaux) qui proposent des locaux commerciaux à louer/céder. Aujourd'hui Matthieu recopie manuellement ces offres dans Notion.

**Objectif** : automatiser la détection des offres et leur centralisation structurée dans Notion, sans intervention manuelle. Le système tourne en routine, lit les nouveaux mails, comprend lesquels sont des offres, en extrait les informations, et crée les pages Notion reliées entre elles.

Caractéristiques du flux réel :
- **1 mail → 1 à N locaux** (un broker propose souvent un lot de plusieurs locaux, dans un ou plusieurs centres).
- **Complétude variable** : d'une offre chiffrée complète (loyer, surfaces, prix de cession) à un catalogue de disponibilités (surfaces seules).
- **Formats variés** : données dans le corps du mail, dans un PDF joint, dans un xlsx joint, ou derrière un lien hypertexte. Signatures parfois en image.

---

## 2. Stack & contraintes techniques

- **Hébergement/exécution** : fonctions serverless **Vercel**, **Node.js + TypeScript**.
- **Déclenchement** : **polling delta Microsoft Graph** sur **cron Vercel** (toutes les 5–15 min). PAS de webhook (abandonné pour la maintenabilité : abonnement qui expire, validation token, endpoint public — trois fragilités évitées).
- **Lecture mails** : **Microsoft Graph API** (boîte Outlook M365), auth OAuth client_credentials (app daemon).
- **IA** : **API Anthropic**. Haiku pour la classification/routage, Sonnet pour l'extraction structurée. PDF et images lus en **vision native** (pas de service OCR tiers).
- **Stockage fichiers** : **Azure Blob Storage** (reste dans l'écosystème Microsoft, cohérent confidentialité des baux).
- **État & dédoublonnage** : **Supabase**.
- **Notion** : SDK officiel `@notionhq/client`, version d'API gérant les **data sources**.

Dépendances : `@anthropic-ai/sdk`, `@notionhq/client`, `@azure/storage-blob`, `@supabase/supabase-js`, `xlsx` (SheetJS), `pdf-parse` ou `pdfjs-dist`, `node-html-parser`, `zod`. Auth Graph : fetch direct sur le token endpoint (pas besoin de `@azure/msal-node`).

---

## 3. Modèle de données Notion (cible d'écriture)

### Hiérarchie
```
Emplacements (CENTRE, parent)            ← créé seulement si l'offre concerne un centre
   └─ Magasins (LOCAL, enfant)           ← relation Emplacement ↔ Magasins ; 1 page par local
         ├─ Offres                        ← relation Offres ↔ Magasin (1 offre ↔ N magasins)
         └─ Brokers (SOCIÉTÉ)             ← relation Brokers ↔ Magasin
               └─ Contacts (PERSONNE)     ← relation Brokers ↔ Contacts ; email/tél ICI
```

### Data source IDs (à utiliser tels quels)
- Offres : `29b545f7-7d1b-80db-87c4-000b800d1928`
- Magasins : `29a545f7-7d1b-8198-8c48-000b58d15f80`
- Emplacements : `29a545f7-7d1b-8126-a235-000b671734c4`
- Brokers : `29a545f7-7d1b-8042-a782-000b9e431263`
- Contacts : `29a545f7-7d1b-80ba-b5bc-000bb889c53a`
- Villes : `29a545f7-7d1b-80d2-a35c-000ba4ede17a`

### Ordre de création (enfants d'abord pour disposer des IDs à relier)
1. Résoudre/créer **Contact** (matching email exact → fallback tél normalisé en code) → remonter/créer le **Broker** (société) lié.
2. Résoudre/créer **Emplacement** (centre) si l'offre est dans un centre.
3. Créer les **N Magasins** (un par local), reliés à Emplacement + Broker.
4. Créer l'**Offre**, reliée aux N Magasins + Broker.
5. Marquer le mail traité (Supabase) + envoyer le mail de confirmation.

### Mapping Magasins (champs écrits par l'IA)
| Champ Notion | Type | Source / règle |
|---|---|---|
| `Nom` | title | Adresse complète si connue, sinon titre concis identifiable (ex. « Paris IX - Realtyz ») |
| `Adresse complète` | text | adresse du local |
| `Surface RDC` | number | surface rez-de-chaussée |
| `Surface R-1` | number | sous-sol |
| `Surface R+1 ` | number | 1er étage (⚠️ espace final dans le nom de propriété) |
| `Surface R+2` | number | 2e étage |
| `Surface Pondérée` | number | surface au bail / surface totale ; **si une seule surface connue → ici** |
| `Loyer annuel fixe` | number € | « Loyer annuel », « Loyer pur annuel », « Loyer HT HC » |
| `Loyer annuel variable` | number % | si présent |
| `Charges locatives annuelle` | number € | charges |
| `Droit au bail` | number € | « PRIX DE CESSION » (cas cession) |
| `TF annuelle` | number € | « Taxe foncière », « Foncier » |
| `Type d'Emplacement` | select | Rue / Retail Park / Centre Commercial / Pied d'Immeuble / Zone commercial / Office / Local commercial / Gare. L'IA choisit le tag le plus proche (« Rue commerçante » → Rue ; « CV » → Rue ; « CC » → Centre Commercial) |
| `Durée ferme` | multi-select | 1/3/4/6/10/12 ans ; peut en avoir plusieurs |
| `Date de fin de bail` / `Next Notice` / `Next BO` | date (DD/MM/YYYY) | « En attente »/non communiqué → laisser VIDE |
| `Année du bail` | text | si présent |
| `Notes` | text | déversoir : environnement commercial (enseignes mitoyennes) + toute donnée sans propriété dédiée, **telle quelle, sans reformulation** |
| `Documents` | file (URL Azure) | photo / doc du local |
| `Plan local/CC` | file (URL Azure) | plan du local |
| `Brokers` | relation | société broker résolue |
| `Offres` | relation | offre créée |
| `Emplacement` | relation | centre parent (si applicable) |

**Surfaces — règle stricte** : n'extraire que RDC / R-1 / R+1 / R+2 (+ total → Pondérée). **« Surface de vente » → IGNORER.**

**NE PAS écrire** : formules (`Loyer au m²`, `Group`), `Occupant`, `Enseigne(s) concernée(s)`, relations internes (`Gestionnaire`, `Bailleur`, `Pays`, `Zone de Chalandise`, `Historique des Loyers`), champs internes client (`Mission Uneo`, `Type de mission`, `CA occupant HT `, `Fond Marketing`, `Historique Mission`, `Sélectionner`). La relation `Ville` est best-effort (recherche-puis-crée), non bloquante.

### Mapping Emplacements (centre — seulement si l'offre concerne un centre commercial)
`Nom` (title), `Adresse complète` (text), `Type d'emplacement` (select), `Locomotive` (select), `Superficie m² ` (number, GLA), `Surface m² hypermarché` (number), `Flux visiteurs (en M)` (text), `Description` (text), `Total Magasins` (number, « dont X boutiques »), `Plan du centre` (file→URL Azure), relations `Ville` / `Gestionnaires` / `Bailleurs` (best-effort), `Magasins`.

### Mapping Offres
`Nom` (title : libellé du lot, ex. « Lot Zadig & Voltaire — cession » ou adresse si local unique), `État` = **« À étudier »** (défaut), `Magasin` (relation, N), `Brokers` (relation), `PDF` / `URL` (lien Azure ou source — À VALIDER type exact), `Date` (date de réception du mail), `Notes` (text). `Entreprise` : HORS SCOPE, laisser vide.

### Mapping Contacts
`Nom complet` (title), `E-mail` (email), `Portable` (phone_number — **préférer mobile 06… au fixe 02…**), `Rôle/Périmètre` (text), `Adresse Postale` (text), relation `Broker` (la société ; PAS `Entreprise` ni `Bailleur` pour ce flux).

### Mapping Brokers (société)
`Nom` (title : nom propre de la société, déduit/nettoyé d'une URL si besoin — `www.icg-commerce.fr` → « ICG Commerce »), relation `Contacts`, relation `Magasins`, relation `Offres`.

---

## 4. Règles de décision & d'extraction

### 4.1 Offre vs bruit : DÉTECTION D'INTENTION
Le signal n'est pas un mot isolé mais un **pattern d'intention** : « un broker me propose un local commercial à louer/céder ». Registre stable, distinct d'un prestataire qui envoie une facture, d'une newsletter, d'un échange administratif.

Ancres lexicales typiques (exemples pour le prompt, pas filtre rigide) : « un bien », « susceptible de correspondre à votre recherche / à vos critères », « proposition de dossier », « dossier de présentation », « présentation de locaux », « Ci-joint » (signale un PDF à lire).

### 4.2 Routage (sortie de la classification Haiku)
- `offre` : proposition exploitable d'un ou plusieurs locaux → pipeline complet.
- `faible_completude` : catalogue/plaquette de portefeuille (centres, surfaces dispo, peu/pas de conditions) → traiter en enrichissement (créer Emplacement + Magasins avec ce qu'on a).
- `bruit` : tout le reste → ne rien créer.

### 4.3 Comportement traiter-ou-rejeter (PAS de file « à vérifier »)
- **Traité avec succès** → créer les pages + envoyer un mail **à soi-même** (le propriétaire de la boîte connectée, PAS l'expéditeur d'origine), en réponse au fil : 
  > « Cette offre a été traité par le système Notion, elle est disponible sur cette page »
  (inclure le lien vers la page Offre créée).
- **Non traitable** (bruit, info insuffisante, format impossible, doute sérieux) → ne rien créer + mail **à soi-même** :
  > « Le système Notion ne peut pas traiter le format de ce mail. »

### 4.4 Règles d'extraction fines
- **« Surface de vente » → IGNORER** ; n'extraire que RDC/R-1/R+1/R+2 + total→Pondérée.
- Une seule surface m² connue → `Surface Pondérée`.
- **Téléphone : préférer le 06 (mobile)** au 02/autres (fixe/standard) quand plusieurs numéros.
- **Signature en image** (JPG/embed) → lire via vision Claude.
- **Offre en lien hypertexte** (pas de PJ) → suivre le lien, lire la page cible.
- **« Ci-joint »** → il y a un PDF à lire.
- **URL société** → déduire le nom propre du Broker.
- **Centre commercial** → créer Emplacement (avec `Total Magasins`) + Magasin(s) enfant(s).
- Loyer cible = **annuel HT/HC**. Taxe foncière → `TF annuelle`.
- Donnée sans propriété dédiée → `Notes`, **sans reformulation**.
- **Ne jamais inventer** : champ absent/illisible → null/vide.

### 4.5 Multi-local
Un mail peut contenir des dizaines de locaux (cas Zadig : 7 dans un xlsx). L'extraction renvoie un **tableau de locaux**. Boucle de création : N Magasins, tous reliés à une même Offre (1 offre par lot — À VALIDER vs 1 offre/local).

### 4.6 Rattachement des pièces jointes au bon local
Quand plusieurs PJ (plans, photos) pour plusieurs locaux : matcher par **nom de fichier** (ex. « ANNECY CV SOMMEILLER ») contre le local. Normaliser (majuscules, sans accents/ponctuation). Plan → `Plan local/CC` ; photo → `Documents`.

### 4.7 Dédoublonnage
Stocker le `messageId` Graph dans Supabase. Vérifier avant tout traitement ; ne jamais retraiter un mail déjà traité (relances, copies).

---

## 5. Architecture du code

### Structure du repo
```
/
├─ api/
│  └─ poll.ts            # CRON : delta query Graph → traite chaque nouveau mail
├─ src/
│  ├─ graph/             # auth.ts, messages.ts (delta, get message, attachments)
│  ├─ extract/           # router.ts, pdf.ts, xlsx.ts, html.ts, link.ts, attachments.ts
│  ├─ ai/                # classify.ts (Haiku), extract.ts (Sonnet), schemas.ts (zod), prompts/
│  ├─ notion/            # client.ts, resolve.ts, magasins.ts, emplacements.ts, offres.ts, brokers.ts, contacts.ts, propsMap.ts
│  ├─ storage/           # azureBlob.ts
│  ├─ mail/              # reply.ts (notifications succès/échec)
│  ├─ state/             # supabase.ts (deltaLink, processed_messages, logs)
│  └─ config.ts
├─ tests/fixtures/       # mails d'exemple réels (Zadig, Terranae, + 5 du Canva)
├─ docs/                 # CONTEXTE_PROJET.md, ARCHITECTURE.md, ce brief
├─ .env.example
├─ vercel.json           # cron config
└─ package.json
```

### Pipeline (api/poll.ts)
```
1. Graph: GET /users/{mailbox}/mailFolders/inbox/messages/delta (depuis deltaLink Supabase)
2. pour chaque nouveau message :
   a. déjà traité (messageId) ? → skip
   b. garde-fou technique : auto-reply / sans contenu ? → log, marquer traité, stop
   c. extract.router → { corpsTexte, pdfs[], xlsx[], liens[], medias[] }
   d. ai.classify (Haiku) → { route, type_offre, confiance, raison }
      - bruit → mail d'échec, log, marquer traité, stop
   e. ai.extract (Sonnet, tool use forcé) → { centre?, broker, locaux[] }
      - si extraction vide/incohérente → mail d'échec, log, stop
   f. storage : upload fichiers → URLs ; matcher fichiers→locaux
   g. notion.resolve contact→broker ; emplacement (si centre)
   h. notion.create N magasins ; create offre
   i. mail de succès (lien page) ; marquer traité ; logguer
3. persister le nouveau deltaLink
```

### Couche extraction multi-format (déterministe, hors IA)
- corps HTML → texte (retirer citations de transfert, signatures dupliquées).
- xlsx (SheetJS) → CSV texte par feuille.
- PDF : < ~10 pages → passer en base64 à Sonnet (vision) ; gros PDF (100+ p.) → `pdftotext` d'abord, rasteriser seulement les pages utiles (plans).
- liens → fetch + extraction texte de la page.
- tri PJ : données (xlsx, pdf descriptif) vs médias (plan, photo) par nom + type.

---

## 6. Prompts IA

### 6.1 Classification (Haiku) — sortie via tool use forcé
Entrée : expéditeur, objet, corps texte, liste des PJ (noms + 1er extrait).
Sortie :
```json
{ "route": "offre|faible_completude|bruit",
  "type_offre": "location|cession|plaquette_portefeuille|inconnu",
  "confiance": 0.0,
  "raison": "courte justification" }
```
Le prompt explicite la détection d'intention (§4.1), les ancres lexicales, et exige « inconnu » + confiance basse en cas de doute (jamais d'invention).

### 6.2 Extraction (Sonnet) — sortie via tool use forcé
Schéma (zod) :
```json
{
  "centre": { "nom": null, "adresse_complete": null, "type_emplacement": null,
              "locomotive": null, "superficie_m2": null, "surface_hypermarche_m2": null,
              "flux_visiteurs": null, "description": null, "total_magasins": null },
  "broker": { "societe": null, "societe_url": null,
              "contact": { "nom_complet": null, "email": null, "telephone": null,
                           "role": null, "adresse_postale": null, "source": "expediteur|document" } },
  "locaux": [ {
     "nom": "string", "adresse_complete": null, "type_emplacement": null,
     "surface_rdc": null, "surface_r_moins_1": null, "surface_r_plus_1": null,
     "surface_r_plus_2": null, "surface_ponderee": null,
     "loyer_annuel_fixe": null, "loyer_annuel_variable_pct": null,
     "charges_locatives_annuelles": null, "droit_au_bail": null, "tf_annuelle": null,
     "duree_ferme": [], "date_fin_bail": null, "annee_bail": null,
     "environnement_commercial": null,
     "fichiers": { "plan": null, "photo": null }
  } ]
}
```
Le prompt encode toutes les règles fines (§4.4), le parsing des surfaces composées (« 98 m² RDC 86 m² R+1 »), l'exclusion de « surface de vente », la préférence mobile, et l'interdiction d'inventer.

---

## 7. Plan de build phasé (valider chaque phase avant la suivante)

**Phase 0 — Setup.** Repo, TypeScript, deps, `.env.example`, `config.ts` typé, `vercel.json` (cron). *Done quand : le projet compile et un endpoint health répond.*

**Phase 1 — Extraction multi-format (déterministe, sans IA).** Router + xlsx→CSV + pdf→texte/vision + html + fetch lien + tri PJ. *Done quand : sur les fixtures Zadig et Terranae, le système sort le texte/CSV correct et la liste des fichiers triés, vérifiable à l'œil.*

**Phase 2 — IA classification + extraction (LE CŒUR).** Prompts Haiku + Sonnet, schémas zod, tool use forcé. Tester sur les fixtures. *Done quand : Zadig → 7 locaux avec les chiffres attendus (§11) ; Terranae → route « faible_completude » + 1 centre + locaux ; les 5 exemples du Canva produisent le mapping attendu. AUCUN mail hors-sujet ne doit passer en « offre ».* C'est ici que se joue le risque « crash test » — ne pas avancer tant que ce n'est pas fiable.

**Phase 3 — Écriture Notion (sandbox).** resolve-then-create (contact→broker, emplacement), création magasins + offre, relations. Sur une copie de test des DB. *Done quand : un local de test crée les bonnes pages reliées, sans toucher aux champs interdits.*

**Phase 4 — Azure Blob.** Upload fichiers → URLs → propriétés file Notion. *Done quand : un PDF se retrouve accessible via l'URL dans la page Notion.*

**Phase 5 — Graph polling + état Supabase.** Auth, delta query, deltaLink persistant, dédoublonnage. *Done quand : un nouveau mail réel déclenche le pipeline une seule fois, et un re-run ne recrée rien.*

**Phase 6 — Notifications + bout-en-bout.** Mails succès/échec à soi-même. Test end-to-end sur la vraie boîte. *Done quand : un mail d'offre réel produit les pages + le mail de confirmation ; un mail de bruit produit le mail d'échec et rien dans Notion.*

---

## 8. Setup Microsoft Azure / Entra (manuel, fait par Théo)
1. Entra → App registrations → New registration (single tenant). Récupérer `client_id`, `tenant_id`.
2. Créer un client secret → `client_secret`.
3. API permissions → Microsoft Graph → **Application permissions** → `Mail.Read` (+ `Mail.Send` pour les notifications) → **Grant admin consent**.
4. Restreindre la portée à la seule boîte de Matthieu via **Application Access Policy** (Exchange Online PowerShell : `New-ApplicationAccessPolicy`).
5. Token : `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` (`grant_type=client_credentials`, `scope=https://graph.microsoft.com/.default`).

## 9. Variables d'environnement
```
MS_TENANT_ID= / MS_CLIENT_ID= / MS_CLIENT_SECRET= / MS_MAILBOX=matthieu@uneo-retail.com
ANTHROPIC_API_KEY= / MODEL_CLASSIFY=claude-haiku-... / MODEL_EXTRACT=claude-sonnet-...
NOTION_TOKEN= / NOTION_DS_OFFRES= / NOTION_DS_MAGASINS= / NOTION_DS_EMPLACEMENTS= / NOTION_DS_BROKERS= / NOTION_DS_CONTACTS= / NOTION_DS_VILLES=
AZURE_STORAGE_CONNECTION_STRING= / AZURE_BLOB_CONTAINER=offres-uneo
SUPABASE_URL= / SUPABASE_SERVICE_KEY=
```

## 10. Points À VALIDER (appliquer le défaut, signaler, ne pas décider seul)
1. **1 offre par lot** (défaut) vs 1 offre par local. À confirmer selon l'usage de Matthieu.
2. **Container Azure privé + URL SAS longue durée** (défaut, recommandé pour données de baux) vs public lecture.
3. **Type exact des propriétés `PDF` / `URL`** de la DB Offres (file vs url) — vérifier via fetch du schéma avant d'écrire.

## 11. Cas de test de référence

**Zadig & Voltaire (offre cession, xlsx, 7 locaux).** Broker = Marcle Immobilier (Jean Nocentini, marcleimmobilier@orange.fr, 06 09 50 18 61). Attendu : route `offre`/type `cession`, 7 Magasins :
| Nom | Adresse | RDC | R±/Pondérée | Loyer fixe € | Droit au bail € |
|---|---|---|---|---|---|
| Annecy | 15 rue Sommeiller | 86 | 115 | 33 224 | 350 000 |
| Boulogne | 67 Bd Jean Jaurès | 98 | R+1 86 / 258 | 304 506 | 50 000 |
| Paris Femme | 1 Vieux Colombier | 75 | 93,5 | 134 300 | 400 000 |
| Paris Homme | 3 Vieux Colombier | 61 | 79 | 170 620 | 200 000 |
| Paris Turenne | 20-22 rue de Turenne | 151 | R-1 53 / 256 | 334 900 | 1 000 000 |
| Paris Grenelle | 77 rue des St Pères | 73 | R+1 108 / 132+47 | 372 050 | 300 000 |
| CC Parly 2 | Le Chesnay | 110 | 116 | 343 200 | 100 000 |
Échéances bail = « En attente » → vide. 16 PJ (plans/photos CODATA, 2/magasin) → rattacher par nom.

**Terranae (plaquette portefeuille, PDF 141 p.).** Expéditrice Virginie Lainé (vlaine@terranae.com), contacts par actif dans le doc. Attendu : route `faible_completude`, ~50 Emplacements (centres) avec GLA/locomotive/flux/nb boutiques, locaux dispo sans prix → `Surface Pondérée`. Ne PAS forcer des prix absents.

**5 exemples du Canva** (à récupérer en fichiers réels pour les fixtures) : Paris IX/Realtyz (loyer 90k/an, surfaces RDC 110/R+1 18/R-1 65/total 193) ; Villeneuve-d'Ascq (offre en lien hypertexte, pas de PDF — suivre le lien) ; cas « Surface de vente » à ignorer + « Emplacement : Rue commerçante » → Rue ; Centre Commercial Rocadest (36 boutiques, local dispo 675m²) ; Laval/ICG Commerce (signature en image → OCR, 2 numéros → prendre le 06, URL → société).

**Critère transverse anti-crash-test** : un mail de facture, une newsletter, une relance administrative → route `bruit`, rien créé, mail d'échec. Zéro faux positif toléré sur ces cas.
