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

export const CARD_FORMATS = ["produce", "recognize"] as const;
export type CardFormat = (typeof CARD_FORMATS)[number];

// Shown to Claude (tool descriptions, list_decks) so it writes cards in the
// layout each deck asks for.
export const FORMAT_RULES: Record<CardFormat, string> = {
  produce:
    "produce (learn to SAY it): front = Chinese only, the situation and meaning " +
    "(e.g. 确认时间:到时见). back = the expression in the target language, wrapped in " +
    "<strong>, then a short tone/usage note such as <em>casual</em>.",
  recognize:
    "recognize (learn to READ it): front = the foreign text exactly as it appears in " +
    "daily life (signs, menus, forms, messages); put variants on separate lines with <br>. " +
    "No Chinese on the front. back = 中文意思, the English meaning, and a short " +
    "explanation of where you see it and what to do.",
};

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN_RE = /[A-Za-z\u00c0-\u024f]/;
const stripTags = (html: string): string => html.replace(/<[^>]*>/g, " ");

// Light check that a card follows its deck's format. Cloze cards are free.
export const checkFormat = (
  format: CardFormat | null,
  card: { type: CardType; front: string; back: string },
): string | null => {
  if (!format || card.type === "cloze") return null;
  const front = stripTags(card.front);
  const back = stripTags(card.back);

  if (format === "produce") {
    if (!CJK_RE.test(front)) return "produce deck: front must be Chinese";
    if (!LATIN_RE.test(back)) return "produce deck: back must hold the foreign expression";
    return null;
  }
  if (CJK_RE.test(front)) return "recognize deck: front must be the foreign text, without Chinese";
  if (!CJK_RE.test(back) || !LATIN_RE.test(back)) {
    return "recognize deck: back must explain the text in Chinese and English";
  }
  return null;
};

export const parseCardFormat = (
  value: unknown,
): { ok: true; format: CardFormat | null } | { ok: false } => {
  if (value === null || value === "none") return { ok: true, format: null };
  if (typeof value === "string" && (CARD_FORMATS as readonly string[]).includes(value)) {
    return { ok: true, format: value as CardFormat };
  }
  return { ok: false };
};

export type NewCard = { type: CardType; front: string; back: string };
export type CardError = { index: number; message: string };

export type ParsedRequest =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      deckName: string;
      dryRun: boolean;
      // Only used if the deck does not exist yet.
      deckFormat: CardFormat | null;
      cards: NewCard[];
      // Request index of each entry in `cards`, for error messages.
      indexes: number[];
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

  let deckFormat: CardFormat | null = null;
  if (body.deck_format !== undefined) {
    const f = parseCardFormat(body.deck_format);
    if (!f.ok) return { ok: false, status: 400, error: "deck_format must be produce, recognize or none" };
    deckFormat = f.format;
  }

  if (!Array.isArray(body.cards) || body.cards.length === 0) {
    return { ok: false, status: 400, error: "cards must be a non-empty array" };
  }

  if (body.cards.length > MAX_CARDS) {
    return { ok: false, status: 400, error: `At most ${MAX_CARDS} cards per request` };
  }

  const cards: NewCard[] = [];
  const indexes: number[] = [];
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
      indexes.push(index);
      return;
    }

    const back = sanitizeHtml(raw.back ?? "");
    if (!back) {
      errors.push({ index, message: "back is empty" });
      return;
    }

    cards.push({ type: type as CardType, front, back });
    indexes.push(index);
  });

  return {
    ok: true,
    deckName,
    dryRun: body.dry_run === true,
    deckFormat,
    cards,
    indexes,
    errors,
  };
};

// Move cards that break the deck format into errors.
export const applyFormat = (
  parsed: { cards: NewCard[]; indexes: number[]; errors: CardError[] },
  format: CardFormat | null,
): { cards: NewCard[]; indexes: number[]; errors: CardError[] } => {
  const cards: NewCard[] = [];
  const indexes: number[] = [];
  const errors = [...parsed.errors];
  parsed.cards.forEach((card, i) => {
    const problem = checkFormat(format, card);
    if (problem) errors.push({ index: parsed.indexes[i], message: problem });
    else {
      cards.push(card);
      indexes.push(parsed.indexes[i]);
    }
  });
  errors.sort((a, b) => a.index - b.index);
  return { cards, indexes, errors };
};

// ---------------------------------------------------------------------------
// list_cards / update_cards / delete_cards / configure_deck
// ---------------------------------------------------------------------------

export const MAX_LIST_LIMIT = 200;
export const DEFAULT_LIST_LIMIT = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_RE.test(value);

type Fail = { ok: false; status: number; error: string };
const fail = (error: string): Fail => ({ ok: false, status: 400, error });

const optionalDeckName = (value: unknown): { ok: true; name: string | null } | Fail => {
  if (value === undefined || value === null) return { ok: true, name: null };
  if (typeof value !== "string" || !value.trim()) return fail("deck_name must be a non-empty string");
  if (value.trim().length > MAX_DECK_NAME_LENGTH) return fail("deck_name is too long");
  return { ok: true, name: value.trim() };
};

export type ListCardsRequest = {
  ok: true;
  deckName: string | null;
  search: string | null;
  offset: number;
  limit: number;
};

