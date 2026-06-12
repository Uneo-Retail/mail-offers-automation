"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { StatusBadge, fmtDate, type DisplayStatus } from "./ui";

interface Item {
  messageId: string;
  processedAt: string | null;
  subject: string | null;
  sender: string | null;
  status: DisplayStatus;
  route: string | null;
  typeOffre: string | null;
  nbLocaux: number | null;
  notionOffreUrl: string | null;
  lastStep?: string | null;
}

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "Tous" },
  { key: "en_cours", label: "En cours" },
  { key: "succes", label: "Succès" },
  { key: "dense", label: "Dense" },
  { key: "hors_scope", label: "Hors-scope" },
  { key: "echec", label: "Échec" },
  { key: "ignore", label: "Ignoré" },
];

export default function AdminListPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef(search);
  searchRef.current = search;

  const load = useCallback(async (st: string, q: string) => {
    const params = new URLSearchParams();
    if (st) params.set("status", st);
    if (q) params.set("search", q);
    const res = await fetch(`/api/admin/messages?${params}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setItems(data.items ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load(status, search);
  }, [status, search, load]);

  // rafraîchissement live (pour les éléments « en cours »)
  useEffect(() => {
    const id = setInterval(() => load(status, searchRef.current), 4000);
    return () => clearInterval(id);
  }, [status, load]);

  const inProgress = items.filter((i) => i.status === "en_cours").length;

  async function trigger() {
    setTriggering(true);
    setToast(null);
    try {
      const res = await fetch("/api/admin/trigger", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setToast(res.ok ? `Traitement déclenché — ${data.processed ?? 0} mail(s) traité(s).` : `Erreur : ${data.error ?? res.status}`);
      load(status, search);
    } catch (e) {
      setToast(`Erreur réseau : ${String(e)}`);
    } finally {
      setTriggering(false);
      setTimeout(() => setToast(null), 6000);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Console — Offres traitées</h1>
          <p className="text-sm text-slate-500">Supervision du pipeline mail → Notion.</p>
        </div>
        <div className="flex items-center gap-3">
          {inProgress > 0 && (
            <span className="inline-flex items-center gap-1.5 text-sm text-blue-600">
              <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse-dot" />
              {inProgress} en cours
            </span>
          )}
          <button
            onClick={trigger}
            disabled={triggering}
            className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-50"
          >
            {triggering ? "Déclenchement…" : "Déclencher un traitement"}
          </button>
        </div>
      </header>

      {toast && <div className="mb-4 animate-fade-in rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700">{toast}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatus(f.key)}
            className={`rounded-full px-3 py-1 text-sm transition ${
              status === f.key ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
            }`}
          >
            {f.label}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (sujet, expéditeur)…"
          className="ml-auto w-64 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-400"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Sujet</th>
              <th className="px-4 py-3 font-medium">Expéditeur</th>
              <th className="px-4 py-3 font-medium">Statut</th>
              <th className="px-4 py-3 font-medium text-right">Locaux</th>
              <th className="px-4 py-3 font-medium">Notion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Chargement…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Aucun mail traité pour ce filtre.</td></tr>
            )}
            {items.map((it) => (
              <tr key={it.messageId} className="animate-fade-in transition hover:bg-slate-50">
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(it.processedAt)}</td>
                <td className="px-4 py-3">
                  <Link href={`/admin/${encodeURIComponent(it.messageId)}`} className="font-medium text-slate-800 hover:text-slate-950 hover:underline">
                    {it.subject || "(sans objet)"}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-500">{it.sender || "—"}</td>
                <td className="px-4 py-3"><StatusBadge status={it.status} /></td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-600">{it.nbLocaux ?? "—"}</td>
                <td className="px-4 py-3">
                  {it.notionOffreUrl ? (
                    <a href={it.notionOffreUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Offre ↗</a>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
