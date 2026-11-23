-- ============================================================
-- 013_decks_language.sql
-- The client (IDeck.language, deck modal, text-to-speech) reads and writes
-- decks.language and sends it on every sync, but no upstream migration
-- creates the column. Without it PostgREST rejects the upsert with
-- PGRST204 ("column not found") and sync fails for every deck.
-- Idempotent.
-- ============================================================

alter table decks
  add column if not exists language text;

-- Make PostgREST pick up the new column immediately.
notify pgrst, 'reload schema';
