-- ============================================================
-- 016_deck_format_and_card_edits.sql
-- 1. decks.card_format: optional per-deck card layout.
--      null        no rule
--      'produce'   front = Chinese meaning/scene, back = the foreign
--                  expression (learn to SAY it)
--      'recognize' front = the foreign text as you see it, back = Chinese +
--                  English + explanation (learn to READ it)
--    Clients sync it like any other deck column.
-- 2. add_cards_atomic gains p_card_format (used only when it creates the deck).
-- 3. update_cards_atomic / delete_cards_atomic / configure_deck_atomic for
--    the MCP connector. All writes set updated_at so devices pull them.
-- Service role only, like add_cards_atomic. Idempotent.
-- ============================================================

alter table decks
  add column if not exists card_format text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'decks_card_format_check'
  ) then
    alter table decks
      add constraint decks_card_format_check
      check (card_format is null or card_format in ('produce', 'recognize'));
  end if;
end $$;

-- ------------------------------------------------------------
-- add_cards_atomic: same as 015 plus p_card_format.
-- ------------------------------------------------------------
drop function if exists add_cards_atomic(uuid, text, jsonb, boolean);

create or replace function add_cards_atomic(
  p_owner       uuid,
  p_deck_name   text,
  p_cards       jsonb,
  p_dry_run     boolean default false,
  p_card_format text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deck_id      uuid;
  v_created_deck boolean := false;
  v_card         jsonb;
  v_type         text;
  v_front        text;
  v_back         text;
  v_card_id      uuid;
  v_now          timestamptz := clock_timestamp();
  v_created      timestamptz;
  v_added        int := 0;
  v_skipped      jsonb := '[]'::jsonb;
  v_seen         text[] := '{}';
begin
  if p_owner is null or not exists (select 1 from profiles where id = p_owner) then
    raise exception 'owner not found' using errcode = 'P0002';
  end if;

  if p_deck_name is null or btrim(p_deck_name) = '' then
    raise exception 'deck name required' using errcode = '22023';
  end if;

  if jsonb_typeof(p_cards) is distinct from 'array' then
    raise exception 'cards must be an array' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || '|' || p_deck_name, 0));

  select id into v_deck_id
  from decks
  where user_id = p_owner
    and name = p_deck_name
    and deleted_at is null
  order by created_at
  limit 1;

  if v_deck_id is null then
    v_created_deck := true;
    if not p_dry_run then
      insert into decks (user_id, name, language, card_format)
      values (p_owner, p_deck_name, 'en', p_card_format)
      returning id into v_deck_id;
    end if;
  end if;

  for v_card in select * from jsonb_array_elements(p_cards)
  loop
    v_type  := coalesce(v_card ->> 'type', 'basic');
    v_front := v_card ->> 'front';
    v_back  := coalesce(v_card ->> 'back', '');

    if v_front is null or btrim(v_front) = '' then
      raise exception 'front required' using errcode = '22023';
    end if;

    if v_front = any (v_seen)
       or (v_deck_id is not null and exists (
            select 1 from cards
            where deck_id = v_deck_id
              and front = v_front
              and deleted_at is null
          ))
    then
      v_skipped := v_skipped || to_jsonb(v_front);
      continue;
    end if;

    v_seen := v_seen || v_front;
    v_added := v_added + 1;

    if not p_dry_run then
      v_card_id := gen_random_uuid();
      v_created := v_now + (v_added - 1) * interval '1 millisecond';

      insert into cards (id, deck_id, type, front, back, created_at, updated_at)
      values (v_card_id, v_deck_id, v_type, v_front, v_back, v_created, v_created);

      insert into card_state (
        card_id, stability, difficulty, due, last_review,
        state, reps, lapses, learning_steps, updated_at
      )
      values (v_card_id, 0, 0, v_created, null, 0, 0, 0, 0, v_created);
    end if;
  end loop;

  return jsonb_build_object(
    'deck_id',      v_deck_id,
    'created_deck', v_created_deck,
    'added',        v_added,
    'skipped',      v_skipped
  );
end;
$$;

