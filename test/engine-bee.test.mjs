import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createBeeClient } from '@beeai/cli/lib';
import { createLiveSource, normalizeConversation } from '../src/bee.mjs';
import { createEngine, conversationGate } from '../src/engine.mjs';
import { openStore } from '../src/store.mjs';
import { createBedrockExtractor, SpendCapError } from '../src/extract/bedrock.mjs';
import { fakeSource, fakeExtractor, conv, tmpDir, T0 } from './helpers.mjs';

test('the gate skips what the owner was not part of (TV, people nearby) and live captures', () => {
  const tv = conv(1, [['Unknown', 'Tonight on the show'], ['Unknown', 'sponsored by'], ['Unknown', 'next week'], ['Unknown', 'after the break']]);
  assert.equal(conversationGate(tv, { ownerName: 'Sam', now: T0 }), 'owner_not_in_it');
  assert.equal(conversationGate(tv, { ownerName: '', now: T0 }), 'ok', 'until Bee has recognised the owner once, we do not rely on it');
  const live = conv(2, [['Sam', 'a'], ['Unknown', 'b'], ['Sam', 'c'], ['Unknown', 'd']], { at: T0 - 60e3, state: 'CAPTURING' });
  assert.equal(conversationGate(live, { ownerName: 'Sam', now: T0 }), 'still_capturing');
  assert.equal(conversationGate(live, { ownerName: 'Sam', now: T0 + 3600e3 }), 'ok', 'Bee bug #21: a capture silent for 20 min is treated as finished');
  assert.equal(conversationGate(conv(3, [['Sam', 'hi']]), { ownerName: 'Sam', now: T0 }), 'too_short');
});

test('sync: reads Bee, guards, merges, skips TV, and never reads a conversation twice', async () => {
  const dir = tmpDir();
  const store = openStore(dir, 'live');
  const family = conv(10, [['Sam', 'Inès, ça va ?'], ['Unknown', "J'ai trop envie d'essayer un cours de céramique depuis des mois."], ['Sam', "Je t'envoie le lien de l'atelier demain, promis."], ['Unknown', 'Super, merci !']]);
  const tv = conv(11, [['Unknown', 'Tonight on the show we test five machines'], ['Unknown', 'This episode is sponsored by a brand'], ['Unknown', 'Like and subscribe'], ['Unknown', 'After the break']]);
  const source = fakeSource({ conversations: [family, tv], facts: [{ id: 5, text: "Sam's friend Inès loves jazz.", createdAt: T0 }] });
  const ex = fakeExtractor({ 10: [
    { person: 'Inès', relation: 'friend', kind: 'wish', text_en: 'Would love a ceramics class', quote: "J'ai trop envie d'essayer un cours de céramique", confidence: 0.9 },
    { person: 'Inès', kind: 'promise', text_en: 'Send her the studio link', quote: "Je t'envoie le lien de l'atelier demain", confidence: 0.95 },
    { person: 'Inès', kind: 'life', text_en: 'Is in hospital', quote: 'Inès, ça va', confidence: 0.9 },
  ] }, [{ bee_fact_id: 5, person: 'Inès', kind: 'like', text_en: 'Loves jazz', confidence: 0.8 }]);
  let calls = 0;
  const counting = { ...ex, conversation: async (a) => { calls++; return ex.conversation(a); } };
  const engine = createEngine({ store, source, extractor: counting, now: () => T0 });
  const r = await engine.sync();
  assert.equal(r.read, 1);
  assert.equal(r.skipped.owner_not_in_it, 1);
  assert.equal(r.notes, 2);
  assert.equal(r.facts, 1);
  assert.equal(r.setAside.sensitive, 1);
  assert.equal(calls, 1);
  await engine.sync();
  assert.equal(calls, 1, 'processed conversations are not sent to the model again');
  const saved = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  assert.equal(Object.keys(saved.items).length, 3);
  assert.equal((fs.statSync(store.file).mode & 0o777).toString(8), '600', 'notebook readable by the owner only');
  assert.ok(!JSON.stringify(saved).includes('Tonight on the show'), 'transcripts are never stored');
});

