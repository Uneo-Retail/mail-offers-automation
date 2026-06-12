"use client";

export type DisplayStatus = "succes" | "dense" | "hors_scope" | "echec" | "ignore" | "en_cours";

export const STATUS_META: Record<DisplayStatus, { label: string; cls: string }> = {
  succes: { label: "Succès Notion", cls: "bg-emerald-100 text-emerald-700 ring-emerald-200" },
  dense: { label: "Plaquette dense", cls: "bg-amber-100 text-amber-700 ring-amber-200" },
  hors_scope: { label: "Hors-scope", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
  echec: { label: "Échec", cls: "bg-rose-100 text-rose-700 ring-rose-200" },
  ignore: { label: "Ignoré", cls: "bg-slate-100 text-slate-500 ring-slate-200" },
  en_cours: { label: "En cours", cls: "bg-blue-100 text-blue-700 ring-blue-200" },
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.ignore;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${m.cls}`}>
      {status === "en_cours" && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse-dot" />}
      {m.label}
    </span>
  );
}

const STEP_LABELS: Record<string, string> = {
  mail_recu: "📨 Mail reçu",
  extraction_contenu: "📎 Extraction du contenu",
  classification: "🧭 Classification (Haiku)",
  classification_ok: "🧭 Classification terminée",
  hors_scope: "🚫 Hors-scope (bruit)",
  extraction_ia: "🤖 Extraction (Sonnet)",
  extraction_ia_ok: "🤖 Extraction terminée",
  extraction_ia_echec: "⚠️ Extraction échouée",
  plaquette_dense: "📚 Plaquette dense signalée",
  upload_azure: "☁️ Upload Azure",
  resolution_broker: "🏢 Résolution broker/contact",
  creation_notion: "🗂️ Création pages Notion",
  notification_envoyee: "✉️ Notification envoyée",
  termine: "✅ Terminé",
  ecriture_notion_echec: "⚠️ Écriture Notion échouée",
};

export function stepLabel(step: string): string {
  return STEP_LABELS[step] ?? step;
}

export function levelDot(level: string): string {
  if (level === "error") return "bg-rose-500";
  if (level === "warn") return "bg-amber-500";
  return "bg-emerald-500";
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const TERMINAL_STEPS = new Set(["termine", "hors_scope", "extraction_ia_echec", "ecriture_notion_echec", "plaquette_dense"]);
