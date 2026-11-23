import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import i18next from "i18next";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { requestSync } from "@/lib/sync";
import { State } from "ts-fsrs";
import type { CardType } from "@/lib/db";

export const CARDS_PAGE_SIZE = 100;

export type CardStatus = "new" | "learning" | "review";

export type CardSort = "newest" | "oldest";

// Sort by creation time; ties (e.g. a batch saved in one call) fall back to
// id so the order is stable between renders.
export const sortCardsByCreated = <T extends { created_at: string; id: string }>(
  cards: T[],
  sort: CardSort,
): T[] => {
  const dir = sort === "newest" ? -1 : 1;

  // Compare as instants: rows created here use "...Z", rows pulled from
  // Postgres use "...+00:00", so a string comparison would misorder them.
  const time = (iso: string): number => {
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? 0 : ms;
  };

  return [...cards].sort((a, b) => {
    const diff = time(a.created_at) - time(b.created_at);
    if (diff !== 0) return diff * dir;

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
};

export type CardWithState = {
  id: string;
  deck_id: string;
  type: CardType;
  front: string;
  back: string;
  created_at: string;
  updated_at: string;
  status: CardStatus;
  due: string | null;
  state: number;
};

function toStatus(state: number): CardStatus {
  if (state === State.New) return "new";
  if (state === State.Learning || state === State.Relearning) return "learning";
  return "review";
}

export const useCardsWithState = (
  deckId: string | null,
  limit = CARDS_PAGE_SIZE,
  sort: CardSort = "newest",
) => {
  const total = useLiveQuery(async () => {
    if (!deckId) return 0;

    return db.cards
      .where("deck_id")
      .equals(deckId)
      .filter((c) => c.deleted_at === null)
      .count();
  }, [deckId]);

  const result = useLiveQuery(async () => {
    if (!deckId) return [];

    // Sort before limiting: the page must be the newest (or oldest) cards of
    // the whole deck, not a sorted slice of whatever happened to load first.
    const all = await db.cards
      .where("deck_id")
      .equals(deckId)
      .filter((c) => c.deleted_at === null)
      .toArray();

    const cards = sortCardsByCreated(all, sort).slice(0, limit);

    const cardIds = cards.map((c) => c.id);

    const states = await db.card_state
      .where("card_id")
      .anyOf(cardIds)
      .toArray();

    const stateMap = new Map(states.map((s) => [s.card_id, s]));

    return cards.map((c) => {
      const s = stateMap.get(c.id);
      return {
        id: c.id,
        deck_id: c.deck_id,
        type: c.type,
        front: c.front,
        back: c.back,
        created_at: c.created_at,
        updated_at: c.updated_at,
        status: s ? toStatus(s.state) : ("new" as CardStatus),
        due: s?.due ?? null,
        state: s?.state ?? State.New,
      };
    });
  }, [deckId, limit, sort]);

  return {
    data: result ?? [],
    isLoading: result === undefined,
    total: total ?? 0,
    hasMore: (result?.length ?? 0) < (total ?? 0),
  };
};

export const useMoveCards = () => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      cardIds,
      targetDeckId,
    }: {
      cardIds: string[];
      targetDeckId: string;
    }) => {
      const now = new Date().toISOString();

      await db.cards.where("id").anyOf(cardIds).modify({
        deck_id: targetDeckId,
        updated_at: now,
        pending_sync: 1,
      });

      return cardIds;
    },

    onSuccess: (cardIds) => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      requestSync().catch(console.error);
      toast.success(i18next.t("cardsMoved", { count: cardIds.length }));
    },

    onError: () => {
      toast.error(i18next.t("cardsMovedError"));
    },
  });
};

export const useBulkDeleteCards = () => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (cardIds: string[]) => {
      const now = new Date().toISOString();

      await db.cards.where("id").anyOf(cardIds).modify({
        deleted_at: now,
        updated_at: now,
        pending_sync: 1,
      });

      return cardIds;
    },
    onSuccess: (cardIds) => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      requestSync().catch(console.error);
      toast.success(i18next.t("cardsDeleted", { count: cardIds.length }));
    },
    onError: () => {
      toast.error(i18next.t("cardsDeletedError"));
    },
  });
};
