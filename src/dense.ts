/**
 * Décision « plaquette dense » (multi-centres type Terranae).
 *
 * On ne tente PAS l'extraction exhaustive d'une grosse plaquette de portefeuille :
 * on la signale et on renvoie vers le PDF source. Le garde-fou ne s'applique QU'AUX
 * `faible_completude` (jamais aux `offre` : Zadig, Paris IX, Villeneuve… non concernés).
 */
export interface DenseInput {
  route: string;
  /** drapeau posé par le modèle (mode signalement) */
  denseFlag?: boolean | null;
  /** estimation du nombre de centres par le modèle */
  nbCentresEstime?: number | null;
  /** nombre de locaux réellement extraits (repli si pas d'estimation) */
  nbLocaux: number;
  /** nombre de pages du plus gros PDF de données */
  maxPdfPages: number;
}

export interface DenseThresholds {
  maxCenters: number;
  maxPages: number;
}

export interface DenseDecision {
  dense: boolean;
  nbCentres: number;
}

export function isDenseBrochure(input: DenseInput, cfg: DenseThresholds): DenseDecision {
  const nbCentres = input.nbCentresEstime ?? input.nbLocaux;
  // Jamais dense hors plaquette de portefeuille : les offres normales passent.
  if (input.route !== "faible_completude") {
    return { dense: false, nbCentres };
  }
  const byFlag = input.denseFlag === true;
  const byCount = nbCentres > cfg.maxCenters;
  const byPages = input.maxPdfPages > cfg.maxPages;
  return { dense: byFlag || byCount || byPages, nbCentres };
}
