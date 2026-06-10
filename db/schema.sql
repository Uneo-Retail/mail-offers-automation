-- Schéma Supabase pour l'état & le dédoublonnage du pipeline.
-- À exécuter une fois sur le projet Supabase (SQL editor) avant le premier run.

create table if not exists graph_state (
  key         text primary key,
  delta_link  text,
  updated_at  timestamptz not null default now()
);

create table if not exists processed_messages (
  message_id      text primary key,
  processed_at    timestamptz not null default now(),
  route           text,
  nb_locaux       integer,
  notion_offre_id text,
  status          text not null,            -- success | noise | failed | skipped
  error           text
);

create table if not exists routing_log (
  id          bigint generated always as identity primary key,
  message_id  text not null,
  route       text not null,
  type_offre  text,
  confiance   double precision,
  raison      text,
  created_at  timestamptz not null default now()
);

create index if not exists routing_log_message_id_idx on routing_log (message_id);
create index if not exists processed_messages_status_idx on processed_messages (status);
