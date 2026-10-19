# Thoughtful — Devpost submission (ready to paste)

Everything below is meant to be pasted into the Devpost form as is. Facts are the ones we measured; anything not verified says so.

---

## Form fields

| Field | Value |
|---|---|
| **Project name** | Thoughtful |
| **Tagline** (≤ 200 characters) | Bee hears what the people you love care about. Thoughtful keeps it and gives it back at the right moment, and never interrupts a conversation. |
| **Track** | Bee (Wearable AI) |
| **Mini challenge** | AWS Builder (Amazon Bedrock is called at run time; see "AWS services" below) |
| **Repository** | https://github.com/blanco1er/thoughtful (MIT) — *to be made public by the owner* |
| **Demo video** | *YouTube link after upload (public, English, under 3 minutes)* |
| **Other links** | Open-source host used for the Echo Show screens: https://github.com/blanco1er/mcp-voice-host |
| **New or existing project** | New. Everything was built during the submission window (19–21 Oct 2026). |

**Built with** (17 tags, Devpost allows 25): `bee` · `bee-cli` · `amazon-bedrock` · `amazon-nova` · `aws` · `echo-show` · `alexa-plus` · `fire-tv` · `mcp` · `mcp-apps` · `node.js` · `javascript` · `html5` · `css3` · `channel3` · `google-places` · `openstreetmap`

---

## Inspiration

The most proven wish in personal software is not productivity. It is remembering what the people we love tell us. Monica, the open-source "personal CRM", has more than 25,000 GitHub stars, and every tool like it failed for the same reason: you had to type everything in.

A Bee on your wrist removes the typing. But before writing a line of code we read 225 written App Store reviews of Bee and the published tests of Friend, Omi, Limitless and Alexa+. People take a wearable off when the AI **speaks up at the wrong moment**, **invents facts** (a TV drama becomes "your anger issues"), buries them in **to-dos and notifications**, or turns into **ads**. They love it when a small personal detail comes back at the moment it matters, like the name of the new neighbours, or the song a partner asked for that morning.

Gifts are the sharpest case. In surveys, 40 to 52 % of people say gift shopping stresses them, and research shows that a gift the person mentioned themselves is received as more thoughtful than one we pick for them (Gino and Flynn, 2011).

So we built the friend who remembers, with one rule above everything else: **it never interrupts.**

## What it does

**During the day, nothing.** Bee listens; Thoughtful reads Bee in the background.

**In the evening**, right after Bee's own 8 PM summary (a moment Bee users already look forward to), one calm card on an **Echo Show** or an **iPhone**, with three things at most:

1. **One note to confirm.** "Maya · sister: wants to try a pottery wheel class", with her own words and the day Bee heard them. *Yes, keep it* or *No*. Nothing is used before that tap, and there are never more than three questions a day.
2. **One occasion coming up** (14 days ahead): "Maya's birthday in 12 days", her words again, **three real gift ideas** that match them (Channel3, US retailers, between $15 and $250, with the real store) and **a real place nearby** to go together (Google Maps). On a shared screen this part stays covered until you tap **Show**, and covers itself again after ten minutes. The voice never reads a gift aloud.
3. **One promise to keep.** "You told Theo: book the ramen place." It only counts as a promise because Bee's speaker identification says **you** said it.

**The next day, at the right moment.** What you kept becomes a **Bee to-do with an alarm**, so the reminder comes from the Bee app itself: 30 minutes before a calendar event with that person ("Seeing Theo: first half-marathon on Sunday"), or at 9 AM for a promise. Thoughtful only creates it when Bee has heard no speech for 20 minutes, and never more than twice a day.

**Everything you keep improves Bee's memory.** A confirmed note becomes a **confirmed Bee fact** ("Maya (sister) would love: a pottery wheel class. Heard by Bee on 2026-10-15, kept with Thoughtful."), so every agent that reads your Bee facts benefits. Bee's own pending guesses about people close to you go through the same one-tap check. "Forget" deletes the note here **and** in Bee.

**On Sunday, on the TV:** a family-safe view of the week, names and counts only, navigable with a remote.

*(Names above are from the built-in sample household: invented people, clearly labelled in the app.)*

## How it never gets annoying (each rule is code, each has a test)

