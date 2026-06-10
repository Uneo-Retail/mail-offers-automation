# Automatisation — Détection & centralisation d'offres immobilières commerciales dans Notion

> Fichier de contexte. Résume toutes les décisions et données à conserver. À relire en cas de perte de contexte.
> Client : Uneo Retail (Matthieu Duquesnoy, co-founder). Dev : Théo Gouman.

---

## 1. Le client et le besoin

Uneo Retail est un **intermédiaire en immobilier commercial**. Reçoit par mail (boîte Outlook/M365 `matthieu@uneo-retail.com`) des **propositions de locaux/lots commerciaux** envoyées par des **brokers**, qui sont en réalité souvent des **bailleurs/gestionnaires d'actifs nationaux** gérant des dizaines de contrats. Métier : mettre ces biens en relation avec ses clients commerçants.

Problème : **plusieurs centaines de mails/semaine**, minorité de vraies offres, traitement manuel. Objectif : **automatiser** détection + **centralisation dans Notion**, sans intervention manuelle.

### Nature des offres (IMPORTANT — révisé après exemples réels)
Ce n'est PAS "1 mail = 1 local". C'est **un pipeline avec deux variables** :
- **Taille du lot** : 1 à N emplacements par mail (souvent plusieurs dizaines). Un bailleur propose un lot, dans un ou plusieurs centres.
- **Complétude de la donnée** : d'une offre chiffrée complète (prix, loyer, cession) à un catalogue de disponibilités (surfaces seules, sans prix).

→ Les deux exemples fournis (Zadig = offre chiffrée ; Terranae = plaquette portefeuille) NE sont PAS deux problèmes distincts : c'est le même pipeline à complétude variable. **Les deux sont dans le scope du MVP** (décision Théo : data régulière, représentative du lot restreint communiqué par le client, à ne pas louper).

### Hors scope automatisation
- **Entreprise / Occupant / Enseigne exploitante finale** : inconnue à la réception, renseignée manuellement plus tard lors de la mise en relation. L'automatisation laisse vide.

