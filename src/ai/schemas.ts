/**
 * Schémas des sorties IA (zod) + définitions des tools Anthropic (JSON schema).
 *
 * On force le tool use : le modèle DOIT répondre via l'outil, ce qui garantit une
 * sortie structurée. On revalide ensuite les arguments avec zod côté code.
 */
import { z } from "zod";

// ── Valeurs de sélection autorisées ────────────────────────────────────────
export const TYPE_EMPLACEMENT = [
  "Rue",
  "Retail Park",
  "Centre Commercial",
  "Pied d'Immeuble",
  "Zone commercial",
  "Office",
  "Local commercial",
  "Gare",
] as const;

export const DUREE_FERME = ["1 an", "3 ans", "4 ans", "6 ans", "10 ans", "12 ans"] as const;

// ── Classification (Haiku) ──────────────────────────────────────────────────
export const classificationSchema = z.object({
  route: z.enum(["offre", "faible_completude", "bruit"]),
  type_offre: z.enum(["location", "cession", "plaquette_portefeuille", "inconnu"]),
  confiance: z.number().min(0).max(1),
  raison: z.string(),
});
export type Classification = z.infer<typeof classificationSchema>;

export const classifyTool = {
  name: "router_le_mail",
  description: "Renvoie la décision de routage du mail (offre / faible_completude / bruit).",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      route: {
        type: "string",
        enum: ["offre", "faible_completude", "bruit"],
        description:
          "offre = proposition exploitable d'un ou plusieurs locaux commerciaux par un broker/bailleur/gestionnaire ; faible_completude = catalogue/plaquette de portefeuille (centres, surfaces dispo, peu/pas de conditions) ; bruit = tout le reste (facture, newsletter, admin, relance sans bien).",
      },
      type_offre: {
        type: "string",
        enum: ["location", "cession", "plaquette_portefeuille", "inconnu"],
        description: "Type dominant. En cas de doute : inconnu.",
      },
      confiance: { type: "number", description: "Confiance 0.0 à 1.0." },
      raison: { type: "string", description: "Courte justification (1 phrase)." },
    },
    required: ["route", "type_offre", "confiance", "raison"],
  },
} as const;

// ── Extraction (Sonnet) ─────────────────────────────────────────────────────
const nullableNumber = z.number().nullable().optional();
const nullableString = z.string().nullable().optional();

export const centreSchema = z
  .object({
    nom: nullableString,
    adresse_complete: nullableString,
    type_emplacement: z.enum(TYPE_EMPLACEMENT).nullable().optional(),
    locomotive: nullableString,
    superficie_m2: nullableNumber,
    surface_hypermarche_m2: nullableNumber,
    flux_visiteurs: nullableString,
    description: nullableString,
    total_magasins: nullableNumber,
  })
  .nullable();

export const contactSchema = z.object({
  nom_complet: nullableString,
  email: nullableString,
  telephone: nullableString,
  role: nullableString,
  adresse_postale: nullableString,
  source: z.enum(["expediteur", "document"]).nullable().optional(),
});

export const brokerSchema = z.object({
  societe: nullableString,
  societe_url: nullableString,
  contact: contactSchema,
});

export const localSchema = z.object({
  nom: z.string(),
  adresse_complete: nullableString,
  type_emplacement: z.enum(TYPE_EMPLACEMENT).nullable().optional(),
  surface_rdc: nullableNumber,
  surface_r_moins_1: nullableNumber,
  surface_r_plus_1: nullableNumber,
  surface_r_plus_2: nullableNumber,
  surface_ponderee: nullableNumber,
  loyer_annuel_fixe: nullableNumber,
  loyer_annuel_variable_pct: nullableNumber,
  charges_locatives_annuelles: nullableNumber,
  droit_au_bail: nullableNumber,
  tf_annuelle: nullableNumber,
  duree_ferme: z.array(z.enum(DUREE_FERME)).default([]),
  date_fin_bail: nullableString, // YYYY-MM-DD
  annee_bail: nullableString,
  environnement_commercial: nullableString,
  fichiers: z
    .object({ plan: nullableString, photo: nullableString })
    .default({ plan: null, photo: null }),
});
export type Local = z.infer<typeof localSchema>;