| Rule | Where in the code |
|---|---|
| Nothing during a conversation: reminders wait for 20 minutes of silence (live stream) and for no capture in progress | `src/nudges.mjs` |
| At most 3 things per evening, 3 questions per day, 2 reminders per day | `src/ritual.mjs`, `src/nudges.mjs` |
| Nothing used without your "yes"; every note carries its verbatim quote and date | `src/notebook.mjs` |
| A quote the model cannot find in the transcript is dropped (anti-hallucination) | `quoteIsGrounded` in `src/extract/filters.mjs` |
| Sentences about health, conflicts, politics, religion or money are removed **on the Mac**, before anything is sent to the model | `transcriptFor` in `src/extract/prompt.mjs` |
| A conversation you were not part of (TV, people nearby) is not read at all | `conversationGate` in `src/engine.mjs` |
| Surprises hidden on shared screens and never spoken | MCP card + `spokenTonight` in `src/mcp.mjs` |
| No ads, no purchase: gift links open the store | `src/lookups.mjs` |
| Memories expire | `TTL` in `src/notebook.mjs` |

## How we built it

- **Bee, for real.** The official CLI library is imported and called at run time (`createBeeClient` from `@beeai/cli/lib` in `src/bee.mjs`): conversations and transcripts, speaker identification, the real-time stream (with our own reconnection), pending facts, the calendar, and **writes**: `facts.create`, `facts.confirm`, `facts.delete`, `todos.create` with an alarm.
- **Amazon Bedrock.** Amazon Nova 2 Lite through the Converse API extracts tastes, wishes, life events, dates, plans and the owner's promises, in French or English, each with a verbatim quote and a confidence. Long conversations (a family dinner can be 70,000 characters) are read in overlapping windows of about 20,000 characters cut between sentences, then merged. Throttling falls back to the `global.` inference profile. A **spending cap in code** (1 $ a day, 5 $ in total) is checked before every call.
- **Guards after the model.** The model proposes, the code decides: verbatim quote, owner-only promises, sensitive topics, media, confidence, and duplicates across windows.
- **Measured, not promised.** `scripts/bench-extraction.mjs` runs 10 invented French and English conversations with known answers. Across our runs, **79 to 93 % of what should be kept is kept** (Nova is not fully deterministic), with **0 leaks in every run**: no health, conflict, vote, debt, TV line, joke or someone else's promise was ever kept. Under one cent per run.
- **Real data from real services.** Gift ideas from Channel3 with the real store name, in a gift price range. From Google Places, **only the place ID is ever stored** (Google Maps Platform terms); name, address and rating are fetched live, kept in memory for an hour and shown with the "Google Maps" attribution. Without a Google key, places come from OpenStreetMap with its attribution.
- **Echo Show.** Thoughtful is an MCP server (Streamable HTTP, protocol 2025-11-25) with an **MCP Apps** card and eight tools. There is no public way to install an add-on on a real Echo, so the screens in the video and gallery run in our open-source Alexa+-style host, **mcp-voice-host**, in Echo Show 15 and Echo Show 8 frames. Its 24-rule Alexa+ voice lint reports no finding.
- **iPhone web app**, no framework, in English and French: first launch with consent, the evening card, people and their notes, settings (pause, reminders per day, quiet time, write to Bee, AWS access check, "Erase everything") and a log of what Thoughtful did, in counts only.
- **Privacy by construction.** The notebook is a local file (mode 600) on the owner's Mac. Transcripts are never stored. Keys live in the macOS Keychain. The repository contains no real data, and a check refuses secrets, runtime files and the owner's last name.
- **50 automated tests** on invented data, including the real `@beeai/cli/lib` driven against a stand-in `bee` binary to check the exact commands sent.

## Challenges we ran into (measured on a real account)

- **When is a conversation over?** Bee closes a conversation about seven minutes after the last sentence and creates its pending facts at that moment. Thoughtful reads it 90 seconds later.
- **Who said it?** On our account Bee's voice recognition works, but the REST transcript only carries the owner's name once the conversation has ended; during capture, an undocumented stream event carries it about ten seconds after each sentence.
- **A real 85-minute family conversation first produced nothing.** Our first version read only the first 24,000 characters, and the model treated long monologues as TV. We added the overlapping windows, told the model that a conversation the owner takes part in is real life, and made an unnamed speaker a "someone you talked with" the owner can name later. All of this was diagnosed in counts only, without reading the conversation.
- **To-dos created through the API never appear in the stream.** Full list with timings and suggestions: `FRICTION.md` (12 entries).

