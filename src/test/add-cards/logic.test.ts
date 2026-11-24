import { describe, expect, it } from "vitest";
import {
  DEFAULT_DECK_NAME,
  MAX_CARDS,
  applyFormat,
  checkFormat,
  parseAddCardsRequest,
  parseConfigureDeckRequest,
  parseDeleteCardsRequest,
  parseListCardsRequest,
  parseUpdateCardsRequest,
  resolveEdit,
  sanitizeHtml,
} from "../../../supabase/functions/add-cards/logic";

const ok = (body: unknown) => {
  const result = parseAddCardsRequest(body);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result;
};

describe("sanitizeHtml", () => {
  it("keeps the allowed tags and drops attributes", () => {
    expect(
      sanitizeHtml('<strong class="x" onclick="a()">Hi</strong><br/><em>casual</em>'),
    ).toBe("<strong>Hi</strong><br><em>casual</em>");
    expect(sanitizeHtml("<ul><li>a</li><li>b</li></ul><p>c</p><b>d</b>")).toBe(
      "<ul><li>a</li><li>b</li></ul><p>c</p><b>d</b>",
    );
  });

  it("drops other tags but keeps their text", () => {
    expect(sanitizeHtml('<div><a href="http://x">link</a> <img src=x onerror=a()></div>')).toBe(
      "link",
    );
  });

  it("removes script and style blocks with their content", () => {
    expect(sanitizeHtml("a<script>alert(1)</script>b<style>p{}</style>c")).toBe("abc");
    expect(sanitizeHtml("x<!-- hidden -->y")).toBe("xy");
  });

  it("escapes stray angle brackets", () => {
    expect(sanitizeHtml("1 < 2 and 3 > 2")).toBe("1 &lt; 2 and 3 &gt; 2");
    expect(sanitizeHtml("<b hello")).toBe("&lt;b hello");
  });

  it("is idempotent", () => {
    const once = sanitizeHtml('<b>a</b> <i>b</i> <script>x</script> 1<2');
    expect(sanitizeHtml(once)).toBe(once);
  });
});

