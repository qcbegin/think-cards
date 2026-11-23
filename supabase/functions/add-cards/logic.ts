// Pure validation / sanitising for the add-cards Edge Function.
// No Deno or network APIs here so it can be unit tested with vitest.

export const MAX_CARDS = 100;
export const DEFAULT_DECK_NAME = "English expressions";
export const MAX_DECK_NAME_LENGTH = 100;
export const MAX_FIELD_LENGTH = 5000;

export const CARD_TYPES = ["basic", "cloze", "typing"] as const;
export type CardType = (typeof CARD_TYPES)[number];

const ALLOWED_TAGS = new Set(["p", "b", "strong", "em", "br", "ul", "li"]);
const CLOZE_RE = /\{\{c\d+::[^}]+\}\}/;

export type NewCard = { type: CardType; front: string; back: string };
export type CardError = { index: number; message: string };

export type ParsedRequest =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      deckName: string;
      dryRun: boolean;
      cards: NewCard[];
      errors: CardError[];
    };

const escapeText = (text: string): string =>
  text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Keep only <p> <b> <strong> <em> <br> <ul> <li>, without attributes.
// Other tags are dropped (their text stays); <script>/<style> lose their
// content too; stray < and > are escaped.
export const sanitizeHtml = (input: string): string => {
  const source = input
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let out = "";
  let last = 0;

  for (const match of source.matchAll(tagRe)) {
    const start = match.index ?? 0;
    out += escapeText(source.slice(last, start));

    const name = match[1].toLowerCase();
    if (ALLOWED_TAGS.has(name)) {
      if (name === "br") out += "<br>";
      else out += match[0].startsWith("</") ? `</${name}>` : `<${name}>`;
    }

    last = start + match[0].length;
  }

  out += escapeText(source.slice(last));
  return out.trim();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseAddCardsRequest = (body: unknown): ParsedRequest => {
  if (!isRecord(body)) {
    return { ok: false, status: 400, error: "Body must be a JSON object" };
  }

  let deckName = DEFAULT_DECK_NAME;
  if (body.deck_name !== undefined && body.deck_name !== null) {
    if (typeof body.deck_name !== "string" || !body.deck_name.trim()) {
      return { ok: false, status: 400, error: "deck_name must be a non-empty string" };
    }
    deckName = body.deck_name.trim();
    if (deckName.length > MAX_DECK_NAME_LENGTH) {
      return { ok: false, status: 400, error: "deck_name is too long" };
    }
  }

  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    return { ok: false, status: 400, error: "dry_run must be a boolean" };
  }

  if (!Array.isArray(body.cards) || body.cards.length === 0) {
    return { ok: false, status: 400, error: "cards must be a non-empty array" };
  }

  if (body.cards.length > MAX_CARDS) {
    return { ok: false, status: 400, error: `At most ${MAX_CARDS} cards per request` };
  }

  const cards: NewCard[] = [];
  const errors: CardError[] = [];

  body.cards.forEach((raw: unknown, index: number) => {
    if (!isRecord(raw)) {
      errors.push({ index, message: "Card must be an object" });
      return;
    }

    const type = raw.type ?? "basic";
    if (typeof type !== "string" || !(CARD_TYPES as readonly string[]).includes(type)) {
      errors.push({ index, message: "Invalid type" });
      return;
    }

    if (typeof raw.front !== "string") {
      errors.push({ index, message: "front must be a string" });
      return;
    }
    if (raw.back !== undefined && typeof raw.back !== "string") {
      errors.push({ index, message: "back must be a string" });
      return;
    }
    if (raw.front.length > MAX_FIELD_LENGTH || (raw.back ?? "").length > MAX_FIELD_LENGTH) {
      errors.push({ index, message: "Field is too long" });
      return;
    }

    const front = sanitizeHtml(raw.front);
    if (!front) {
      errors.push({ index, message: "front is empty" });
      return;
    }

    if (type === "cloze") {
      if (!CLOZE_RE.test(front)) {
        errors.push({ index, message: "Cloze front needs {{c1::...}}" });
        return;
      }
      cards.push({ type, front, back: "" });
      return;
    }

    const back = sanitizeHtml(raw.back ?? "");
    if (!back) {
      errors.push({ index, message: "back is empty" });
      return;
    }

    cards.push({ type: type as CardType, front, back });
  });

  return {
    ok: true,
    deckName,
    dryRun: body.dry_run === true,
    cards,
    errors,
  };
};