## Accomplishments we're proud of

- A wearable AI that cannot interrupt you: the rule is in the scheduler, not in a prompt.
- Real writes into Bee that make its memory better for every other agent.
- An evening card that fits one Echo Show screen and keeps the surprise.
- Honest numbers: a benchmark with 0 leaks, and a spending cap in code.

## What we learned

The best moment for an ambient AI is almost never "now". It is tonight, after the summary you already wait for, or ten minutes before you see the person.

## What's next

- A real Alexa+ add-on with Voice ID, so the card reveals surprises only to the owner's voice.
- "Did she like it?" after the occasion, to learn which kinds of gifts work for whom.
- Shared family notebooks, with each adult's consent.
- In Bee itself: a "quiet moment" signal and fact sources would make this native (see the feature requests in FRICTION.md).

## Judging criteria → evidence

| Criterion | Where to see it |
|---|---|
| **Tech implementation** | `src/bee.mjs` imports `@beeai/cli/lib`; reads, and **writes** facts and alarm to-dos; live stream with reconnection; Bedrock with windows, cap and fallback; MCP + MCP Apps; 50 tests; extraction benchmark |
| **Design** | One coherent product on four surfaces: Echo Show card (three columns, surprise cover), iPhone app (EN/FR, consent, empty and error states, erase), wrist reminders, TV view; universal UX audit with 0 issues on iPhone, iPad and desktop, light and dark |
| **Potential impact** | The most proven personal need (remembering the people we love), the most quantified pain (gifts), and the main reason people stop wearing AI devices (interruptions), addressed by design |
| **Quality of the idea** | Cross-device orchestration (Bee → Echo Show → wrist the next day → TV on Sunday), ambient context turned into a productivity workflow, advanced use of Bee **facts** (write, confirm Bee's own, delete), real-time stream for quiet detection, an Agent Skill (`skill/thoughtful`) |
| **Friction log bonus** | `FRICTION.md`: 12 entries measured on a real account, with workarounds and feature requests |

## AWS services (for the product feedback field)

Amazon Bedrock only, at run time: Amazon Nova 2 Lite through the Converse API, `us.` inference profile with a `global.` fallback on throttling, in us-east-1. No public hosting of personal data: by design the server runs on the owner's Mac. Measured cost: about 0.1 cent for a 25-minute conversation, about half a cent for an 85-minute one (four windows).

## Product feedback (required field)

- **Bee CLI and library.** *Used for:* reading conversations, speaker identities, pending facts and the calendar; writing facts and to-dos; the real-time stream. *Worked well:* one import, JSON everywhere, sign-in approved from the Bee app, no rate limit, Developer Mode with an Apple Watch only. *Needs work:* stream events for API writes, a documented end-of-conversation signal, sources on facts, signal forwarding in the npm wrapper, npm 11 skipping `postinstall` (details in FRICTION.md). *Would build again:* yes.
- **Amazon Bedrock.** *Used for:* extraction with Nova 2 Lite. *Worked well:* fast (about 2.4 s per call), cheap, good French. *Needs work:* on a new account, Anthropic models need a separate use-case form that is easy to miss. *Would build again:* yes.
- **MCP and MCP Apps.** *Used for:* the Echo Show card and the voice tools. *Worked well:* stateless Streamable HTTP is simple; the official Inspector CLI passes. *Needs work:* no public way to test a real Alexa+ add-on, so we used our own open-source host.

## Not verified yet (said plainly)

- Whether a Bee to-do alarm makes the Apple Watch vibrate (the result of our watch test is still to be recorded in `docs/watch-test.md`).
- Behaviour on a physical Echo Show or Fire TV (simulated host and TV browser view only).

## Try it in 2 minutes (judges, no account needed)

```sh
git clone https://github.com/blanco1er/thoughtful && cd thoughtful
npm install
npm run sample                      # invented household, works offline
# iPhone layout: open http://127.0.0.1:4317 in your browser's device mode
# Echo Show:     npx github:blanco1er/mcp-voice-host --server http://127.0.0.1:4317/mcp
#                then type "what's on thoughtful tonight"
# TV view:       http://127.0.0.1:4317/tv
```

The sample household replays a recorded Bedrock extraction of invented conversations and a dated snapshot of real Channel3 results, so no key is needed. With your own Bee: `npx bee login`, `node bin/thoughtful.mjs config aws-profile <profile>`, `npm start`.