describe("parseAddCardsRequest", () => {
  it("applies defaults", () => {
    const r = ok({ cards: [{ front: " 你好 ", back: "<strong>Hello</strong>" }] });
    expect(r.deckName).toBe(DEFAULT_DECK_NAME);
    expect(r.dryRun).toBe(false);
    expect(r.cards).toEqual([{ type: "basic", front: "你好", back: "<strong>Hello</strong>" }]);
    expect(r.errors).toEqual([]);
  });

  it("accepts a custom deck name and dry_run", () => {
    const r = ok({ deck_name: "  Talks ", dry_run: true, cards: [{ front: "a", back: "b" }] });
    expect(r.deckName).toBe("Talks");
    expect(r.dryRun).toBe(true);
  });

  it("rejects bad top-level input", () => {
    for (const body of [null, [], "x", {}, { cards: [] }, { cards: "no" }]) {
      expect(parseAddCardsRequest(body).ok).toBe(false);
    }
    expect(parseAddCardsRequest({ cards: [{ front: "a", back: "b" }], deck_name: "  " }).ok).toBe(false);
    expect(parseAddCardsRequest({ cards: [{ front: "a", back: "b" }], deck_name: "x".repeat(101) }).ok).toBe(false);
    expect(parseAddCardsRequest({ cards: [{ front: "a", back: "b" }], dry_run: "yes" }).ok).toBe(false);
  });

  it("rejects more than the per-request limit", () => {
    const cards = Array.from({ length: MAX_CARDS + 1 }, (_, i) => ({ front: `f${i}`, back: "b" }));
    const r = parseAddCardsRequest({ cards });
    expect(r.ok).toBe(false);
    expect(ok({ cards: cards.slice(0, MAX_CARDS) }).cards).toHaveLength(MAX_CARDS);
  });

  it("reports empty or invalid cards per index and keeps the rest", () => {
    const r = ok({
      cards: [
        { front: "ok", back: "fine" },
        { front: "   ", back: "x" },
        { front: "no back" },
        { front: "<div></div>", back: "x" },
        { front: "bad type", back: "x", type: "audio" },
        "string",
        { front: 5, back: "x" },
      ],
    });
    expect(r.cards).toHaveLength(1);
    expect(r.errors.map((e) => e.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("handles cloze cards like the client", () => {
    const r = ok({
      cards: [
        { type: "cloze", front: "I {{c1::look forward}} to it", back: "ignored" },
        { type: "cloze", front: "no deletion here" },
      ],
    });
    expect(r.cards).toEqual([{ type: "cloze", front: "I {{c1::look forward}} to it", back: "" }]);
    expect(r.errors).toEqual([{ index: 1, message: "Cloze front needs {{c1::...}}" }]);
  });

  it("requires back for typing cards", () => {
    const r = ok({ cards: [{ type: "typing", front: "a", back: "b" }, { type: "typing", front: "c" }] });
    expect(r.cards).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
  });

  it("sanitises both fields before they are stored", () => {
    const r = ok({ cards: [{ front: "<b onclick=x>hi</b><script>x</script>", back: "<a href=y>b</a>" }] });
    expect(r.cards[0]).toEqual({ type: "basic", front: "<b>hi</b>", back: "b" });
  });

  it("rejects oversized fields", () => {
    const r = ok({ cards: [{ front: "a".repeat(5001), back: "b" }] });
    expect(r.cards).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
  });
});

describe("card formats", () => {
  it("checks produce and recognize layouts, and leaves cloze and unformatted decks alone", () => {
    const produce = { type: "basic" as const, front: "确认时间:到时见", back: "<strong>See you then!</strong>" };
    expect(checkFormat("produce", produce)).toBeNull();
    expect(checkFormat("produce", { ...produce, front: "See you then!", back: "到时见" })).toMatch(/front must be Chinese/);

    const recognize = { type: "basic" as const, front: "Saída", back: "出口<br>Exit — 商场、地铁里常见" };
    expect(checkFormat("recognize", recognize)).toBeNull();
    expect(checkFormat("recognize", { ...recognize, back: "Exit" })).toMatch(/Chinese and English/);
    expect(checkFormat("recognize", { ...recognize, front: "出口 Saída" })).toMatch(/without Chinese/);

    expect(checkFormat(null, { ...produce, front: "x" })).toBeNull();
    expect(checkFormat("produce", { type: "cloze", front: "{{c1::a}}", back: "" })).toBeNull();
  });

  it("parses deck_format and moves cards that break it into errors with their request index", () => {
    const parsed = parseAddCardsRequest({
      deck_format: "produce",
      cards: [
        { front: "", back: "x" },
        { front: "See you", back: "到时见" },
        { front: "到时见", back: "See you then!" },
      ],
    });
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.deckFormat).toBe("produce");
    expect(parsed.indexes).toEqual([1, 2]);

    const applied = applyFormat(parsed, "produce");
    expect(applied.cards.map((c) => c.front)).toEqual(["到时见"]);
    expect(applied.indexes).toEqual([2]);
    expect(applied.errors.map((e) => e.index)).toEqual([0, 1]);

    expect(parseAddCardsRequest({ deck_format: "bogus", cards: [{ front: "a", back: "b" }] }).ok).toBe(false);
  });
});

describe("edit requests", () => {
  const id = "0b0e7c1a-3c1e-4a51-9d0e-6f7e3c2a1b00";
  const other = "1b0e7c1a-3c1e-4a51-9d0e-6f7e3c2a1b00";

  it("parses list_cards paging", () => {
    expect(parseListCardsRequest({})).toMatchObject({ ok: true, offset: 0, limit: 100, deckName: null });
    expect(parseListCardsRequest({ limit: 500 }).ok).toBe(false);
    expect(parseListCardsRequest({ offset: -1 }).ok).toBe(false);
    expect(parseListCardsRequest({ search: "  hi " })).toMatchObject({ search: "hi" });
  });

  it("parses update_cards, sanitising and reporting bad items", () => {
    const r = parseUpdateCardsRequest({
      updates: [
        { id, front: "<a href=x>到时见</a>", reset_progress: true },
        { id },
        { id: "nope", front: "x" },
        { id, back: "dup" },
      ],
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.edits).toEqual([{ id, front: "到时见", resetProgress: true }]);
    expect(r.errors.map((e) => e.message)).toEqual([
      "card listed twice",
      "id must be a card id",
      "card listed twice",
    ]);
    expect(parseUpdateCardsRequest({ updates: [] }).ok).toBe(false);
  });

  it("flags an edit with nothing to change", () => {
    const r = parseUpdateCardsRequest({ updates: [{ id: other }] });
    if (!r.ok) throw new Error("expected ok");
    expect(r.errors).toEqual([{ id: other, message: "nothing to change" }]);
  });

  it("merges edits and checks the target deck's format", () => {
    const card = { id, deck_id: "d1", type: "basic" as const, front: "See you then!", back: "到时见" };
    const swapped = resolveEdit(
      { id, front: "到时见", back: "<strong>See you then!</strong>", resetProgress: true },
      card,
      { id: "d1", card_format: "produce" },
    );
    expect(swapped).toEqual({
      ok: true,
      row: { ...card, front: "到时见", back: "<strong>See you then!</strong>", reset_progress: true },
    });

    const moved = resolveEdit({ id, deckName: "PT", resetProgress: false }, card, { id: "d2", card_format: "produce" });
    expect(moved).toEqual({ ok: false, message: "produce deck: front must be Chinese" });

    const toCloze = resolveEdit({ id, type: "cloze", resetProgress: false }, card, { id: "d1", card_format: null });
    expect(toCloze).toEqual({ ok: false, message: "Cloze front needs {{c1::...}}" });
  });

  it("parses delete_cards and configure_deck", () => {
    expect(parseDeleteCardsRequest({ ids: [id, id.toUpperCase()] })).toEqual({ ok: true, ids: [id] });
    expect(parseDeleteCardsRequest({ ids: ["x"] }).ok).toBe(false);

    expect(parseConfigureDeckRequest({ deck_name: "PT", card_format: "recognize", language: "pt-PT" })).toEqual({
      ok: true,
      deckName: "PT",
      changes: { card_format: "recognize", language: "pt-PT" },
    });
    expect(parseConfigureDeckRequest({ deck_name: "PT", card_format: "none", language: "none" })).toMatchObject({
      changes: { card_format: null, language: null },
    });
    expect(parseConfigureDeckRequest({ card_format: "produce" }).ok).toBe(false);
    expect(parseConfigureDeckRequest({ deck_name: "PT", language: "Portuguese" }).ok).toBe(false);
  });
});
