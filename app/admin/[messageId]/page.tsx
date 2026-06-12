"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge, stepLabel, levelDot, fmtDate, fmtTime, TERMINAL_STEPS, type DisplayStatus } from "../ui";

interface EventItem { id: number; ts: string; step: string; detail: string | null; level: string }
interface Detail {
  messageId: string;
  processedAt: string | null;
  subject: string | null;
  sender: string | null;
  status: DisplayStatus;
  route: string | null;
  typeOffre: string | null;
  nbLocaux: number | null;
  notionOffreUrl: string | null;
  error: string | null;
  confiance: number | null;
  raison: string | null;
  events: EventItem[];
}

export default function MessageDetailPage({ params }: { params: { messageId: string } }) {
  const id = params.messageId;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/messages/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (res.status === 404) { setNotFound(true); return; }
    if (res.ok) setDetail(await res.json());
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Live : tant que le dernier event n'est pas terminal, on rafraîchit.
  const live = !!detail && detail.status === "en_cours" && !detail.events.some((e) => TERMINAL_STEPS.has(e.step));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [live, load]);

  if (notFound) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/admin" className="text-sm text-slate-500 hover:underline">← Retour</Link>
        <p className="mt-6 text-slate-500">Aucune donnée pour ce message.</p>
      </main>
    );
  }
  if (!detail) {
    return <main className="mx-auto max-w-3xl px-4 py-10 text-slate-400">Chargement…</main>;
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/admin" className="text-sm text-slate-500 hover:underline">← Retour à la liste</Link>

      <header className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{detail.subject || "(sans objet)"}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {detail.sender || "expéditeur inconnu"} · {fmtDate(detail.processedAt)}
          </p>
        </div>
        <StatusBadge status={detail.status} />
      </header>

      {detail.status === "echec" && detail.error && (
        <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div className="font-medium">Raison de l'échec</div>
          <div className="mt-0.5 break-words">{detail.error}</div>
        </div>
      )}

      {/* Résumé IA */}
      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Route" value={detail.route ?? "—"} />
        <Stat label="Type d'offre" value={detail.typeOffre ?? "—"} />
        <Stat label="Confiance" value={detail.confiance != null ? `${Math.round(detail.confiance * 100)}%` : "—"} />
        <Stat label="Locaux" value={detail.nbLocaux != null ? String(detail.nbLocaux) : "—"} />
      </section>

      {detail.raison && (
        <p className="mt-3 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600">
          <span className="font-medium">Note de routage :</span> {detail.raison}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {detail.notionOffreUrl && (
          <a href={detail.notionOffreUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
            Ouvrir l'offre dans Notion ↗
          </a>
        )}
      </div>

      {/* Timeline */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Déroulé du traitement</h2>
          {live && <span className="inline-flex items-center gap-1 text-xs text-blue-600"><span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse-dot" />live</span>}
        </div>
        {detail.events.length === 0 ? (
          <p className="text-sm text-slate-400">Aucun événement enregistré.</p>
        ) : (
          <ol className="relative border-l border-slate-200 pl-6">
            {detail.events.map((e) => (
              <li key={e.id} className="mb-5 animate-fade-in">
                <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${levelDot(e.level)}`} />
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">{stepLabel(e.step)}</span>
                  <span className="text-xs text-slate-400">{fmtTime(e.ts)}</span>
                </div>
                {e.detail && <p className="mt-0.5 break-words text-sm text-slate-500">{e.detail}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-800">{value}</div>
    </div>
  );
}
