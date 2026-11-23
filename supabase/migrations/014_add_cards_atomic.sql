-- ============================================================
-- 014_add_cards_atomic.sql
-- Server-side bulk add, used by the add-cards Edge Function.
--
-- Mirrors the client's bulkAddCards (src/pages/generate-cards/bulk-add.ts):
-- one `cards` row plus one fresh `card_state` row per card (the values
-- ts-fsrs createEmptyCard() produces), written in ONE transaction so a card
-- never exists without its state. updated_at is set by the 010 triggers.
--
-- SECURITY DEFINER bypasses RLS, so ownership is enforced by hand: the deck
-- is looked up / created for p_owner only. Execution is limited to
-- service_role; anon and authenticated cannot call it.
-- ============================================================

create or replace function add_cards_atomic(
  p_owner     uuid,
  p_deck_name text,
  p_cards     jsonb,
  p_dry_run   boolean default false
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

  -- Serialize concurrent calls for the same owner + deck so two requests
  -- cannot both pass the duplicate check.
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
      insert into decks (user_id, name, language)
      values (p_owner, p_deck_name, 'en')
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

    -- Duplicate: same front already live in this deck, or earlier in this batch.
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

      insert into cards (id, deck_id, type, front, back, created_at, updated_at)
      values (v_card_id, v_deck_id, v_type, v_front, v_back, v_now, v_now);

      insert into card_state (
        card_id, stability, difficulty, due, last_review,
        state, reps, lapses, learning_steps, updated_at
      )
      values (v_card_id, 0, 0, v_now, null, 0, 0, 0, 0, v_now);
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

revoke all on function add_cards_atomic(uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function add_cards_atomic(uuid, text, jsonb, boolean) to service_role;
