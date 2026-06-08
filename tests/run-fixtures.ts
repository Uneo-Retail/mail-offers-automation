/**
 * Runner de validation sur mails réels : extraction déterministe → classify (Haiku)
 * → extract (Sonnet) → comparaison au golden `expected.json`. N'écrit RIEN
 * (pas de Notion/Azure/Graph). Valide la COMPRÉHENSION, pas l'écriture.
 *
 *   npm run test:fixtures
 *
 * Sans ANTHROPIC_API_KEY : seule la partie déterministe tourne, la partie IA est
 * SKIP avec un message clair (pas de plantage). Code de sortie ≠ 0 si un cas échoue.
 */
import { loadFixtures, type FixtureCase } from "./fixtures/loader.js";
import { compareClassification, compareExtraction, type Check } from "./fixtures/compare.js";
import { routeExtraction } from "../src/extract/router.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const YEL = "\x1b[33m";
const RESET = "\x1b[0m";

const hasKey = !!process.env.ANTHROPIC_API_KEY;

function printChecks(checks: Check[]): number {
  let failed = 0;
  for (const c of checks) {
    if (c.ok) {
      console.log(`    ${GREEN}✅ ${c.label}${RESET}`);
    } else {
      failed++;
      console.log(`    ${RED}❌ ${c.label}${RESET} — attendu ${JSON.stringify(c.expected)}, obtenu ${JSON.stringify(c.got)}`);
    }
  }
  return failed;
}

async function runCase(fc: FixtureCase): Promise<boolean> {
  console.log(`\n${"─".repeat(60)}\n📨 ${fc.name}`);
  const content = await routeExtraction(fc.mail);
  console.log(
    `${DIM}   extraction : ${content.bodyText.length} car. corps, ${content.dataDocs.length} doc(s), ${content.media.length} média(s), ${content.links.length} lien(s)${RESET}`
  );

  if (!hasKey) {
    console.log(`   ${YEL}⏭  IA SKIP (ANTHROPIC_API_KEY absente) — extraction déterministe OK${RESET}`);
    return true;
  }

  // Import paresseux : ne charge le SDK Anthropic que si une clé est présente.
  const { classifyMail } = await import("../src/ai/classify.js");
  const { extractOffer } = await import("../src/ai/extract.js");

  let failures = 0;
  const cls = await classifyMail(fc.mail, content);
  console.log(`   route=${cls.route} type=${cls.type_offre} conf=${cls.confiance} — ${DIM}${cls.raison}${RESET}`);
  failures += printChecks(compareClassification(fc.expected, cls));

  // Anti faux-positif : un mail de bruit ne doit JAMAIS ressortir en "offre".
  if (fc.expected.route === "bruit" && cls.route === "offre") {
    console.log(`    ${RED}❌ FAUX POSITIF : bruit classé "offre"${RESET}`);
    failures++;
  }

  if (cls.route !== "bruit") {
    const ext = await extractOffer(fc.mail, content);
    console.log(`   ${DIM}extrait : ${ext.locaux.length} local(aux), broker=${ext.broker.societe ?? "—"}${RESET}`);
    failures += printChecks(compareExtraction(fc.expected, ext));
  }

  console.log(failures === 0 ? `   ${GREEN}→ CAS OK${RESET}` : `   ${RED}→ ${failures} écart(s)${RESET}`);
  return failures === 0;
}

async function main(): Promise<void> {
  const { cases, skipped } = await loadFixtures();
  console.log(`Runner fixtures — ${cases.length} cas chargé(s)${hasKey ? "" : ` ${YEL}(IA désactivée : pas de clé)${RESET}`}`);
  if (skipped.length) {
    console.log(`${YEL}Golden sans mail (à déposer) : ${skipped.join(", ")}${RESET}`);
  }
  if (cases.length === 0) {
    console.log(`${YEL}Aucune fixture exécutable. Déposez des mail.eml / mail.json dans tests/fixtures/<cas>/.${RESET}`);
    return;
  }

  let allOk = true;
  for (const fc of cases) {
    try {
      const ok = await runCase(fc);
      allOk = allOk && ok;
    } catch (err) {
      allOk = false;
      console.log(`   ${RED}💥 erreur : ${String(err)}${RESET}`);
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(allOk ? `${GREEN}TOUS LES CAS OK${RESET}` : `${RED}DES CAS ONT ÉCHOUÉ${RESET}`);
  if (!allOk) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
