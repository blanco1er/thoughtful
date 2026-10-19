# Thoughtful — Devpost submission (draft)

**Track:** Bee (Wearable AI). **Mini challenge:** AWS Builder (Amazon Bedrock). 
**Tagline (≤ 200 chars):** Bee hears what the people you love care about. Thoughtful keeps it quietly and gives it back at the right moment: one calm card at night, one tap on your wrist, never mid-conversation.

---

## Inspiration

The oldest, best-proven wish in personal software is not productivity. It is *remembering what the people we love told us*. Monica, the open-source personal CRM, has 25,000+ GitHub stars; the Hacker News threads about it gathered more than a thousand points. Everyone who tried failed for the same reason: you had to type it all in.

A Bee on your wrist removes the typing. But reading 225 App Store reviews of Bee, and the tests of Friend, Omi, Limitless and Alexa+, taught us what makes people take a wearable off: an AI that **speaks up at the wrong moment**, that **invents facts** (a TV drama becomes "your anger issues"), that buries you in **to-dos and notifications**, that turns into **ads**. And what makes them love it: a small personal detail, given back at the moment it matters. The song your wife asked for that morning, offered when you open Spotify that night. The name of the new neighbours.

Research backs the gift part too: people judge a gift that the recipient themself mentioned as more thoughtful, and givers underestimate this (Gino and Flynn, 2011). Yet 40 to 52 % of people say gift shopping stresses them.

So we built the friend who remembers, with one rule above all: **it never interrupts.**

## What it does

**During the day, nothing.** Bee listens. Thoughtful reads Bee in the background.

**At night, right after Bee's 8 PM summary** (the ritual Bee users already wait for), one calm card on an **Echo Show** or on your **iPhone**. Three things at most:

1. **One note to confirm.** "Maya · sister — Would love to try a pottery wheel class." Under it, her own words and when Bee heard them: *"I have been dying to try a pottery wheel class ever since." · Thu, Oct 15*. **Yes, keep it** or **No**. Nothing is ever used before that tap.
2. **One occasion coming up** (14 days ahead): "Maya's birthday in 12 days." Her own words again, three **real** gift ideas from what she said (Channel3), one **real** place nearby to go together (Google Places). On a shared screen this part stays covered until you tap **Show** (and covers itself again after 10 minutes): the surprise survives the family room. The voice never reads a gift aloud.
3. **One promise to keep.** "You told Theo: book the ramen place on Court Street." Thoughtful only counts it as a promise because Bee recognised **your** voice saying it.

**The next day, at the right moment.** What you kept becomes a **Bee to-do with an alarm**, so it reaches your phone and your watch through Bee itself: 30 minutes before the dinner with Theo that is in your calendar ("Seeing Theo: first half-marathon on Sunday"), or at 9 AM for a promise. Thoughtful waits until Bee has heard no speech for 20 minutes. Never more than two a day.

**And everything you keep makes Bee smarter.** A confirmed note becomes a **confirmed Bee fact** ("Maya (sister) would love: a pottery wheel class. Heard by Bee on 2026-10-15, kept with Thoughtful."). Bee's own guesses about the people close to you ("pending facts") join the same one-tap confirmation. Every agent that reads Bee, Alexa+ included, now knows what you know.

**On Sunday, on the TV:** a family-safe "week with the people you love" (names and counts only, D-pad friendly).

## How it is never annoying (each rule is code with a test)

| Rule | Where |
|---|---|
| Nothing during a conversation: a reminder waits for 20 min of silence (real-time stream) and for no capture in progress | `src/nudges.mjs`, test "a nudge waits for silence" |
| ≤ 3 things per evening, ≤ 3 confirmations per day, ≤ 2 reminders per day | `src/ritual.mjs`, `src/nudges.mjs` |
| Nothing used without "yes"; every note carries its verbatim quote and date | `src/notebook.mjs` |
| A quote the model cannot ground in the transcript is dropped (anti-hallucination) | `quoteIsGrounded`, `src/extract/filters.mjs` |
| Never kept: health, conflicts, politics, religion, other people's money (EN + FR) | `isSensitive` |
| TV, radio, videos: a conversation the owner never spoke in is not read; broadcast phrases are dropped | `conversationGate`, `looksLikeMedia` |
| Surprises hidden on shared screens; never spoken | MCP card + `spokenTonight` |
| No ads, no purchase, no auto-buy | gift links open the merchant |
| Memories expire | `TTL` in `src/notebook.mjs` |

## How we built it

