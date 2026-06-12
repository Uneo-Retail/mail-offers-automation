-- Console admin : flux d'événements de traitement (affichage "live").
-- À exécuter une fois sur le projet Supabase (SQL editor).

create table if not exists processing_events (
  id          bigint generated always as identity primary key,
  message_id  text not null,
  ts          timestamptz not null default now(),
  step        text not null,
  detail      text,
  level       text not null default 'info'   -- info | warn | error
);

create index if not exists processing_events_message_id_idx on processing_events (message_id);
create index if not exists processing_events_ts_idx on processing_events (ts desc);

-- RLS activée SANS policy : aucun accès via les clés anon/publishable.
-- Tout passe par la service_role côté serveur (routes /api/admin) — jamais le navigateur.
alter table processing_events enable row level security;

-- Realtime : exposer la table au canal Realtime (INSERT) pour la timeline live.
-- (Le front s'abonne en lecture via une clé restreinte ; à défaut, polling de repli.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'processing_events'
  ) then
    alter publication supabase_realtime add table processing_events;
  end if;
end $$;
