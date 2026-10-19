import test from 'node:test';
import assert from 'node:assert/strict';
import { guardItems, isSensitive, looksLikeMedia, quoteIsGrounded } from '../src/extract/filters.mjs';

const utterances = [
  { speaker: 'Sam', text: "Inès, tu veux qu'on se voie samedi ?" },
  { speaker: 'Unknown', text: "Oui ! Et j'ai trop envie d'essayer un cours de céramique depuis des mois." },
  { speaker: 'Sam', text: "Je t'envoie le lien de l'atelier demain, promis." },
  { speaker: 'Unknown', text: "Moi aussi je t'envoie la recette du gâteau ce soir." },
];
const transcriptText = utterances.map((u) => u.text).join('\n');
const base = { person: 'Inès', relation: 'friend', text_en: 'x', confidence: 0.9 };
const g = (items) => guardItems(items, { transcriptText, utterances, ownerName: 'Sam' });

test('sensitive topics are never kept, in English and French', () => {
  for (const s of ['She has cancer', 'il est à l\'hôpital', 'they are getting a divorce', 'elle est enceinte', 'he got fired', 'son salaire a baissé', 'il va à la messe']) assert.ok(isSensitive(s), s);
  for (const s of ['I am addicted to matcha', 'my headphones broke', 'she loves Essex', 'Ghibli films', 'pottery firing kiln']) assert.ok(!isSensitive(s), s);
});

test('only strong media signals are dropped at item level', () => {
  assert.ok(looksLikeMedia('This episode is sponsored by a coffee brand'));
  assert.ok(looksLikeMedia('like and subscribe'));
  assert.ok(!looksLikeMedia('She loves old jazz records and Ghibli films'));
  assert.ok(!looksLikeMedia("I'll lend you my Spanish podcast list"));
});

test('a quote must really be in the transcript (small ASR noise tolerated)', () => {
  assert.ok(quoteIsGrounded("j'ai trop envie d'essayer un cours de céramique", transcriptText));
  assert.ok(quoteIsGrounded("j'ai vraiment trop envie d'essayer un cours de céramique depuis des mois", transcriptText));
  assert.ok(!quoteIsGrounded('elle veut un vélo électrique pour son anniversaire', transcriptText));
  assert.ok(!quoteIsGrounded('oui', transcriptText), 'too short to prove anything');
});

test('guard keeps a grounded wish and drops what it must', () => {
  const r = g([
    { ...base, kind: 'wish', text_en: 'Would love a ceramics class', quote: "j'ai trop envie d'essayer un cours de céramique" },
    { ...base, kind: 'wish', text_en: 'Wants an e-bike', quote: 'elle veut un vélo électrique pour son anniversaire' },
    { ...base, kind: 'like', text_en: 'Likes cake', quote: "je t'envoie la recette du gâteau ce soir", confidence: 0.4 },
    { ...base, kind: 'life', text_en: 'Ill', quote: 'x y z', sensitive: true },
    { ...base, kind: 'like', text_en: 'Watches a show', quote: "je t'envoie la recette du gâteau ce soir", media: true },
    { ...base, kind: 'nonsense', text_en: 'x', quote: 'x' },
    { ...base, person: '', kind: 'like', text_en: 'nobody', quote: "je t'envoie la recette du gâteau ce soir" },
    { ...base, person: 'Sam', kind: 'like', text_en: 'about the owner', quote: "je t'envoie la recette du gâteau ce soir" },
  ]);
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0].textEn, 'Would love a ceramics class');
  assert.deepEqual(r.dropped.map((d) => d.reason).sort(), ['about_owner', 'low_confidence', 'malformed', 'media', 'no_person', 'quote_not_found', 'sensitive'].sort());
});

test('a promise counts only if the owner said it (Bee speaker identification)', () => {
  const r = g([
    { ...base, kind: 'promise', text_en: 'Send her the studio link', quote: "Je t'envoie le lien de l'atelier demain, promis" },
    { ...base, kind: 'promise', text_en: 'Send the cake recipe', quote: "Moi aussi je t'envoie la recette du gâteau ce soir" },
  ]);
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0].speaker, 'owner');
  assert.equal(r.dropped[0].reason, 'promise_not_owner');
});

test('Bee pending facts need no transcript quote', () => {
  const r = guardItems([{ ...base, kind: 'like', text_en: 'Loved Kyoto ceramics', quote: 'Sam\'s friend Inès loved Kyoto ceramics', bee_fact_id: 42 }], { sourceKind: 'bee_fact', ownerName: 'Sam' });
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0].beeFactId, 42);
});

test('search phrases are cleaned before leaving the Mac', async () => {
  const { cleanQuery } = await import('../src/extract/filters.mjs');
  assert.equal(cleanQuery('pottery wheel class near her place'), 'pottery wheel class');
  assert.equal(cleanQuery('What kind of ceramics would Maya appreciate?'), null);
  assert.equal(cleanQuery('cours de poterie près de chez elle'), 'cours de poterie');
  assert.equal(cleanQuery('Japanese ceramic tea bowl'), 'Japanese ceramic tea bowl');
});
