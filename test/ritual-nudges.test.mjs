import test from 'node:test';
import assert from 'node:assert/strict';
import { tonight, nextBirthday, daysBetween, REVEAL_MS } from '../src/ritual.mjs';
import { planNudge, runDue, isQuiet, deriveNudges, atLocal } from '../src/nudges.mjs';
import { mergeItems, confirmItem } from '../src/notebook.mjs';
import { fakeSource, stateWith, T0 } from './helpers.mjs';

const it = (o) => ({ person: 'Inès', relation: 'friend', kind: 'wish', textEn: 'Would love a ceramics class', quote: 'un cours de céramique', speaker: 'unknown', confidence: 0.9, eventDate: null, dateKind: null, giftQuery: null, experienceQuery: 'ceramics class', ...o });

async function household() {
  const s = stateWith();
  const ids = mergeItems(s, [
    it(),
    it({ kind: 'date', dateKind: 'birthday', eventDate: '2026-10-31', textEn: 'Birthday on 31 October' }),
    it({ kind: 'promise', textEn: 'Send her the studio link' }),
    it({ person: 'Theo', kind: 'life', textEn: 'First half-marathon on Sunday' }),
    it({ person: 'Theo', kind: 'like', textEn: 'Loves Blue Note records', giftQuery: 'Blue Note vinyl' }),
  ], { sourceId: 'c1', saidAt: T0 - 5 * 86400e3, now: T0 - 5 * 86400e3 });
  for (const id of ids.slice(0, 3)) await confirmItem(s, id, { source: fakeSource(), now: T0 - 4 * 86400e3 });
  return { s, ids };
}

test('calendar helpers: next birthday wraps to next year, leap days fall back', () => {
  assert.equal(nextBirthday('10-31', '2026-10-19'), '2026-10-31');
  assert.equal(nextBirthday('01-05', '2026-10-19'), '2027-01-05');
  assert.equal(nextBirthday('02-29', '2026-10-19'), '2027-02-28');
  assert.equal(daysBetween('2026-10-19', '2026-10-31'), 12);
});

test("tonight's card never holds more than 3 things: confirm, occasion, promise", async () => {
  const { s } = await household();
  const c = tonight(s, { now: T0, tz: 'Europe/Paris' });
  assert.deepEqual(c.elements.map((e) => e.type), ['confirm', 'occasion', 'promise']);
  const occ = c.elements[1];
  assert.equal(occ.daysLeft, 12);
  assert.equal(occ.person.name, 'Inès');
  assert.equal(occ.evidence[0].text, 'Would love a ceramics class');
  assert.equal(occ.experienceQuery, 'ceramics class');
  assert.equal(occ.giftQuery, 'ceramics class gift', 'no product idea: the activity becomes the gift');
  assert.equal(c.revealed, false, 'surprises are hidden by default');
});

test('an occasion more than 14 days away stays off the card', async () => {
  const { s } = await household();
  const c = tonight(s, { now: T0 - 3 * 86400e3, tz: 'Europe/Paris' });
  assert.ok(!c.elements.some((e) => e.type === 'occasion'));
});

test('at most 3 decisions a day: never a queue to empty', async () => {
  const { s, ids } = await household();
  for (const id of ids.slice(3)) s.items[id].status = 'pending';
  for (let k = 0; k < 3; k++) { const extra = mergeItems(s, [it({ person: 'Lou', kind: 'like', textEn: `Thing ${k} ${'abcdefgh'[k]}xyz`, quote: `quote ${k}` })], { sourceId: 'c' + k, saidAt: T0, now: T0 }); s.items[extra[0]].status = 'confirmed'; s.items[extra[0]].decidedAt = T0 - 60e3; }
  const c = tonight(s, { now: T0, tz: 'Europe/Paris' });
  assert.ok(!c.elements.some((e) => e.type === 'confirm'));
});

