/**
 * Découpage du lot de mails à traiter par exécution (filet de sécurité).
 *
 * On ne traite jamais un lot illimité d'un coup. Si le delta renvoie plus de
 * `maxBatch` mails, on ne prend que les `maxBatch` PLUS ANCIENS (le delta liste
 * du plus ancien au plus récent). Quand le lot est tronqué, l'appelant NE doit
 * PAS avancer le deltaLink : les mails restants seront drainés aux crons suivants
 * (les déjà-traités sont sautés via `processed_messages`).
 */
export interface BatchSelection {
  batch: string[];
  truncated: boolean;
  total: number;
}

export function selectBatch(messageIds: string[], maxBatch: number): BatchSelection {
  const total = messageIds.length;
  if (maxBatch <= 0 || total <= maxBatch) {
    return { batch: messageIds, truncated: false, total };
  }
  return { batch: messageIds.slice(0, maxBatch), truncated: true, total };
}
