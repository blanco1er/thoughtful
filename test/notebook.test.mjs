import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeItems, confirmItem, rejectItem, forgetItem, expire, findPerson, factTextFor } from '../src/notebook.mjs';
import { fakeSource, stateWith, T0 } from './helpers.mjs';

const item = (o = {}) => ({ person: 'Inès', relation: 'friend', kind: 'wish', textEn: 'Would love a ceramics class', textFr: 'Rêve d’un cours de céramique', quote: 'j’ai trop envie d’essayer un cours de céramique', speaker: 'unknown', confidence: 0.9, eventDate: null, dateKind: null, giftQuery: 'ceramics kit', experienceQuery: 'ceramics class', ...o });

test('a new person starts as "suggested", never confirmed by a guess', () => {
  const s = stateWith();
  mergeItems(s, [item()], { sourceId: 'c1', saidAt: T0, now: T0 });
  const p = findPerson(s, 'ines');
  assert.equal(p.status, 'suggested');
  assert.equal(Object.values(s.items)[0].status, 'pending');
});

test('hearing the same thing again adds a mention, not a duplicate', () => {
  const s = stateWith();
  mergeItems(s, [item()], { sourceId: 'c1', saidAt: T0 - 86400e3, now: T0 });
  mergeItems(s, [item({ textEn: 'Would really love a ceramics class', quote: 'un cours de céramique, ça me ferait rêver' })], { sourceId: 'c2', saidAt: T0, now: T0 });
  const items = Object.values(s.items);
  assert.equal(items.length, 1);
  assert.equal(items[0].mentions, 2);
  assert.equal(items[0].lastQuote, 'un cours de céramique, ça me ferait rêver');
});

test('confirming writes ONE confirmed Bee fact and confirms the person', async () => {
  const s = stateWith();
  const [id] = mergeItems(s, [item()], { sourceId: 'c1', saidAt: T0, now: T0 });
  const src = fakeSource();
  const r = await confirmItem(s, id, { source: src, now: T0 });
  assert.equal(r.bee, 'wrote_bee_fact');
  assert.deepEqual(src.calls.map((c) => c[0]), ['createFact', 'confirmFact']);
  assert.match(src.calls[0][1], /^Inès \(friend\) would love: Would love a ceramics class/);
  assert.equal(findPerson(s, 'Inès').status, 'confirmed');
  const again = await confirmItem(s, id, { source: src, now: T0 });
  assert.equal(again.already, true);
  assert.equal(src.calls.length, 2, 'no second write');
});

test("confirming one of Bee's own pending facts confirms it in Bee (no duplicate fact)", async () => {
  const s = stateWith();
  const [id] = mergeItems(s, [item({ beeFactId: 77 })], { sourceId: 'f77', sourceType: 'bee_fact', saidAt: T0, now: T0 });
  const src = fakeSource();
  await confirmItem(s, id, { source: src, now: T0 });
  assert.deepEqual(src.calls, [['confirmFact', 77]]);
});

test('promises are not written as facts; Bee offline never loses the decision', async () => {
  const s = stateWith();
  const [p] = mergeItems(s, [item({ kind: 'promise', textEn: 'Send her the studio link' })], { sourceId: 'c1', saidAt: T0, now: T0 });
  const src = fakeSource();
  await confirmItem(s, p, { source: src, now: T0 });
  assert.equal(src.calls.length, 0);
  const [w] = mergeItems(s, [item({ kind: 'like', textEn: 'Loves matcha', quote: 'je bois du matcha tous les matins' })], { sourceId: 'c2', saidAt: T0, now: T0 });
  const broken = { ...fakeSource(), createFact: async () => { throw new Error('offline'); } };
  const r = await confirmItem(s, w, { source: broken, now: T0 });
  assert.equal(r.bee, 'bee_write_failed');
  assert.equal(s.items[w].status, 'confirmed');
  assert.equal(s.items[w].beeFactId, null);
});

test('a birthday note teaches the person their birthday', async () => {
  const s = stateWith();
  const [id] = mergeItems(s, [item({ kind: 'date', dateKind: 'birthday', eventDate: '2026-11-02', textEn: 'Birthday on 2 November' })], { sourceId: 'c1', saidAt: T0, now: T0 });
  await confirmItem(s, id, { source: fakeSource(), now: T0 });
  assert.equal(findPerson(s, 'Inès').birthday, '11-02');
});

test('"No" on the only note of a suggested person dismisses that person', () => {
  const s = stateWith();
  const [id] = mergeItems(s, [item({ person: 'Moussa' })], { sourceId: 'c1', saidAt: T0, now: T0 });
  rejectItem(s, id, { now: T0 });
  assert.equal(findPerson(s, 'Moussa'), null, 'dismissed people are not matched again');
});

test('forget deletes only the facts Thoughtful itself wrote to Bee', async () => {
  const s = stateWith();
  const [mine, bees] = mergeItems(s, [item(), item({ kind: 'like', textEn: 'Loves jazz', beeFactId: 9 })], { sourceId: 'c1', saidAt: T0, now: T0 });
  const src = fakeSource();
  await confirmItem(s, mine, { source: src, now: T0 });
  await confirmItem(s, bees, { source: src, now: T0 });
  src.calls.length = 0;
  await forgetItem(s, mine, { source: src });
  await forgetItem(s, bees, { source: src });
  assert.deepEqual(src.calls.map((c) => c[0]), ['deleteFact']);
  assert.equal(Object.keys(s.items).length, 0);
});

test('memories expire: past plans are done, stale unconfirmed notes expire', () => {
  const s = stateWith();
  const [plan, wish] = mergeItems(s, [item({ kind: 'plan', eventDate: '2026-10-10', textEn: 'Dinner' }), item()], { sourceId: 'c1', saidAt: T0, now: T0 });
  expire(s, T0 + 200 * 86400e3);
  assert.equal(s.items[plan].status, 'done');
  assert.equal(s.items[wish].status, 'expired');
});

test('fact text carries who, what and when', () => {
  assert.equal(factTextFor({ kind: 'like', textEn: 'Loves jazz', saidAt: T0, eventDate: null }, { name: 'Theo', relation: 'friend' }), 'Theo (friend) likes: Loves jazz. Heard by Bee on 2026-10-19, kept with Thoughtful.');
});

test('language: an old default "en" is not taken as the owner\'s choice', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { openStore } = await import('../src/store.mjs');
  const { tmpDir } = await import('./helpers.mjs');
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'live'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'live', 'notebook.json'), JSON.stringify({ settings: { lang: 'en' } }));
  assert.equal(openStore(dir, 'live').state.settings.lang, null);
  fs.writeFileSync(path.join(dir, 'live', 'notebook.json'), JSON.stringify({ settings: { lang: 'fr', langChosen: true } }));
  assert.equal(openStore(dir, 'live').state.settings.lang, 'fr');
});