export const extractionSchema = z.object({
  centre: centreSchema,
  broker: brokerSchema,
  locaux: z.array(localSchema),
});
export type Extraction = z.infer<typeof extractionSchema>;

// JSON schema du tool d'extraction (miroir du zod ci-dessus).
const numProp = { type: ["number", "null"] };
const strProp = { type: ["string", "null"] };
const typeEmpProp = { type: ["string", "null"], enum: [...TYPE_EMPLACEMENT, null] };

export const extractTool = {
  name: "extraire_offre",
  description:
    "Extrait la structure de l'offre : centre (si applicable), broker (société + contact), et le tableau des locaux. Ne jamais inventer : champ absent/illisible → null.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      centre: {
        type: ["object", "null"],
        description: "Rempli seulement si l'offre concerne un centre commercial / une plaquette de centres.",
        properties: {
          nom: strProp,
          adresse_complete: strProp,
          type_emplacement: typeEmpProp,
          locomotive: strProp,
          superficie_m2: numProp,
          surface_hypermarche_m2: numProp,
          flux_visiteurs: strProp,
          description: strProp,
          total_magasins: { ...numProp, description: "Nombre de boutiques du centre (« dont X boutiques »)." },
        },
      },
      broker: {
        type: "object",
        properties: {
          societe: { ...strProp, description: "Nom propre de la société broker (déduit/nettoyé d'une URL si besoin)." },
          societe_url: strProp,
          contact: {
            type: "object",
            properties: {
              nom_complet: strProp,
              email: strProp,
              telephone: { ...strProp, description: "Préférer le mobile (06/07) au fixe/standard (01-05)." },
              role: strProp,
              adresse_postale: strProp,
              source: { type: ["string", "null"], enum: ["expediteur", "document", null] },
            },
            required: ["nom_complet", "email", "telephone", "role", "adresse_postale", "source"],
          },
        },
        required: ["societe", "societe_url", "contact"],
      },
      locaux: {
        type: "array",
        description: "Un objet par local. Peut contenir des dizaines d'éléments.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            nom: { type: "string", description: "Adresse complète si connue, sinon titre concis (ex. « Paris IX - Realtyz »)." },
            adresse_complete: strProp,
            type_emplacement: typeEmpProp,
            surface_rdc: numProp,
            surface_r_moins_1: numProp,
            surface_r_plus_1: numProp,
            surface_r_plus_2: numProp,
            surface_ponderee: { ...numProp, description: "Surface au bail / totale. Si une seule surface connue → ici." },
            loyer_annuel_fixe: { ...numProp, description: "Loyer annuel HT/HC (€)." },
            loyer_annuel_variable_pct: numProp,
            charges_locatives_annuelles: numProp,
            droit_au_bail: { ...numProp, description: "« PRIX DE CESSION » (cas cession) (€)." },
            tf_annuelle: { ...numProp, description: "Taxe foncière / Foncier (€)." },
            duree_ferme: { type: "array", items: { type: "string", enum: [...DUREE_FERME] } },
            date_fin_bail: { ...strProp, description: "YYYY-MM-DD. « En attente »/non communiqué → null." },
            annee_bail: strProp,
            environnement_commercial: { ...strProp, description: "Enseignes mitoyennes / situation → ira dans Notes, sans reformulation." },
            fichiers: {
              type: "object",
              properties: { plan: strProp, photo: strProp },
              required: ["plan", "photo"],
            },
          },
          required: ["nom"],
        },
      },
    },
    required: ["broker", "locaux", "centre"],
  },
} as const;