test('"Show" on a shared screen expires after 10 minutes', async () => {
  const { s } = await household();
  s.reveals = { '2026-10-19': T0 };
  assert.equal(tonight(s, { now: T0 + 60e3, tz: 'Europe/Paris' }).revealed, true);
  assert.equal(tonight(s, { now: T0 + REVEAL_MS + 1, tz: 'Europe/Paris' }).revealed, false);
});

test('a nudge waits for silence: postponed while someone is talking', async () => {
  const s = stateWith();
  planNudge(s, { key: 'k1', kind: 'promise', text: 'Send Inès the studio link', dueAt: T0, now: T0 });
  s.sync.lastUtteranceAt = T0 - 5 * 60e3;
  const src = fakeSource();
  await runDue(s, { source: src, now: T0, tz: 'Europe/Paris' });
  assert.equal(src.calls.length, 0);
  assert.equal(s.nudges[0].reason, 'conversation_in_progress');
  assert.equal(s.nudges[0].dueAt, T0 + 10 * 60e3);
  s.sync.lastUtteranceAt = T0 - 25 * 60e3;
  await runDue(s, { source: src, now: T0 + 10 * 60e3, tz: 'Europe/Paris' });
  assert.equal(src.calls[0][0], 'createTodo');
  assert.equal(src.calls[0][2], new Date(T0 + 11 * 60e3).toISOString(), 'Bee alarm one minute later, on the minute');
  assert.equal(s.nudges[0].status, 'sent');
});

test('never more than 2 nudges a day, nothing while paused', async () => {
  const s = stateWith();
  for (let k = 0; k < 4; k++) planNudge(s, { key: 'k' + k, kind: 'see', text: 'x' + k, dueAt: T0 + k, now: T0 });
  const src = fakeSource();
  await runDue(s, { source: src, now: T0 + 10, tz: 'Europe/Paris' });
  assert.equal(src.calls.length, 2);
  assert.deepEqual(s.nudges.map((n) => n.reason), [null, null, 'daily_limit', 'daily_limit']);
  const p = stateWith((x) => { x.settings.paused = true; });
  planNudge(p, { key: 'z', kind: 'see', text: 'z', dueAt: T0, now: T0 });
  await runDue(p, { source: src, now: T0, tz: 'Europe/Paris' });
  assert.equal(p.nudges[0].reason, 'paused');
});

test('a capturing conversation also means "not now"', () => {
  const s = stateWith((x) => { x.sync.capturingSince = T0 - 3600e3; x.sync.capturingUpdatedAt = T0 - 60e3; });
  assert.equal(isQuiet(s, T0), false);
  s.sync.capturingUpdatedAt = T0 - 30 * 60e3;
  assert.equal(isQuiet(s, T0), true);
});

test('before you see someone: a calendar event with a known person plans one nudge, 30 min before', async () => {
  const { s, ids } = await household();
  await confirmItem(s, ids[3], { source: fakeSource(), now: T0 });
  const start = atLocal('2026-10-19', '20:30', 'Europe/Paris');
  const planned = deriveNudges(s, { now: T0 - 4 * 3600e3, tz: 'Europe/Paris', calendar: [{ title: 'Dinner with Theo', start, attendees: [] }] });
  assert.equal(planned.length, 1);
  assert.equal(planned[0].dueAt, start - 30 * 60e3);
  assert.equal(planned[0].text, 'Seeing Theo: First half-marathon on Sunday');
  assert.equal(deriveNudges(s, { now: T0 - 4 * 3600e3, tz: 'Europe/Paris', calendar: [{ title: 'Dinner with Theo', start }] }).length, 0, 'planned once');
});

test('atLocal builds the right instant across time zones', () => {
  assert.equal(new Date(atLocal('2026-10-20', '09:00', 'Europe/Paris')).toISOString(), '2026-10-20T07:00:00.000Z');
  assert.equal(new Date(atLocal('2026-11-02', '09:00', 'Europe/Paris')).toISOString(), '2026-11-02T08:00:00.000Z');
  assert.equal(new Date(atLocal('2026-10-20', '09:00', 'America/New_York')).toISOString(), '2026-10-20T13:00:00.000Z');
});