- **Bee, for real:** the official CLI library is imported and called at run time (`createBeeClient` from `@beeai/cli/lib`, `src/bee.mjs`): conversations and transcripts, speaker identification, the real-time stream (with our own reconnection, bug #16), pending facts, `today` (calendar), and **writes**: `facts.create`, `facts.confirm`, `facts.delete`, `todos.create --alarm-at`.
- **Amazon Bedrock (AWS Builder):** Amazon **Nova 2 Lite** through the Converse API extracts likes, wishes, life events, dates, plans and the owner's promises from each finished conversation, in French or English, with a verbatim quote and a confidence. A second prompt triages Bee's pending facts. Throttling falls back from the `us.` to the `global.` inference profile. A **spending cap in code** (1 $/day, 5 $ total) is checked before every call. Measured cost: about **0.1 cent per conversation**.
- **Deterministic guards after the model:** the model proposes, the code decides (grounded quote, owner-only promises, sensitive topics, media, confidence ≥ 0.6, deduplication with "heard 3×").
- **MCP server** (Streamable HTTP, protocol 2025-11-25, stateless) with an **MCP Apps** card (`ui://thoughtful/tonight-….html`): eight tools (`tonight_card`, `answer_note`, `remind_me`, `mark_done`, `person_brief`, `forget_note`, plus app-only `gift_ideas` and `reveal_card`). Each answer's first block is a sentence a voice can say. Shown on an Echo Show 15 / 8 in our open-source host **mcp-voice-host**.
- **iPhone web app** (no framework): first-run with consent, the evening card, people and their notes ("Forget" on each), settings (language EN/FR, reminders per day, quiet time, neighbourhood for places, pause, write to Bee, "Erase everything"), and an activity log that says what Thoughtful did, with counts only.
- **Privacy by construction:** the notebook is a local file (mode 600) on the owner's Mac; no transcript is ever stored; keys live in the macOS Keychain; the repo contains no real data and a check refuses secrets and the owner's last name.
- **Tests:** 37 tests on invented fixtures, including the real `@beeai/cli/lib` driven against a stand-in `bee` binary to check the exact commands sent.

## Challenges we ran into (and measured)

- **When is a conversation over?** Bee closes a conversation about **7 minutes after the last sentence**, then extracts its facts within 30 s. Thoughtful re-reads 90 s after `COMPLETED`.
- **Who said it?** On our account Bee's voice recognition works, but only in the real-time stream (an undocumented speaker event ~10 s after each sentence) and in the REST transcript once the conversation is finished. We built the "promise" rule on that, and a conversation the owner never spoke in (TV, strangers) is not read at all.
- **Todos created by the API never appear in the stream.** We trust the write response.
- Full list with timings: [FRICTION.md](FRICTION.md).

## Accomplishments we're proud of

- A wearable AI that **cannot** interrupt you: the rule is in the scheduler, not in a prompt.
- The evening card fits on one Echo Show screen and reads from across the room; the surprise stays hidden until you say so.
- Real writes into Bee that make its memory better for every other agent.
- 0.1 cent per conversation, with a hard cap.

## What we learned

The best moment for an ambient AI is almost never "now". It is tonight, after the summary you already wait for, or ten minutes before you see the person.

## What's next

- Alexa+ add-on (MCP) on a real Echo Show with Voice ID: the card would reveal surprises only to the owner's voice.
- "Did she like it?" after the occasion, to learn what kind of gift works for whom.
- Shared family notebooks, with each adult's consent.
- Bee could make this native: a "quiet moment" signal and fact sources (see feature requests in FRICTION.md).

## Judging criteria → evidence

| Criterion | Where to see it |
|---|---|
| **Tech implementation** (uses Bee for real) | `src/bee.mjs` (imports `@beeai/cli/lib`), reads + **writes** facts and todos with alarms, stream with reconnection; Bedrock with cap and fallback; MCP + MCP Apps; 37 tests |
| **Design** (complete, coherent, right for each device) | iPhone app EN/FR with onboarding, consent, empty/error states, erase; Echo Show card in three columns sized for reading across the room, surprise cover; TV "Sunday" view with D-pad; UX audit at 0 issues (iPhone, iPad, desktop, light and dark) |
| **Potential impact** | The most-proven personal need (remembering the people we love), the most-quantified pain (gifts), and the #1 reason people quit wearables (interruptions) solved by design. Natural extension of Amazon's own "Connect Bee to Amazon.com", for *other* people and occasions |
| **Quality of the idea** ("Creative" list) | cross-device orchestration (Bee watch → Echo Show → wrist the next day → Fire TV on Sunday), ambient context → productivity workflow, advanced use of **facts** (write, confirm Bee's own, delete), real-time stream for quiet detection, self-improvement ("be the one who remembers") |
| **Friction log bonus** | [FRICTION.md](FRICTION.md): 12 entries measured on a real account + feature requests |

## Built with

Bee CLI library (`@beeai/cli`) · Amazon Bedrock (Amazon Nova 2 Lite) · Model Context Protocol (TypeScript SDK 1.32.1, MCP Apps) · Channel3 · Google Places API (New) · Node.js 22 · HTML/CSS/JS.

## Product feedback (required field)

- **Bee CLI / library** — *Used for* reading conversations, speaker ids, pending facts and the calendar; writing facts and todos; real-time stream. *Worked well:* one import, JSON everywhere, login approved from the Bee app, no rate limit. *Needs work:* stream events for API writes, a documented end-of-conversation signal, fact sources, wrapper signals and npm 11 install (details in FRICTION.md). *Onboarding:* Developer Mode worked with an Apple Watch as the only Bee device. *Build again:* yes.
- **Amazon Bedrock** — *Used for* extraction with Nova 2 Lite (Converse API) and a fallback inference profile. *Worked well:* fast (≈ 2.4 s), cheap, good French. *Needs work:* Anthropic models need a separate use-case form on a new account, which is easy to miss. *Build again:* yes.
- **MCP / MCP Apps** — *Used for* the Echo Show card and the voice tools. *Worked well:* stateless Streamable HTTP is simple. *Needs work:* no public way to test a real Alexa+ add-on; we used our open-source host.
- **AWS services used:** Amazon Bedrock only (runtime). No public hosting of personal data: the server runs on the owner's Mac by design.

## Try it (judges, 2 minutes, no account)

```sh
git clone <repo> && cd thoughtful && npm install && npm run sample
# open http://127.0.0.1:4317  (iPhone layout: use the browser's device mode)
# Echo Show: npx github:blanco1er/mcp-voice-host --server http://127.0.0.1:4317/mcp  → "what's on thoughtful tonight"
# TV: http://127.0.0.1:4317/tv
```
