-- ============================================================
-- 012_table_grants.sql
-- Newer Supabase projects no longer grant table privileges to the
-- API roles by default, so the client gets "42501 permission denied"
-- even though RLS policies exist. Grant explicitly:
--   * authenticated: CRUD, still restricted row-by-row by RLS
--   * service_role:  full access for server-side functions
--   * anon:          nothing (the app only touches tables when signed in)
-- Idempotent: safe to run on projects that already have these grants.
-- ============================================================

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete
  on table profiles, decks, cards, card_state, revlog, session_log
  to authenticated;

grant all
  on table profiles, decks, cards, card_state, revlog, session_log
  to service_role;

grant execute on function get_server_time() to anon, authenticated, service_role;
