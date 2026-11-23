import { db } from "@/lib/db";
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { sortCardsByCreated, useCardsWithState } from "@/hooks/useCardsWithState";
import { clearDb, makeCard } from "@/test/helpers";

beforeEach(async () => {
  await clearDb();
});

describe("sortCardsByCreated", () => {
  const card = (id: string, created_at: string) => ({ id, created_at });

  it("orders newest first and oldest first", () => {
    const cards = [
      card("a", "2026-11-01T10:00:00.000Z"),
      card("b", "2026-11-03T10:00:00.000Z"),
      card("c", "2026-11-02T10:00:00.000Z"),
    ];

    expect(sortCardsByCreated(cards, "newest").map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(sortCardsByCreated(cards, "oldest").map((c) => c.id)).toEqual(["a", "c", "b"]);
  });

  it("compares instants across 'Z' and '+00:00' formats", () => {
    // Same minute, written the two ways local and Postgres rows use.
    const cards = [
      card("local", "2026-11-23T16:17:00.500Z"),
      card("server", "2026-11-23T16:17:00.900000+00:00"),
      card("earlier", "2026-11-23T16:16:59.999Z"),
    ];

    expect(sortCardsByCreated(cards, "newest").map((c) => c.id)).toEqual([
      "server",
      "local",
      "earlier",
    ]);
  });

  it("breaks ties by id and does not mutate its input", () => {
    const cards = [card("z", "2026-11-01T00:00:00Z"), card("a", "2026-11-01T00:00:00Z")];
    const copy = [...cards];

    expect(sortCardsByCreated(cards, "newest").map((c) => c.id)).toEqual(["a", "z"]);
    expect(cards).toEqual(copy);
  });
});

describe("useCardsWithState sorting", () => {
  it("applies the limit after sorting, so the page holds the newest cards of the whole deck", async () => {
    const deckId = crypto.randomUUID();
    const cards = Array.from({ length: 5 }, (_, i) =>
      makeCard({
        deck_id: deckId,
        front: `card ${i}`,
        created_at: `2026-11-0${i + 1}T10:00:00.000Z`,
      }),
    );
    // Insert in scrambled order so storage order says nothing about age.
    await db.cards.bulkAdd([cards[2], cards[4], cards[0], cards[3], cards[1]]);

    const newest = renderHook(() => useCardsWithState(deckId, 2, "newest"));
    await waitFor(() => expect(newest.result.current.isLoading).toBe(false));
    expect(newest.result.current.data.map((c) => c.front)).toEqual(["card 4", "card 3"]);
    expect(newest.result.current.total).toBe(5);
    expect(newest.result.current.hasMore).toBe(true);
    expect(newest.result.current.data[0].created_at).toBe("2026-11-05T10:00:00.000Z");

    const oldest = renderHook(() => useCardsWithState(deckId, 2, "oldest"));
    await waitFor(() => expect(oldest.result.current.isLoading).toBe(false));
    expect(oldest.result.current.data.map((c) => c.front)).toEqual(["card 0", "card 1"]);
  });

  it("skips deleted cards", async () => {
    const deckId = crypto.randomUUID();
    await db.cards.bulkAdd([
      makeCard({ deck_id: deckId, front: "kept", created_at: "2026-11-01T00:00:00Z" }),
      makeCard({
        deck_id: deckId,
        front: "gone",
        created_at: "2026-11-09T00:00:00Z",
        deleted_at: "2026-11-10T00:00:00Z",
      }),
    ]);

    const { result } = renderHook(() => useCardsWithState(deckId, 10, "newest"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data.map((c) => c.front)).toEqual(["kept"]);
  });
});
