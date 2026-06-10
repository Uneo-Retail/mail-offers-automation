/**
 * Format canonique de la note de divergence déversée dans `observations` quand un
 * même champ porte deux valeurs contradictoires dans le document source.
 *
 * Source de vérité unique du libellé : ce format est aussi décrit mot pour mot dans
 * le prompt d'extraction (`src/ai/prompts/extract.ts`). On retient la valeur du bloc
 * le plus formel (`valB` / `whereB`) et on trace l'autre pour vérification humaine.
 */
export function formatDivergenceNote(
  field: string,
  valA: string,
  whereA: string,
  valB: string,
  whereB: string
): string {
  return `Montant à vérifier — ${field} : ${valA} (${whereA}) vs ${valB} (${whereB}) ; retenu ${valB}.`;
}
