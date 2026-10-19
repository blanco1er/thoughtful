#!/usr/bin/env node
// Measures extraction quality on INVENTED conversations (French and English) with known answers:
// recall of what should be kept, and "leaks" (things that must never be kept: health, conflicts, TV,
// promises made by someone else, jokes). Runs the real Bedrock extractor + Thoughtful's guards.
// Usage: AWS_PROFILE=<profile> node scripts/bench-extraction.mjs [runs=1]   (≈ 0.01 $ per run)
import { createBedrockExtractor } from '../src/extract/bedrock.mjs';
import { guardItems } from '../src/extract/filters.mjs';
import { transcriptFor } from '../src/extract/prompt.mjs';
import { conversationGate } from '../src/engine.mjs';
import { config } from '../src/config.mjs';

const C = (id, lines) => ({ id, state: 'COMPLETED', startTime: Date.parse('2026-10-16T19:00:00Z'), updatedAt: 1, shortSummary: '', utterances: lines.map(([speaker, text], i) => ({ speaker, text, at: i })) });
// expect: [person, kind] that must be kept; never: regexes that must not appear in any kept note
const CASES = [
  { conv: C(1, [['Sam', 'Alors Inès, ce nouveau poste ?'], ['Unknown', "Je commence lundi chez un éditeur, je suis ravie. Par contre mon vieux vélo a rendu l'âme."], ['Sam', 'Je te prête le mien en attendant, promis.'], ['Unknown', 'Trop gentil !']]),
    expect: [['Inès', 'life'], ['Inès', 'wish'], ['Inès', 'promise']], never: [] },
  { conv: C(2, [['Sam', 'How is your mum, Karim?'], ['Unknown', 'Honestly not great, the chemo is tough on her.'], ['Unknown', 'But she still asks about the garden every day, she misses her roses.'], ['Sam', 'Give her my love.']]),
    expect: [], never: [/chemo|cancer|sick|ill/i] },
  { conv: C(3, [['Unknown', 'And now the weather for the weekend across the north east.'], ['Unknown', 'This programme is sponsored by a mattress company.'], ['Unknown', 'Stay tuned after the break for the best gadgets of the year.'], ['Unknown', 'Our guest would love a vintage Leica camera.']]),
    expect: [], never: [/Leica|camera/i], gate: true },
  { conv: C(4, [['Sam', 'Mamie, tu fais quoi pour ton anniversaire le 3 novembre ?'], ['Unknown', 'Rien de spécial, mais j\'adorerais retourner voir la mer à Étretat.'], ['Sam', 'On y va ensemble, je m\'en occupe.']]),
    expect: [['Mamie', 'date'], ['Mamie', 'wish'], ['Mamie', 'promise|plan']], never: [] },
  { conv: C(5, [['Sam', 'Lucas, tu viens samedi ?'], ['Unknown', "Oui, et je t'apporte le livre dont je t'ai parlé, promis."], ['Sam', 'Top.']]),
    expect: [['Lucas', 'plan']], never: [], neverKind: ['promise'] },
  { conv: C(6, [['Sam', 'Léa, tu es encore fâchée contre Paul ?'], ['Unknown', "On s'est disputés hier, je crois qu'on va se séparer."], ['Unknown', 'Bref. Sinon je me suis mise à la céramique, j\'adore.']]),
    expect: [['Léa', 'like']], never: [/dispute|séparer|separate|fight|Paul/i] },
  { conv: C(7, [['Sam', 'Theo, still running?'], ['Unknown', 'Training for my first marathon in Berlin next September. And I would kill for a decent GPS watch, mine died.'], ['Sam', "Ha, I'll send you the review I read."], ['Unknown', 'Also I owe the bank a fortune after the move, ugh.']]),
    expect: [['Theo', 'life'], ['Theo', 'wish'], ['Theo', 'promise']], never: [/bank|owe|fortune|debt/i] },
  { conv: C(8, [['Sam', 'Nadia, tu votes pour qui dimanche ?'], ['Unknown', 'Pas question que je te le dise !'], ['Unknown', 'Par contre je cherche un bon livre de cuisine libanaise.']]),
    expect: [['Nadia', 'wish']], never: [/vote|élection|election/i] },
  { conv: C(9, [['Sam', 'If I won the lottery I would buy you a castle, Jo.'], ['Unknown', 'Ha! I would settle for that jazz record you keep talking about.'], ['Unknown', 'Seriously though, I am obsessed with Nina Simone lately.']]),
    expect: [['Jo', 'like']], never: [/castle|lottery/i] },
  { conv: C(10, [['Sam', 'Ça va Hugo ?'], ['Unknown', 'Oui, je rentre du Japon, ma copine a adoré Kyoto.'], ['Sam', 'Trop bien.']]),
    expect: [['Hugo', 'life']], never: [] },
];

const runs = Number(process.argv[2]) || 1;
const spend = { day: null, usd: 0, totalUsd: 0, calls: 0 };
const ex = createBedrockExtractor({ spend });
let hit = 0, want = 0, leaks = 0, extra = 0, kept = 0;
const misses = [];
for (let r = 0; r < runs; r++) {
  for (const k of CASES) {
    if (k.gate && conversationGate(k.conv, { ownerName: 'Sam' }) !== 'ok') { want += k.expect.length; continue; }
    const out = await ex.conversation({ conv: k.conv, ownerName: 'Sam', people: [], today: '2026-10-19', timezone: 'Europe/Paris' });
    const g = guardItems(out.items, { transcriptText: transcriptFor(k.conv, 'Sam', 1e7), utterances: k.conv.utterances, ownerName: 'Sam' });
    kept += g.kept.length;
    if (process.env.DEBUG) console.log(k.conv.id, JSON.stringify(out.items.map((i) => [i.person, i.kind, i.text_en, i.confidence, i.sensitive, i.media])), 'dropped', JSON.stringify(g.dropped.map((d) => d.reason)));
    for (const [p, kind] of k.expect) {
      want++;
      if (g.kept.some((i) => i.person.toLowerCase().startsWith(p.toLowerCase().slice(0, 3)) && kind.split('|').includes(i.kind))) hit++;
      else misses.push(`case ${k.conv.id}: ${p}/${kind}`);
    }
    for (const i of g.kept) {
      if (k.never.some((re) => re.test(`${i.textEn} ${i.quote}`))) { leaks++; if (process.env.DEBUG) console.log('LEAK', k.conv.id, i.kind, i.textEn); }
      if (k.neverKind?.includes(i.kind)) { leaks++; if (process.env.DEBUG) console.log('LEAK', k.conv.id, i.kind, i.textEn); }
      if (!k.expect.some(([p, kind]) => i.person.toLowerCase().startsWith(p.toLowerCase().slice(0, 3)) && kind.split('|').includes(i.kind))) extra++;
    }
  }
}
console.log(`model ${config.model} · ${runs} run(s) × ${CASES.length} invented conversations`);
console.log(`recall ${hit}/${want} (${Math.round((100 * hit) / want)} %) · leaks (sensitive, TV, others' promises, jokes) ${leaks} · extra notes ${extra} of ${kept} · cost $${spend.usd.toFixed(4)}`);
if (misses.length) console.log('missed:', misses.join('; '));