-- ------------------------------------------------------------
-- configure_deck_atomic: create the deck if missing, else update its
-- format/language. Keys absent from p_changes are left as they are.
-- ------------------------------------------------------------
create or replace function configure_deck_atomic(
  p_owner     uuid,
  p_deck_name text,
  p_changes   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deck decks%rowtype;
  v_created boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if p_owner is null or not exists (select 1 from profiles where id = p_owner) then
    raise exception 'owner not found' using errcode = 'P0002';
  end if;

  if p_deck_name is null or btrim(p_deck_name) = '' then
    raise exception 'deck name required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || '|' || p_deck_name, 0));

  select * into v_deck
  from decks
  where user_id = p_owner and name = p_deck_name and deleted_at is null
  order by created_at
  limit 1;

  if v_deck.id is null then
    v_created := true;
    insert into decks (user_id, name, language, card_format, created_at, updated_at)
    values (
      p_owner,
      p_deck_name,
      case when p_changes ? 'language' then p_changes ->> 'language' else 'en' end,
      p_changes ->> 'card_format',
      v_now,
      v_now
    )
    returning * into v_deck;
  else
    update decks set
      card_format = case when p_changes ? 'card_format' then p_changes ->> 'card_format' else card_format end,
      language    = case when p_changes ? 'language' then p_changes ->> 'language' else language end,
      updated_at  = v_now
    where id = v_deck.id
    returning * into v_deck;
  end if;

  return jsonb_build_object(
    'deck_id',     v_deck.id,
    'created',     v_created,
    'name',        v_deck.name,
    'card_format', v_deck.card_format,
    'language',    v_deck.language
  );
end;
$$;

-- ------------------------------------------------------------
-- update_cards_atomic: p_updates is an array of fully resolved rows
--   {id, deck_id, type, front, back, reset_progress}
-- (the Edge Function merges partial edits and validates them first).
-- Each row is checked here again: the card and the target deck must belong
-- to the owner and be live, and the new front must not duplicate another
-- live card in the target deck. Failing rows are reported, the rest apply.
-- Review progress (card_state) is kept unless reset_progress is true.
-- ------------------------------------------------------------
create or replace function update_cards_atomic(
  p_owner   uuid,
  p_updates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     jsonb;
  v_id      uuid;
  v_deck_id uuid;
  v_front   text;
  v_now     timestamptz := clock_timestamp();
  v_updated int := 0;
  v_errors  jsonb := '[]'::jsonb;
begin
  if p_owner is null or not exists (select 1 from profiles where id = p_owner) then
    raise exception 'owner not found' using errcode = 'P0002';
  end if;

  if jsonb_typeof(p_updates) is distinct from 'array' then
    raise exception 'updates must be an array' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || '|edit', 0));

  for v_row in select * from jsonb_array_elements(p_updates)
  loop
    v_id      := (v_row ->> 'id')::uuid;
    v_deck_id := (v_row ->> 'deck_id')::uuid;
    v_front   := v_row ->> 'front';

    if not exists (
      select 1 from cards c join decks d on d.id = c.deck_id
      where c.id = v_id and c.deleted_at is null
        and d.user_id = p_owner and d.deleted_at is null
    ) then
      v_errors := v_errors || jsonb_build_object('id', v_id, 'message', 'card not found');
      continue;
    end if;

    if not exists (
      select 1 from decks
      where id = v_deck_id and user_id = p_owner and deleted_at is null
    ) then
      v_errors := v_errors || jsonb_build_object('id', v_id, 'message', 'deck not found');
      continue;
    end if;

    if v_front is null or btrim(v_front) = '' then
      v_errors := v_errors || jsonb_build_object('id', v_id, 'message', 'front is empty');
      continue;
    end if;

    if exists (
      select 1 from cards
      where deck_id = v_deck_id and front = v_front
        and deleted_at is null and id <> v_id
    ) then
      v_errors := v_errors || jsonb_build_object('id', v_id, 'message', 'another card in the deck has this front');
      continue;
    end if;

    update cards set
      deck_id    = v_deck_id,
      type       = coalesce(v_row ->> 'type', type),
      front      = v_front,
      back       = coalesce(v_row ->> 'back', ''),
      updated_at = v_now
    where id = v_id;

    if coalesce((v_row ->> 'reset_progress')::boolean, false) then
      update card_state set
        stability = 0, difficulty = 0, due = v_now, last_review = null,
        state = 0, reps = 0, lapses = 0, learning_steps = 0,
        updated_at = v_now
      where card_id = v_id;
    end if;

    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object('updated', v_updated, 'errors', v_errors);
end;
$$;

-- ------------------------------------------------------------
-- delete_cards_atomic: soft delete, like the app (deleted_at + updated_at).
-- ------------------------------------------------------------
create or replace function delete_cards_atomic(
  p_owner uuid,
  p_ids   uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now     timestamptz := clock_timestamp();
  v_deleted uuid[];
begin
  if p_owner is null or not exists (select 1 from profiles where id = p_owner) then
    raise exception 'owner not found' using errcode = 'P0002';
  end if;

  with hit as (
    update cards c set deleted_at = v_now, updated_at = v_now
    from decks d
    where d.id = c.deck_id
      and d.user_id = p_owner
      and c.id = any (p_ids)
      and c.deleted_at is null
    returning c.id
  )
  select coalesce(array_agg(id), '{}') into v_deleted from hit;

  return jsonb_build_object(
    'deleted',   coalesce(array_length(v_deleted, 1), 0),
    'not_found', to_jsonb(array(select unnest(p_ids) except select unnest(v_deleted)))
  );
end;
$$;

revoke all on function add_cards_atomic(uuid, text, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function add_cards_atomic(uuid, text, jsonb, boolean, text) to service_role;
revoke all on function configure_deck_atomic(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function configure_deck_atomic(uuid, text, jsonb) to service_role;
revoke all on function update_cards_atomic(uuid, jsonb) from public, anon, authenticated;
grant execute on function update_cards_atomic(uuid, jsonb) to service_role;
revoke all on function delete_cards_atomic(uuid, uuid[]) from public, anon, authenticated;
grant execute on function delete_cards_atomic(uuid, uuid[]) to service_role;

notify pgrst, 'reload schema';
