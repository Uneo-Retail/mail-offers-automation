/**
 * Orchestration de la résolution Contact → Broker.
 *
 * 1. chercher le contact par email (clé) → s'il existe et porte un Broker, le réutiliser ;
 * 2. sinon résoudre/créer le Broker (société) par nom ;
 * 3. créer le contact manquant, lié au Broker.
 *
 * Le nom de société est déduit de l'URL si besoin (« www.icg-commerce.fr » → « ICG Commerce »).
 */
import type { Extraction } from "../ai/schemas.js";
import { findContact, createContact } from "./contacts.js";
import { resolveBroker } from "./brokers.js";
import { log, serializeError } from "../log.js";

export interface ResolvedBroker {
  brokerId: string | null;
  contactId: string | null;
}

/** « www.icg-commerce.fr » → « ICG Commerce ». */
export function societeFromUrl(url: string): string {
  let host = url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  host = host.split("/")[0] ?? host;
  const name = host.replace(/\.(fr|com|net|eu|io|co|immo|paris)(\.[a-z]{2})?$/i, "");
  return name
    .split(/[-.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function resolveContactAndBroker(broker: Extraction["broker"]): Promise<ResolvedBroker> {
  let societe = broker.societe?.trim() || null;
  if (!societe && broker.societe_url) societe = societeFromUrl(broker.societe_url);

  // 1. contact existant ?
  let contactId: string | null = null;
  let brokerId: string | null = null;
  try {
    const match = await findContact(broker.contact);
    if (match) {
      contactId = match.pageId;
      brokerId = match.brokerIds[0] ?? null;
    }
  } catch (err) {
    log.warn("resolve: findContact a échoué", { err: serializeError(err) });
  }

  // 2. broker (société)
  if (!brokerId) {
    try {
      brokerId = await resolveBroker(societe);
    } catch (err) {
      log.warn("resolve: resolveBroker a échoué", { err: serializeError(err) });
    }
  }

  // 3. contact manquant → créer (lié au broker)
  if (!contactId && (broker.contact.nom_complet || broker.contact.email)) {
    try {
      contactId = await createContact(broker.contact, brokerId ?? undefined);
    } catch (err) {
      log.warn("resolve: createContact a échoué", { err: serializeError(err) });
    }
  }

  return { brokerId, contactId };
}