### Formes d'entrée des données (toutes à gérer)
- PDF joint (offre) → **vision Claude** (natif)
- **XLSX joint** (cas Zadig : la donnée chiffrée est dans l'Excel, pas le PDF) → **conversion texte/CSV avant envoi au modèle** (Claude ne lit PAS le xlsx en vision)
- Corps HTML du mail → texte
- Lien HTML vers page → fetch
- **Gros PDF 100+ pages** (cas Terranae : 141 p., 14 Mo) → **texte d'abord** (couche texte présente), rasteriser seulement les pages utiles (plans). Ne pas envoyer 141 pages en vision (coût/poids).

---

## 2. Décisions d'architecture (validées)

### Stack : code sur Vercel, PAS Make
- Refus de Make.com : non maintenable full-IA, multi-format ingérable, connecteurs tiers fragiles.
- **Fonctions serverless Node/TypeScript sur Vercel**, écrites/maintenues par IA. SDK officiels versionnés, Git pour historique/rollback.
- Optionnel : page HTML de dashboard (statut, scan manuel, logs).
- ⚠️ Pas "full HTML" : une page statique ne peut pas lire une boîte mail. Le cœur est backend serverless.

### Source mail : Microsoft Graph (pas Google)
- Boîte **Outlook / Microsoft 365** (compte entreprise payant, accès admin OK).
- Auth **OAuth Azure AD / Entra ID**, mode **application/daemon** (client_credentials), permissions application **`Mail.Read` + `Mail.ReadWrite` + `Mail.Send`** + **consentement admin** (ReadWrite + Send pour les notifications dans le fil).
- Enregistrement app Azure = fait manuellement par Théo le moment venu (guide pas-à-pas à fournir). L'IA ne fait pas les clics portail Azure.

### Déclenchement : polling delta sur cron (DÉCIDÉ — webhook abandonné)
- **Graph `/messages/delta`** sur cron (5–15 min) → récupère les nouveaux mails de façon incrémentale.
- Choix motivé par la maintenabilité : pas d'abonnement à renouveler, pas de validation token, pas d'endpoint public exposé. État = un seul `deltaLink` persistant.
- Webhook (Graph subscriptions) abandonné : plus réactif mais 3 fragilités (abonnement expire ~3 j → cron de renouvellement, validation token sous 10 s, endpoint public).

### Classification : full IA, et c'est un ROUTAGE (pas binaire)
- Volume centaines/semaine, beaucoup de bruit. Coût IA négligeable.
- Pas de pré-filtre mots-clés (jugé non fiable). Décision 100 % IA.
- Garde-fou technique minimal : ignorer auto-replies, notifs internes, mails sans contenu exploitable (traçabilité, pas économie).
- ⚠️ La classification n'est PAS "offre oui/non". C'est un **routage** : offre exploitable / bruit / (et reconnaître les cas à faible complétude type plaquette pour les traiter correctement, pas les massacrer).
### Distinguer offre vs bruit : DÉTECTION D'INTENTION (confirmé Théo + Canva)
- Le signal n'est pas un mot isolé mais un **pattern d'intention** : « un broker me propose un local commercial à louer ». Un broker mobilise toujours le même registre, radicalement différent d'un prestataire qui envoie une facture.
- **Ancres lexicales typiques** (à donner au prompt comme exemples, pas comme filtre rigide) : « un bien », « susceptible de correspondre à votre recherche / à vos critères », « proposition de dossier », « dossier de présentation », « présentation de locaux », « Ci-joint » (= PDF à lire).
- Le prompt Haiku reconnaît cette intention ; pas de pré-filtre mots-clés mécanique.

### Pipeline IA 2 étages
- **Haiku** classifie/route (intention offre / bruit) → **Sonnet** extrait (JSON strict) sur les positifs.
- API Anthropic : OK, aucun blocage RGPD (client a déjà utilisé l'API OpenAI).

### Comportement sur mail traitable vs non traitable (CONFIRMÉ par brief client)
Modèle binaire, PAS de file "à vérifier" :
- **Traité avec succès** → créer les pages Notion + envoyer un mail **à soi-même** (propriétaire de la boîte connectée, pas l'expéditeur) : « Cette offre a été traité par le système Notion, elle est disponible sur cette page ».
- **Non traitable** (info manquante, format impossible, ambigu) → ne rien créer + mail **à soi-même** : « Le système Notion ne peut pas traiter le format de ce mail. ».

### Règles métier explicites (CONFIRMÉES par brief client)
- Donnée sans propriété dédiée OU pas dans le bon format → tout mettre dans `Notes` **tel quel, sans reformulation par l'IA**.
- Une seule surface m² connue → la traiter comme surface totale → `Surface Pondérée`.
- Titre de page = adresse complète si connue, sinon titre concis et identifiable (ex. « Paris IX - Realtyz »).
- Info principalement dans des PDF → OCR fiable indispensable (couvert par vision Claude).

### Règles d'extraction fines (issues du Canva des 5 exemples)
- **« Surface de vente » → IGNORER.** N'extraire que les surfaces par niveau : `Surface RDC` / `Surface R-1` / `Surface R+1` / `Surface R+2`. La surface totale (si seule connue) → `Surface Pondérée`.
- **Téléphone : préférer le mobile (06…) au fixe (02…).** Deux numéros dans une signature → le 06 est celui de la personne (Contact), pas le standard.
- **Signatures parfois en image** (JPG / embed, pas du texte) → OCR via vision Claude.
- **Offres parfois en lien hypertexte** (pas de PJ) → suivre le lien et lire la page cible.
- **URL de société** (ex. `www.icg-commerce.fr`) → en déduire le nom propre (« ICG Commerce ») → page Broker.
- **Cas centre commercial** → créer la page Centre dans Emplacements (avec nombre de boutiques → `Total Magasins`) ; le local dispo → `Surface Pondérée` du Magasin enfant.
- Loyer recherché = **annuel HT/HC** (« Loyer annuel », « Loyer pur annuel ») → `Loyer annuel fixe`. Taxe foncière (« Foncier », « Taxe foncière ») → `TF annuelle`.

### Dédoublonnage
- **ID message Graph** stocké → **Supabase** (déjà connecté) ou table Notion. Vérifier avant création (relances/copies).

### Stockage fichiers (PDF/plans/photos)
- **Azure Blob Storage** (reste écosystème Microsoft, cohérent RGPD). Upload via `@azure/storage-blob` depuis Vercel → URL → propriété `Documents` Notion.
- ⚠️ Propriété `file` Notion via API : préférer **URL externe hébergée**. Container public lecture vs SAS longue durée → à trancher au code (pour Notion durable, plutôt public lecture sur container dédié).

---

## 3. Résolution d'entités (relations Notion)

Principe : **recherche-puis-crée** (query API Notion avec filtre, créer si absent, lier).

- **Magasin / local** → **création systématique** (1 page par local, pas de matching). 1 mail → N pages Magasin liées à l'offre. Doublons assumés MVP.
- **Broker** → entité **SOCIÉTÉ** (Marcle Immobilier, Terranae), pas une personne. DB Brokers = `Nom` + relations seulement (pas d'email/tél). Les personnes sont dans **Contacts** (`collection://29a545f7-7d1b-80ba-b5bc-000bb889c53a`) : `Nom complet` (title), `E-mail` (email), `Portable` (phone_number), `Rôle/Périmètre`, `Adresse Postale`, + relations `Broker`/`Bailleur`/`Entreprise` (un contact peut être lié à l'un des trois).
  - Résolution 2 niveaux : matching sur **Contacts** par `E-mail` (clé exacte) → remonter/créer le Broker (société) → lier Magasin→Broker. Défaut MVP : offre entrante → Broker.
  - ⚠️ Fallback tél : Notion ne normalise pas côté serveur → comparer en CODE après `replace("[^0-9]", "")` (pas de filtre API exact). Email = clé fiable, tél = secours.
  - Source du contact selon doc : offre simple (Zadig) = expéditeur (`from`) ; plaquette (Terranae) = contact par actif dans le document.
- **Entreprise / Occupant** → HORS SCOPE, vide.
- **Centre commercial (niveau parent)** → ⚠️ MODÉLISATION À TRANCHER, voir §6.
- Autres relations (Gestionnaire, Bailleur, Ville, Pays, Zone de Chalandise) → best effort / manuel, pas prioritaire MVP.

---

## 4. DB Notion cible

### DB "Offres"
`Nom` (title), `Magasin` (relation → Magasins, accepte PLUSIEURS), `Date` (date), `Entreprise` (relation, hors scope), `Notes` (text), `État` (select — défaut « À étudier »), `Brokers` (relation), `Créée par` (auto), `Date de création` (auto), `PDF`, `URL`.
- Confirmé : on peut lier plusieurs magasins à une offre, et il faut créer un item par local.

### DB "Magasins" — `collection://29a545f7-7d1b-8198-8c48-000b58d15f80`
**Remplissables par extraction IA :**
- `Nom` (title), `Adresse complète` (text)
- `Surface RDC` / `Surface R-1` / `Surface R+1 ` / `Surface R+2` (number) — parser surfaces composées ("98 RDC + 86 R+1")
- `Surface Pondérée` (number) ← "SURFACE AU BAIL"
- `Loyer annuel fixe` (number €) ← "Loyer HT HC"
- `Loyer annuel variable` (number %)
- `Charges locatives annuelle` (number €)
- `Droit au bail` (number €) ← "PRIX DE CESSION" (cas cession)
- `TF annuelle` (number € — taxe foncière)
- `Type d'Emplacement` (select : Rue / Retail Park / Centre Commercial / Pied d'Immeuble / Zone commercial / Office / Local commercial / Gare). Déductible : "CV"=centre-ville→Rue, "CC"=Centre Commercial.
- `Durée ferme` (multi-select : 1/3/4/6/10/12 ans)
- `Date de fin de bail` / `Next Notice` / `Next BO` (dates DD/MM/YYYY) — "En attente"/non communiqué → vide
- `Année du bail` (text)
- `Notes` (text — déversoir, ex. environnement/enseignes mitoyennes "SITUATION")
- `Documents` (file → URL Azure), `Plan local/CC` (file → URL Azure)
- `Brokers` (relation → matching), `Offres` (relation → lien offre)

**À NE PAS toucher :** formules (`Loyer au m²`, `Group`) ; hors scope (`Occupant`, `Enseigne(s) concernée(s)`) ; relations complexes (`Gestionnaire`, `Bailleur`, `Ville`, `Pays`, `Emplacement`, `Zone de Chalandise`, `Historique des Loyers`) ; interne client (`Mission Uneo`, `Type de mission`, `CA occupant HT `, `Fond Marketing`, `Historique Mission`, `Sélectionner`).

---

## 5. Flux final

1. **Cron polling** Graph (`/api/poll`) — `/messages/delta` depuis le `deltaLink` persistant.
2. **Pour chaque nouveau mail** : étapes 3→12.
3. **Garde-fou technique** : mail entrant exploitable ? sinon ignoré + loggé.
4. **Dédoublonnage** : message-ID déjà traité ?
5. **Extraction contenus** : router par format (PDF vision / xlsx→texte / HTML / lien fetch / gros PDF texte-first).
6. **Classification/routage — Haiku** : offre exploitable / bruit / faible complétude.
7. Si offre → **Extraction — Sonnet** : JSON strict = **tableau de locaux** (+ contact broker par actif).
8. **Upload fichiers** → Azure Blob → URLs (matching filename → bon local pour plan/photo).
9. **Résolution Broker** (email → fallback tél ; source selon type doc).
10. **Création N pages Magasin** + champs + URLs docs + relation Broker.
11. **Création page Offre** : État « À étudier », relations N Magasins, Broker, PDF/URL.
12. **Marquer message-ID traité**.

---

## 6. Points en suspens

- [x] ~~Modélisation Centre→locaux~~ RÉSOLU : DB **Emplacements** = le Centre parent (porte GLA, locomotive, flux, etc. ; relation `Magasins` = locaux enfants).
- [x] ~~Make préexistant~~ RÉSOLU : plus aucune automatisation Make branchée (ancien crash test). `Checked by Make` inerte.
- [x] ~~Webhook vs polling~~ DÉCIDÉ : **polling delta sur cron** (5–15 min), webhook abandonné.
- [x] ~~schéma DB Contacts~~ RÉSOLU : `E-mail` + `Portable` + `Nom complet` présents. Matching email exact, tél en fallback code-side (préférer 06 mobile).
- [x] ~~Comportement mail ambigu~~ RÉSOLU : traiter-ou-rejeter + mail auto-notification à soi-même (wording exact §2).
- [x] ~~Stack~~ RÉSOLU : le brief Notion Make/OpenAI est l'ANCIENNE tentative abandonnée. On repart sur **Vercel + API Anthropic + Claude Code**. Le vieux brief sert seulement de source de règles métier.
- [x] ~~Offre vs bruit~~ RÉSOLU : détection d'intention + ancres lexicales (§Classification).
- [x] ~~Richesse mapping~~ RÉSOLU : mapping RICHE (~15 champs), confirmé par le Canva.
- [x] ~~Société expéditeur → Broker ou Entreprise~~ RÉSOLU : les personnes qui proposent des locaux sont des **brokers** → DB Brokers (notre logique inchangée).
- [x] ~~Terranae → Broker ou Bailleur~~ RÉSOLU : Broker (il propose des locaux).
- [ ] 1 offre/N magasins (retenu) vs N offres : basculable — à confirmer côté usage Matthieu.
- [ ] Container Azure : privé+SAS (recommandé, données de baux) vs public lecture.
- [ ] Type exact des propriétés `PDF` / `URL` de la DB Offres (file ou url ?).
- [ ] Récupérer les fichiers réels des 5 exemples (on a Zadig + Terranae ; les 5 sont décrits dans le Canva, utiles comme cas de test du brief).

---

## 7. Exemples réels analysés

**Exemple 1 — Zadig & Voltaire (offre chiffrée, cession).** Broker = Marcle Immobilier / Jean Nocentini `marcleimmobilier@orange.fr` (tél 04 93 39 00 64 / 06 09 50 18 61). Donnée dans un **xlsx** (7 magasins), PJ = 16 fichiers plans/photos CODATA (2 par magasin, à rattacher par filename). Colonnes xlsx : ADRESSE, SITUATION (enseignes mitoyennes→Notes), SURFACE DE VENTE (→RDC/R±), SURFACE AU BAIL (→Pondérée), Loyer HT HC (→Loyer fixe), ECHEANCE BAIL ("En attente"→vide), Durée, PRIX DE CESSION (→Droit au bail). C'est une CESSION → `Type de mission` "Cession" pertinent ; détecter le type, ne pas supposer. Mail reçu était un transfert Matthieu→Théo (en prod le broker écrit direct).

**Exemple 2 — Terranae (plaquette portefeuille).** Expéditrice Virginie Lainé (Directrice Commerciale) `vlaine@terranae.com`, mais **contact opérationnel par actif dans le doc**. PDF 141 pages / 14 Mo avec couche texte. ~50 centres commerciaux + retail parks + pieds d'immeuble. Par centre : nom, adresse, GLA, nb boutiques, locomotive, zone de chalandise, fréquentation, contact dédié, localisation, nouvelles enseignes, + pages de surfaces dispo (sans prix). = matière à peupler/enrichir la base Centres. Structure imbriquée Centre→locaux. Faible complétude (pas de prix).

---

## 8. Préférences de travail de Théo
- Direct, concis, sans flatterie ni adoucissement. Prose plutôt que bullets/titres sauf si structure utile.
- Exécution par défaut ; sparring si sollicité. Signaler erreurs factuelles / risques concrets (argent, sécurité, légalité) brièvement.
- Notion Formula 2.0 : jamais `startsWith()`, `apply()`, `get()`, `→` ; normaliser tél `replace("[^0-9]", "")` ; relations via `.map(current.prop(...))` ; `lets()` structuré (collect→normalize→calculate→render).
