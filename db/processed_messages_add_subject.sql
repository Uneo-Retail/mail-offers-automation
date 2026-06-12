-- Console admin : conserver sujet + expéditeur pour l'affichage de la liste.
-- Additif et non bloquant (colonnes nullables) — n'altère pas la logique existante.

alter table processed_messages add column if not exists subject text;
alter table processed_messages add column if not exists sender  text;