export const parseListCardsRequest = (body: unknown): ListCardsRequest | Fail => {
  const b = isRecord(body) ? body : {};
  const deck = optionalDeckName(b.deck_name);
  if (!deck.ok) return deck;

  const offset = b.offset ?? 0;
  if (!Number.isInteger(offset) || (offset as number) < 0) return fail("offset must be a non-negative integer");
  const limit = b.limit ?? DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_LIST_LIMIT) {
    return fail(`limit must be between 1 and ${MAX_LIST_LIMIT}`);
  }

  let search: string | null = null;
  if (b.search !== undefined && b.search !== null) {
    if (typeof b.search !== "string") return fail("search must be a string");
    search = b.search.trim() || null;
  }

  return { ok: true, deckName: deck.name, search, offset: offset as number, limit: limit as number };
};

export type CardEdit = {
  id: string;
  front?: string;
  back?: string;
  type?: CardType;
  deckName?: string;
  resetProgress: boolean;
};
export type EditError = { id: string; message: string };

export type UpdateCardsRequest = { ok: true; edits: CardEdit[]; errors: EditError[] };

export const parseUpdateCardsRequest = (body: unknown): UpdateCardsRequest | Fail => {
  if (!isRecord(body)) return fail("Body must be a JSON object");
  if (!Array.isArray(body.updates) || body.updates.length === 0) {
    return fail("updates must be a non-empty array");
  }
  if (body.updates.length > MAX_CARDS) return fail(`At most ${MAX_CARDS} updates per request`);

  const edits: CardEdit[] = [];
  const errors: EditError[] = [];
  const seen = new Set<string>();

  for (const raw of body.updates as unknown[]) {
    if (!isRecord(raw) || !isUuid(raw.id)) {
      errors.push({ id: isRecord(raw) ? String(raw.id) : "?", message: "id must be a card id" });
      continue;
    }
    const id = raw.id.toLowerCase();
    if (seen.has(id)) {
      errors.push({ id, message: "card listed twice" });
      continue;
    }
    seen.add(id);

    const edit: CardEdit = { id, resetProgress: raw.reset_progress === true };
    let bad: string | null = null;

    for (const field of ["front", "back"] as const) {
      const v = raw[field];
      if (v === undefined) continue;
      if (typeof v !== "string") bad = `${field} must be a string`;
      else if (v.length > MAX_FIELD_LENGTH) bad = "Field is too long";
      else edit[field] = sanitizeHtml(v);
    }
    if (raw.type !== undefined) {
      if (typeof raw.type !== "string" || !(CARD_TYPES as readonly string[]).includes(raw.type)) bad = "Invalid type";
      else edit.type = raw.type as CardType;
    }
    if (raw.deck_name !== undefined) {
      const deck = optionalDeckName(raw.deck_name);
      if (!deck.ok) bad = deck.error;
      else if (deck.name) edit.deckName = deck.name;
    }
    if (raw.reset_progress !== undefined && typeof raw.reset_progress !== "boolean") {
      bad = "reset_progress must be a boolean";
    }
    if (!bad && edit.front === undefined && edit.back === undefined && !edit.type && !edit.deckName && !edit.resetProgress) {
      bad = "nothing to change";
    }

    if (bad) errors.push({ id, message: bad });
    else edits.push(edit);
  }

  return { ok: true, edits, errors };
};

export type ExistingCard = { id: string; deck_id: string; type: CardType; front: string; back: string };
export type ResolvedEdit = ExistingCard & { reset_progress: boolean };

// Merge an edit into the stored card and check the result like a new card.
export const resolveEdit = (
  edit: CardEdit,
  current: ExistingCard,
  target: { id: string; card_format: CardFormat | null },
): { ok: true; row: ResolvedEdit } | { ok: false; message: string } => {
  const type = edit.type ?? current.type;
  const front = edit.front ?? current.front;
  const back = type === "cloze" ? "" : (edit.back ?? current.back);

  if (!front) return { ok: false, message: "front is empty" };
  if (type === "cloze" && !CLOZE_RE.test(front)) return { ok: false, message: "Cloze front needs {{c1::...}}" };
  if (type !== "cloze" && !back) return { ok: false, message: "back is empty" };

  const problem = checkFormat(target.card_format, { type, front, back });
  if (problem) return { ok: false, message: problem };

  return {
    ok: true,
    row: { id: current.id, deck_id: target.id, type, front, back, reset_progress: edit.resetProgress },
  };
};

export const parseDeleteCardsRequest = (body: unknown): { ok: true; ids: string[] } | Fail => {
  if (!isRecord(body) || !Array.isArray(body.ids) || body.ids.length === 0) {
    return fail("ids must be a non-empty array");
  }
  if (body.ids.length > MAX_CARDS) return fail(`At most ${MAX_CARDS} ids per request`);
  if (!body.ids.every(isUuid)) return fail("every id must be a card id");
  return { ok: true, ids: [...new Set((body.ids as string[]).map((id) => id.toLowerCase()))] };
};

export type ConfigureDeckRequest = {
  ok: true;
  deckName: string;
  changes: { card_format?: CardFormat | null; language?: string | null };
};

export const parseConfigureDeckRequest = (body: unknown): ConfigureDeckRequest | Fail => {
  if (!isRecord(body)) return fail("Body must be a JSON object");
  const deck = optionalDeckName(body.deck_name);
  if (!deck.ok) return deck;
  if (!deck.name) return fail("deck_name is required");

  const changes: ConfigureDeckRequest["changes"] = {};
  if (body.card_format !== undefined) {
    const f = parseCardFormat(body.card_format);
    if (!f.ok) return fail("card_format must be produce, recognize or none");
    changes.card_format = f.format;
  }
  if (body.language !== undefined) {
    if (body.language === null || body.language === "none") changes.language = null;
    else if (typeof body.language !== "string" || !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(body.language)) {
      return fail('language must be a code like "en" or "pt-PT"');
    } else changes.language = body.language;
  }

  return { ok: true, deckName: deck.name, changes };
};
