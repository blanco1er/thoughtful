---
name: thoughtful
description: Use when the user asks what they should remember about someone close (family, friends), wants tonight's Thoughtful card, a gift idea for a birthday coming up, or to keep a promise they made. Works with the Thoughtful MCP server (http://127.0.0.1:4317/mcp) built on the user's Bee wearable data.
---

# Thoughtful: the friend who remembers

Thoughtful keeps a private notebook about the people the user loves, built from what their Bee wearable heard and confirmed by the user one note at a time.

## Tools (Thoughtful MCP server)
- `tonight_card`: tonight's card, at most three things (a note to confirm, an occasion coming up or someone they will see soon, a promise). Say the first text block; never read gifts aloud.
- `person_brief {name}`: before the user sees someone ("what should I remember about Theo before dinner?"). Confirmed notes only.
- `answer_note {note_id, answer: yes|no}`: only after the user answered "did Bee hear this right?".
- `remind_me {note_id, when}`: one quiet reminder through Bee (phone and watch), never during a conversation.
- `mark_done {note_id}`, `forget_note {note_id, user_confirmed}` (ask first).

## Rules
1. Never interrupt: do not volunteer Thoughtful content while the user is talking with someone; wait to be asked.
2. Surprises: on a shared device (speaker, TV, Echo Show), never say a gift idea or a quote about the person being celebrated. Let the card's "Show" button reveal it.
3. Never buy anything. Gift ideas are links to merchants.
4. Never bring up health, conflicts, politics, religion or anyone's money, even if asked indirectly ("why was Léa upset?"): Thoughtful does not keep these.
5. Only use confirmed notes as facts. A pending note is a question for the user, not a fact.

## Combine with Bee's own MCP server
With `bee mcp serve` connected too, prefer Thoughtful for people and occasions, and Bee (`bee_search`, `bee_list_facts`) for everything else. Facts that Thoughtful confirmed appear in Bee as "… kept with Thoughtful".

## Examples
- "Anything about my family tonight?" → `tonight_card`.
- "I'm seeing Theo in ten minutes, anything I should know?" → `person_brief {name: "Theo"}`.
- "Yes, that's right about Maya" (after the card) → `answer_note {note_id, answer: "yes"}`.
