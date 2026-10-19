// Long conversations are read in overlapping windows. Everything here is SYNTHETIC (generated sentences).
import test from 'node:test';
import assert from 'node:assert/strict';
import { windowsFor, parseJson } from '../src/extract/prompt.mjs';
import { createBedrockExtractor } from '../src/extract/bedrock.mjs';
import { createEngine, dedupeItems, friendlyError } from '../src/engine.mjs';
import { openStore } from '../src/store.mjs';
import { fakeSource, tmpDir, T0 } from './helpers.mjs';

// ~110 000 characters: 1 200 lines, the owner and a relative take turns; a wish only at the very end.
function longConv(id = 77) {
  const lines = [];
  for (let i = 0; i < 1200; i++) lines.push([i % 3 === 0 ? 'Sam' : 'Unknown', `Phrase de remplissage numéro ${i} sur la journée, le travail et la météo du moment.`]);
  lines.push(['Sam', 'Et toi Zoé, tu as envie de quoi pour ton anniversaire ?']);
  lines.push(['Unknown', "J'ai trop envie d'apprendre la reliure japonaise, vraiment."]);
  return { id, state: 'COMPLETED', startTime: T0 - 7200e3, updatedAt: T0 - 600e3, shortSummary: '', utterances: lines.map(([speaker, text], i) => ({ id: i, speaker, text, at: T0 - 7200e3 + i * 4000 })) };
}

test('windows: ~20 000 characters, cut between sentences, overlapping, and the end is read', () => {
  const conv = longConv();
  const { windows, total, skipped } = windowsFor(conv, 'Sam');
  assert.ok(total > 55000);
  const expected = Math.ceil((total - 1500) / 18500);
  assert.ok(Math.abs(windows.length - expected) <= 1, `got ${windows.length}, expected about ${expected}`);
  assert.equal(skipped, 0);
  for (const w of windows) assert.ok(w.chars <= 20000);
  for (let i = 1; i < windows.length; i++) {
    assert.ok(windows[i].from < windows[i - 1].to, 'windows overlap');
    assert.ok(windows[i].from > windows[i - 1].from, 'always moves forward');
  }
  assert.equal(windows[windows.length - 1].to, conv.utterances.length, 'the last sentence is in the last window');
});

test('windows: at most 8 per conversation, the rest is counted', () => {
  const conv = longConv();
  const r = windowsFor(conv, 'Sam', { size: 3000, overlap: 300, max: 8 });
  assert.equal(r.windows.length, 8);
  assert.ok(r.skipped > 0);
});

test('a broken model answer is an error, not "nothing found"', () => {
  assert.equal(parseJson('Sorry, I cannot help with that.').parseError, true);
  assert.equal(parseJson('{"items": [').parseError, true);
  assert.equal(parseJson('{"items": []}').parseError, undefined);
});

test('end to end: the wish said at the end of a very long conversation is found, checked in its window, kept once', async () => {
  const conv = longConv();
  const calls = [];
  // Fake Bedrock: answers per window. The wish is in the last window; the overlap makes a duplicate on purpose,
  // and one window answers with broken JSON.
  const ex = createBedrockExtractor({ spend: { day: null, usd: 0, totalUsd: 0, calls: 0 }, sendImpl: async (input) => {
    const user = input.messages[0].content[0].text;
    calls.push(user.length);
    const has = user.includes('reliure japonaise');
    const text = calls.length === 2 ? 'not json at all' : JSON.stringify({ items: has ? [
      { person: 'Zoé', kind: 'wish', text_en: 'Would love to learn Japanese bookbinding', quote: "J'ai trop envie d'apprendre la reliure japonaise", confidence: 0.9 },
      { person: 'Zoé', kind: 'wish', text_en: 'Would love to learn Japanese bookbinding', quote: "J'ai trop envie d'apprendre la reliure japonaise, vraiment", confidence: 0.85 },
      { person: 'Zoé', kind: 'like', text_en: 'Likes something never said', quote: 'une phrase qui nexiste pas du tout ici', confidence: 0.9 },
    ] : [] });
    return { usage: { inputTokens: 5000, outputTokens: 100 }, output: { message: { content: [{ text }] } } };
  } });
  const store = openStore(tmpDir(), 'live');
  const engine = createEngine({ store, source: fakeSource({ conversations: [conv] }), extractor: ex, now: () => T0 });
  const r = await engine.sync();
  const d = r.conversations[0];
  assert.ok(d.windows >= 3);
  assert.equal(calls.length, d.windows, 'one model call per window');
  assert.ok(calls.every((n) => n < 24000), 'each call stays small');
  assert.equal(d.parseErrors, 1);
  assert.equal(d.raw, 3);
  assert.equal(d.kept, 1, 'two copies of the same wish merged');
  assert.equal(d.rejected.quote_not_found, 1);
  assert.equal(d.kinds.wish, 1);
  assert.equal(r.errors, 1);
  assert.match(store.state.sync.lastError.message, /could not be read/);
  assert.ok(!store.state.processed['c77'], 'a conversation with an unreadable part is read again next time');
  const items = Object.values(store.state.items);
  assert.equal(items.length, 1);
  assert.equal(items[0].textEn, 'Would love to learn Japanese bookbinding');
  // read again: no duplicate, no extra "mention"
  await engine.sync({ reprocessLast: 1 });
  assert.equal(Object.values(store.state.items).length, 1);
  assert.equal(Object.values(store.state.items)[0].mentions, 1);
});

test('dedupe across windows: same quote, or same person + kind + close note', () => {
  const a = { person: 'Zoé', kind: 'like', textEn: 'Loves jazz records', quote: 'j adore le jazz', confidence: 0.7 };
  const b = { person: 'Zoé', kind: 'like', textEn: 'Loves old jazz records', quote: 'les vieux disques de jazz', confidence: 0.9 };
  const c = { person: 'Zoé', kind: 'wish', textEn: 'Loves jazz records', quote: 'autre', confidence: 0.9 };
  const out = dedupeItems([a, b, c]);
  assert.equal(out.length, 2);
  assert.equal(out[0].confidence, 0.9, 'the most confident copy wins');
});

test('errors are explained in plain words (no "internal")', () => {
  assert.match(friendlyError(Object.assign(new Error('Could not load credentials from any providers'), { name: 'CredentialsProviderError' })), /credentials are missing or expired/);
  assert.match(friendlyError(Object.assign(new Error('x'), { code: 'spend_cap' })), /Spending cap/);
  assert.match(friendlyError(new Error('Not logged in')), /bee login/);
});
