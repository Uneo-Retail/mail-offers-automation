/**
 * XLSX (SheetJS) → texte CSV par feuille.
 *
 * Claude ne lit pas le binaire xlsx : on convertit chaque feuille en CSV texte,
 * en-têtes préservés. C'est souvent LE porteur de données (cas Zadig).
 */
import * as XLSX from "xlsx";

export function xlsxToText(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    // CSV : robuste, conserve la grille ; on garde les lignes vides internes mais
    // on retire les lignes totalement vides en tête/queue.
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, FS: ";" });
    if (csv.trim()) {
      parts.push(`### Feuille : ${name}\n${csv.trim()}`);
    }
  }
  return parts.join("\n\n");
}
