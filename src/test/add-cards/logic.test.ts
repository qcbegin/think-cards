import { describe, expect, it } from "vitest";
import {
  DEFAULT_DECK_NAME,
  MAX_CARDS,
  parseAddCardsRequest,
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
