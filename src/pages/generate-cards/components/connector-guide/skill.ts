import { strToU8, zipSync } from "fflate";
import { saveFile } from "./bundle";

// A Claude Skill (upload the zip in Claude → Settings → Capabilities → Skills)
// that teaches Claude how to use the ThinkCards connector. It holds the
// public endpoint URL only, never the token.

export const SKILL_NAME = "thinkcards-connector";

export const buildSkillMarkdown = (connectorUrl: string): string => `---
name: "${SKILL_NAME}"
description: "Save, read, reformat and tidy the user's ThinkCards flashcards through the ThinkCards connector (tools add_cards, list_decks, list_cards, update_cards, delete_cards, configure_deck). Use when the user says 存卡 / save as cards, or asks to organise, fix, convert or clean up their cards or decks."
---

# ThinkCards connector

The user studies flashcards in their own ThinkCards app. A custom connector
called **ThinkCards** gives you tools to change their deck directly; the app
picks the changes up on its next sync. Reply to the user in their language
(usually Chinese).

If the tools are missing, the connector is not installed or not enabled in
this chat. In Claude Desktop the user can install thinkcards.mcpb from the
app's connector page. Elsewhere, tell them to add it once (Settings →
Connectors → Add custom connector):

- Name: ThinkCards
- MCP server URL: ${connectorUrl}
- Authentication: none; add a request header \`Authorization\` with the value
  \`Bearer <their MCP token>\`. Never ask the user to paste the token into the
  chat.

As a fallback, output the cards as a JSON array of {"front", "back"} so the
user can paste it into the app's "Generate with AI" tab.

## Tools

| Tool | Use |
| --- | --- |
| list_decks | Deck names, card counts, card_format, speech language. Call first when tidying. |
| list_cards | Cards with id, deck, type, front, back, reps. Max 200 per call; keep calling with next_offset until it is null. Optional deck_name and search. |
| add_cards | Save new cards (max 100 per call). Duplicate fronts in the same deck are skipped. Optional deck_format when the call creates the deck. |
| update_cards | Edit cards in place by id: front, back, type, deck_name (move), reset_progress. Keeps review history unless reset_progress is true. |
| delete_cards | Soft-delete cards by id. |
| configure_deck | Create a deck or set its card_format / speech language. |

HTML allowed in front and back: p, b, strong, em, br, ul, li. Everything else
is stripped.

## Deck formats

Each deck may have a card_format. The server rejects cards that break it, so
write them right the first time.

**produce**: learn to SAY it (languages the user wants to speak, e.g. English).
- front: Chinese only, the situation and meaning, joined by a half-width colon.
  Example: \`确认时间:到时见\`
- back: the expression in bold, then a tone tag (casual, formal, academic) and
  optionally a short note.
  Example: \`<strong>See you then!</strong><br><em>casual</em>\`

**recognize**: learn to READ it (languages the user lives with but does not
need to speak, e.g. Portuguese in Portugal).
- front: the foreign text exactly as it appears in daily life (signs, menus,
  forms, messages, announcements). Put common variants on separate lines with
  \`<br>\`. No Chinese on the front.
  Example: \`Saída<br>Saída de emergência\`
- back: Chinese meaning, English meaning, and a one-line explanation of where it
  shows up and what to do.
  Example: \`<strong>出口</strong> · Exit<br>商场、地铁、停车场里常见；Saída de emergência 是紧急出口。\`

**no format**: follow the user's instructions. For English expressions the
default is the produce layout.

If a deck has no format but its cards clearly follow one, suggest setting it
with configure_deck.

## Saving cards (存卡)

1. Pick the deck. Use the user's deck name, else "English expressions" for
   English. For a new language deck, pass deck_format in add_cards, or call
   configure_deck first (and set language, e.g. "pt-PT", for text-to-speech).
2. One expression per card. Do not reword fronts that are already saved, or the
   duplicate check will not catch them.
3. Report in one sentence: how many were added and how many were skipped.

## Tidying existing cards (整理卡片)

1. list_decks, then list_cards for the decks involved, paging until
   next_offset is null.
2. Work out the changes. Typical jobs:
   - Swap direction: English-front cards in a produce deck become Chinese front,
     English back.
   - Move foreign-language cards into their own recognize deck and rewrite them
     in that layout (create the deck with configure_deck first).
   - Merge or delete duplicates, fix typos, add missing tone tags.
3. Before writing, show the user a short summary (counts per kind of change and
   3 to 5 before/after examples) and wait for a yes. Always ask before deleting.
4. Prefer update_cards over delete + add: it keeps review history. Set
   reset_progress to true when the card now asks for something different
   (direction swapped, or a recognize card turned into a produce card).
5. Send at most 100 updates per call. After each call, check the "Not updated"
   list, fix those cards and retry once.
6. Finish with a short report: updated, moved, deleted, and anything you left
   alone and why.
`;

export const buildSkillZip = (connectorUrl: string): Uint8Array =>
  zipSync({
    [SKILL_NAME]: {
      "SKILL.md": strToU8(buildSkillMarkdown(connectorUrl)),
    },
  });

export const downloadSkillZip = (connectorUrl: string): void =>
  saveFile(buildSkillZip(connectorUrl), `${SKILL_NAME}.zip`, "application/zip");
