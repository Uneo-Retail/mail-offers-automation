/**
 * Résolution / création des Contacts (personnes).
 * Clé fiable = E-mail (filtre exact). Secours = téléphone normalisé côté code.
 */
import { notionConfig } from "../config.js";
import { getSchema, queryDataSource, createPage } from "./client.js";
import { PropsBuilder } from "./propsMap.js";
import { digitsOnly } from "../util/normalize.js";
import type { Extraction } from "../ai/schemas.js";

type Contact = Extraction["broker"]["contact"];

interface ContactMatch {
  pageId: string;
  brokerIds: string[];
}

function readRelationIds(page: { properties: Record<string, unknown> }, propName: string): string[] {
  const p = page.properties[propName] as { relation?: { id: string }[] } | undefined;
  return p?.relation?.map((r) => r.id) ?? [];
}

function readPhone(page: { properties: Record<string, unknown> }): string | null {
  for (const v of Object.values(page.properties)) {
    const pv = v as { type?: string; phone_number?: string | null };
    if (pv?.type === "phone_number" && pv.phone_number) return pv.phone_number;
  }
  return null;
}

/** Recherche un contact par email exact, puis par téléphone normalisé (best-effort). */
export async function findContact(contact: Contact): Promise<ContactMatch | null> {
  const ds = notionConfig().ds.contacts;
  const schema = await getSchema(ds);
  const emailProp = Object.values(schema).find((p) => p.type === "email")?.name;
  const brokerRel = schema["Broker"] ? "Broker" : undefined;

  if (contact.email && emailProp) {
    const results = await queryDataSource(ds, {
      property: emailProp,
      email: { equals: contact.email },
    });
    if (results[0]) {
      return { pageId: results[0].id, brokerIds: brokerRel ? readRelationIds(results[0], brokerRel) : [] };
    }
  }

  // Secours téléphone : pas de filtre serveur fiable (formats variables) → on
  // récupère un échantillon borné et on compare les chiffres côté code.
  if (contact.telephone) {
    const want = digitsOnly(contact.telephone);
    if (want.length >= 9) {
      const sample = await queryDataSource(ds, undefined, 100);
      for (const page of sample) {
        const phone = readPhone(page);
        if (phone && digitsOnly(phone).endsWith(want.slice(-9))) {
          return { pageId: page.id, brokerIds: brokerRel ? readRelationIds(page, brokerRel) : [] };
        }
      }
    }
  }
  return null;
}

export async function createContact(contact: Contact, brokerId?: string): Promise<string> {
  const ds = notionConfig().ds.contacts;
  const schema = await getSchema(ds);
  const titleName = Object.values(schema).find((p) => p.type === "title")?.name ?? "Nom complet";
  const emailName = Object.values(schema).find((p) => p.type === "email")?.name ?? "E-mail";
  const phoneName = Object.values(schema).find((p) => p.type === "phone_number")?.name ?? "Portable";

  const b = new PropsBuilder(schema)
    .title(titleName, contact.nom_complet ?? contact.email ?? "Contact")
    .email(emailName, contact.email)
    .phone(phoneName, contact.telephone)
    .text("Rôle/Périmètre", contact.role)
    .text("Adresse Postale", contact.adresse_postale);
  if (brokerId) b.relation("Broker", [brokerId]);
  return createPage(ds, b.build());
}
