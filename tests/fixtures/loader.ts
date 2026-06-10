/**
 * Chargement des cas de test depuis `tests/fixtures/`.
 *
 * Un cas = un sous-dossier contenant un `expected.json` et l'un de :
 *  - `mail.eml`  : MIME brut (le plus fidèle) ;
 *  - `mail.json` : objet IncomingMail partiel (subject, from, bodyText/bodyHtml),
 *                  + d'éventuels fichiers joints listés dans `attachments` (chemins
 *                    relatifs au dossier du cas).
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMail, MailAttachment } from "../../src/types.js";
import { parseEml } from "./eml.js";
import type { Expected } from "./compare.js";

const FIX_DIR = dirname(fileURLToPath(import.meta.url));

export interface FixtureCase {
  name: string;
  mail: IncomingMail;
  expected: Expected;
}

interface MailJson {
  subject?: string;
  from?: { name?: string; email?: string };
  toRecipients?: { name?: string; email?: string }[];
  bodyText?: string;
  bodyHtml?: string;
  receivedAt?: string;
  attachments?: { name: string; contentType?: string; file?: string; isInline?: boolean }[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function loadMailJson(dir: string, name: string): Promise<IncomingMail> {
  const j = JSON.parse(await readFile(join(dir, "mail.json"), "utf8")) as MailJson;
  const attachments: MailAttachment[] = [];
  for (const [i, a] of (j.attachments ?? []).entries()) {
    const content = a.file ? await readFile(join(dir, a.file)) : undefined;
    attachments.push({
      id: `att-${i}`,
      name: a.name,
      contentType: a.contentType ?? "application/octet-stream",
      size: content?.length ?? 0,
      content,
      isInline: !!a.isInline,
    });
  }
  return {
    id: `fixture-${name}`,
    subject: j.subject ?? "",
    from: j.from ?? {},
    toRecipients: j.toRecipients ?? [],
    bodyText: j.bodyText,
    bodyHtml: j.bodyHtml,
    receivedAt: j.receivedAt ?? new Date().toISOString(),
    attachments,
    headers: {},
  };
}

export async function loadFixtures(): Promise<{ cases: FixtureCase[]; skipped: string[] }> {
  const cases: FixtureCase[] = [];
  const skipped: string[] = [];
  const entries = await readdir(FIX_DIR, { withFileTypes: true });

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(FIX_DIR, e.name);
    const expectedPath = join(dir, "expected.json");
    if (!(await exists(expectedPath))) continue;
    const expected = JSON.parse(await readFile(expectedPath, "utf8")) as Expected;

    let mail: IncomingMail | null = null;
    if (await exists(join(dir, "mail.eml"))) {
      mail = await parseEml(await readFile(join(dir, "mail.eml")), `fixture-${e.name}`);
    } else if (await exists(join(dir, "mail.json"))) {
      mail = await loadMailJson(dir, e.name);
    }

    if (!mail) {
      skipped.push(e.name); // golden présent mais mail absent (à déposer)
      continue;
    }
    cases.push({ name: e.name, mail, expected });
  }
  return { cases, skipped };
}