// A stand-in `bee` binary: records its arguments and answers like the real CLI. This exercises the REAL
// @beeai/cli/lib (createBeeClient → runner → --json) end to end, without a Bee account.
function fakeBeeBinary(dir) {
  const log = path.join(dir, 'calls.log');
  const bin = path.join(dir, 'bee');
  fs.writeFileSync(bin, `#!/bin/sh
echo "$@" >> "${log}"
case "$1 $2" in
  "todos create") echo '{"id":501,"text":"x","alarm_at":1792400000000,"completed":false}';;
  "facts create") echo '{"id":601,"text":"x","confirmed":false}';;
  "facts confirm") echo '{"id":601,"confirmed":true}';;
  "facts delete") echo '{}';;
  "facts list") echo '{"facts":[{"id":7,"text":"Inès loves jazz","tags":["general"],"created_at":1792400000000,"confirmed":false}],"next_cursor":null}';;
  "me --json") echo '{"id":1,"first_name":"Sam","last_name":"X","timezone":"Europe/Paris"}';;
  "today --json") echo '{"calendar_events":[{"title":"Dinner with Theo","start_time":1792430000000,"end_time":1792435000000}],"emails":[]}';;
  *) echo '{}';;
esac
`, { mode: 0o755 });
  return { bin, log };
}

test('live source drives the real Bee CLI library with the exact commands', async () => {
  const dir = tmpDir();
  const { bin, log } = fakeBeeBinary(dir);
  const src = createLiveSource({ client: createBeeClient({ command: bin }) });
  assert.deepEqual(await src.me(), { firstName: 'Sam', timezone: 'Europe/Paris' });
  assert.deepEqual(await src.createTodo('Seeing Theo: first half-marathon', '2026-10-20T07:00:00.000Z'), { id: 501 });
  assert.deepEqual(await src.createFact('Inès (friend) would love: a ceramics class'), { id: 601 });
  await src.confirmFact(601);
  await src.deleteFact(601);
  const facts = await src.pendingFacts();
  assert.equal(facts[0].id, 7);
  const cal = await src.calendar();
  assert.equal(cal[0].title, 'Dinner with Theo');
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.ok(lines.includes('todos create --text Seeing Theo: first half-marathon --alarm-at 2026-10-20T07:00:00.000Z --json'));
  assert.ok(lines.includes('facts confirm 601 --json'));
  assert.ok(lines.includes('facts delete 601 --json'));
  assert.ok(lines.includes('facts list --limit 50 --unconfirmed --json'));
});

test('conversations: final transcription preferred, Bee duplicates (#3) removed, seconds or ms both accepted', () => {
  const c = normalizeConversation({ conversation: { id: 3, state: 'COMPLETED', start_time: 1792400000, updated_at: 1792400100000, transcriptions: [
    { realtime: true, utterances: [{ speaker: 'Unknown', text: 'rough draft', spoken_at: 1792400001000 }] },
    { realtime: false, utterances: [{ speaker: 'Sam', text: 'Bonjour', spoken_at: 1792400001000 }, { speaker: 'Sam', text: 'Bonjour', spoken_at: 1792400002000 }, { speaker: 'Unknown', text: ' Salut ', spoken_at: 1792400003000 }] },
  ] } });
  assert.deepEqual(c.utterances.map((u) => u.text), ['Bonjour', 'Salut']);
  assert.equal(c.startTime, 1792400000000);
});

test('Bedrock: the spending cap stops calls before they happen; throttling falls back', async () => {
  const spend = { day: null, usd: 0, totalUsd: 0, calls: 0 };
  const seen = [];
  const ex = createBedrockExtractor({ spend, sendImpl: async (input) => {
    seen.push(input.modelId);
    if (seen.length === 1) throw Object.assign(new Error('Too many requests'), { name: 'ThrottlingException' });
    return { usage: { inputTokens: 1000, outputTokens: 200 }, output: { message: { content: [{ text: '{"items":[{"person":"Inès","kind":"like"}]}' }] } } };
  } });
  const r = await ex.conversation({ conv: conv(1, [['Sam', 'a']]), ownerName: 'Sam', people: [], today: '2026-10-19', timezone: 'Europe/Paris' });
  assert.equal(r.items.length, 1);
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0], seen[1]);
  assert.ok(spend.usd > 0 && spend.calls === 1);
  spend.usd = 0.9999; spend.day = new Date().toISOString().slice(0, 10);
  await assert.rejects(ex.conversation({ conv: conv(1, [['Sam', 'a']]), ownerName: 'Sam', people: [], today: '2026-10-19', timezone: 'UTC' }), SpendCapError);
});
