# Friction log: building Thoughtful on Bee

Real issues met while building Thoughtful with `@beeai/cli` 0.8.0 (library `@beeai/cli/lib`, macOS, Apple Watch as the only Bee device, account created on 19 Oct 2026). Every entry was reproduced on the real account; timings are measured, not estimated. Where another developer reported the same thing first, the issue is linked.

Severity: **High** blocks a use case · **Medium** costs hours or forces a workaround · **Low** papercut.

---

### 1. A todo created through the API never shows up in the real-time stream
- **Task:** know, in real time, that Thoughtful's reminder reached Bee (and later, that it was ticked on the watch).
- **Steps:** `bee.sse.streamJson({ types: ['all'] })` connected; one minute later `bee.api.todos.create({ text, alarmAt })`.
- **Expected:** a `todo-created` event, as listed in the realtime docs.
- **Actual:** no todo event at all (the stream was healthy: 367 `new-utterance` events arrived in the same session).
- **Severity:** Medium.
- **Workaround:** we trust the create call's response and never wait for an event.
- **Suggestion:** emit `todo-created/updated` for API writes too, or document that only app-side changes are streamed.

### 2. Conversations close about 7 minutes after the last sentence, facts only then, and none of it is documented
- **Task:** read a conversation as soon as it is over, to prepare the evening card.
- **Measured:** last sentence 15:17:27 → `update-conversation` with state `PROCESSING` 15:24:35 → `COMPLETED` 15:25:04. Bee's pending facts for that conversation were created at the minute of `COMPLETED`; none before. Same pattern on 4 conversations (23 to 35 minutes long). A 9.5-minute conversation produced no fact at all.
- **Expected:** a documented silence threshold and a stream event when facts are extracted.
- **Severity:** Medium.
- **Workaround:** Thoughtful re-reads 90 s after `COMPLETED`.
- **Suggestion:** document the silence threshold and the `PROCESSING` state; add a `facts-created` stream event (or put facts in `/v1/changes` with the conversation id).

### 3. Speaker identification: named in the stream, "Unknown" in the REST API during capture
- **Task:** keep a promise only if the owner said it.
- **Measured:** in the stream, ~10 s after each sentence, an undocumented event arrives with `{type, utterance_id, person_id, person_first_name, speaker_score, conversation_uuid}` (173 of them in 25 min). `GET /v1/conversations/:id` on the same conversation, still capturing, returned `speaker: "Unknown"` for every line. Once the conversation completed, the REST transcript carried the owner's first name (3 to 129 lines per conversation).
- **Severity:** Medium (the opposite of issue #19 on this account: identification works, but its timing and its event are not documented).
- **Workaround:** Thoughtful only reads finished conversations.
- **Suggestion:** document this event (it is the most useful signal in the stream) and the moment when REST transcripts get speaker names.

### 4. `--json` stream lines carry no event name
- **Task:** dispatch stream events.
- **Actual:** each JSON line is the payload only; `event:` lines are dropped by the library. We recognise events by their keys (`utterance`, `conversation`, `conversation_id + short_summary`, `utterance_id + person_first_name`, `transcription_id + chunks`).
- **Severity:** Low.
- **Suggestion:** add `"type"` to every payload (some new events already have it).

### 5. The stream does not reconnect (known: #16)
- **Workaround:** our own loop with exponential backoff (2 s to 60 s) in `src/bee.mjs`; reminders fall back to "a conversation is capturing" from the REST list when the stream is down.
- **Severity:** Medium.

### 6. npm 11 skips the package's `postinstall`, and the npm wrapper outlives `kill`
- **Task:** install and run the CLI from a project (`npm install @beeai/cli`).
- **Actual:** npm 11.19 prints `install-scripts … @beeai/cli@0.8.0 (postinstall)` and does not run it. That script only marks the platform binary executable, so on a fresh machine `bee` can fail with "permission denied". Separately, the `bin/bee.js` wrapper spawns the real binary: stopping a stream by killing the wrapper leaves the real process alive (also seen by Nectar).
- **Severity:** Medium.
- **Workaround:** Thoughtful runs `dist/platforms/<os>-<arch>/bee` directly and `chmod`s it if needed (`resolveBeeBinary()`).
- **Suggestion:** ship the binary with the executable bit in the tarball; forward signals in the wrapper.

### 7. The package exports only `./lib`
- **Actual:** `require.resolve('@beeai/cli/package.json')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, so there is no clean way to locate the bundled binary from code.
- **Workaround:** `import.meta.resolve('@beeai/cli/lib')` and walk up two folders.
- **Severity:** Low. **Suggestion:** export `./package.json` and a `binaryPath()` helper.

### 8. `alarm_at` goes in as ISO text and comes back as milliseconds
- **Measured:** `todos create --alarm-at 2026-10-19T15:00:00.000Z` → response `alarm_at: 1792422000000` (number). The stream calls it `alarmAt` (docs).
- **Severity:** Low. **Suggestion:** one format and one name everywhere.

### 9. Pending facts carry no link to the conversation they came from
- **Task:** show the owner the words a fact comes from before he confirms it.
- **Actual:** a fact is `{id, text, tags, created_at, confirmed}`; no conversation id.
- **Workaround:** for Bee's own facts we show the fact text and its date; for Thoughtful's notes we keep our own verbatim quote, checked against the transcript.
- **Severity:** Medium for any "confirm with evidence" flow. **Suggestion:** add `source_conversation_id` (and ideally the utterance ids).

### 10. `bee status` prints part of the access token
- **Severity:** Medium (security): easy to leak in a screen recording or a log. We never call it; `bee me` is enough to check the login.
- **Suggestion:** print only "signed in as …".

### 11. The library has no typed methods for todo suggestions and insights
- **Workaround:** `bee.runJson(['todos', 'suggestions'])`, `bee.runJson(['insights', 'list'])`.
- **Severity:** Low.

### 12. Measured, still unexplained
- `bee today` returns empty `calendar_events` and `emails` on this account (Google integration status unknown from the API). A field saying "calendar not connected" would let apps explain the empty state.
- Insights, daily summaries and journals stayed empty for the first hours (expected for a new account; worth saying in the docs).
- Todo alarm on the Apple Watch: see `docs/watch-test.md` (result recorded by the owner).

---

## Feature requests

| Request | Why it matters for Thoughtful | Priority |
|---|---|---|
| A "conversation in progress" signal (or the documented silence threshold) | The single most important input for "never interrupt": apps could wait for a real pause instead of guessing | Critical |
| `source_conversation_id` on facts | Confirm-with-evidence flows (and trust) | Important |
| `facts-created` stream event / facts in `/v1/changes` with their source | React when Bee learns something, without polling | Important |
| Writable fact tags (e.g. `person:Maya`) | Lets any agent query "what do I know about Maya" in Bee itself | Important |
| Idempotency key on `POST /v1/todos` | A retry after a timeout must not ring the watch twice | Important |
| A todo "deliver at" option that waits for silence on the device side | Bee knows best when the wearer is talking | Nice to have |
| Document the speaker-identification stream event | It is already there and very useful | Nice to have |

## Would we build on Bee again?

Yes. The CLI library made the first real read take minutes, writes to facts and todos are simple, and speaker identification on this account worked far better than the open issues suggested. The gaps above are mostly about timing signals and documentation, which is exactly what a "never interrupt" product needs most.
