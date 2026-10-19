#!/usr/bin/env node
// Runs the REAL Bedrock extractor once on the invented sample household and saves its raw answers to
// sample/recorded-extraction.json (dates as offsets), so the sample mode works for anyone without AWS.
// Usage: AWS_PROFILE=<profile> node scripts/record-sample.mjs
import fs from 'node:fs';
import { createBedrockExtractor } from '../src/extract/bedrock.mjs';
import { createSampleSource, sampleToday, sampleDayStr, recordingPath, SAMPLE_OWNER } from '../src/sample.mjs';
import { config } from '../src/config.mjs';

const DAY = 86_400_000;
const src = createSampleSource();
const spend = { day: null, usd: 0, totalUsd: 0, calls: 0 };
const ex = createBedrockExtractor({ spend });
const today = sampleDayStr(Date.now());
const base = sampleToday();
const toOffset = (items) => items.map((i) => {
  if (!i.event_date) return i;
  const { event_date, ...rest } = i;
  return { ...rest, event_offset_days: Math.round((Date.parse(event_date + 'T16:00:00Z') - (base + 12 * 3600e3)) / DAY) };
});
const out = { modelId: config.model, recordedOn: today, conversations: {}, facts: [] };
const people = [];
for (const c of await src.recentConversations(0)) {
  const conv = await src.conversation(c.id);
  const r = await ex.conversation({ conv, ownerName: SAMPLE_OWNER, people, today, timezone: 'America/New_York' });
  out.conversations[c.id] = toOffset(r.items);
  out.modelId = r.modelId;
  console.log(`conversation ${c.id}: ${r.items.length} items`);
}
const facts = await src.pendingFacts();
out.facts = toOffset((await ex.facts({ facts, ownerName: SAMPLE_OWNER, people, today })).items);
console.log(`facts: ${out.facts.length} items; cost ≈ $${spend.usd.toFixed(4)} in ${spend.calls} calls`);
fs.mkdirSync(new URL('../sample/', import.meta.url), { recursive: true });
fs.writeFileSync(recordingPath, JSON.stringify(out, null, 1) + '\n');
console.log('saved', recordingPath.pathname);
