#!/usr/bin/env node
// Records REAL Channel3 and Google Places results for the sample household's queries into
// sample/lookups-snapshot.json, so judges without keys still see real products and a real place (dated snapshot).
// Needs the keys in the Keychain (scripts/set-channel3-local.sh, scripts/set-places-local.sh).
import fs from 'node:fs';
import { createContext } from '../src/app.mjs';
import { findGifts, findPlace, findPlaceOsm } from '../src/lookups.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(tmpdir(), 'thoughtful-rec-'));
const ctx = createContext({ dataDir: dir, mode: 'sample' });
await ctx.ensureSampleSeed();
const s = ctx.current.store.state;
const card = ctx.tonight();
const queries = { gifts: new Set(), places: new Set() };
for (const it of Object.values(s.items)) { if (it.giftQuery) queries.gifts.add(it.giftQuery); if (it.experienceQuery) queries.places.add(it.experienceQuery); }
for (const e of card.elements) { if (e.giftQuery) queries.gifts.add(e.giftQuery); if (e.experienceQuery) queries.places.add(e.experienceQuery); }
// Google terms: only the place ID is kept from Google. OpenStreetMap results (ODbL) are kept with attribution.
const out = { recordedOn: new Date().toISOString().slice(0, 10), area: s.settings.homeArea, gifts: {}, places: {}, osm: {}, attribution: { osm: '© OpenStreetMap contributors' } };
for (const q of queries.gifts) { const r = await findGifts(s, q); console.log('gifts', q, r.status, r.products.length); if (r.products.length) out.gifts[q] = r.products; }
for (const q of queries.places) {
  const r = await findPlace(s, q, s.settings.homeArea);
  console.log('google place', q, r.status);
  if (r.place?.id) out.places[q] = { placeId: r.place.id };
  const o = await findPlaceOsm(s, q, s.settings.homeArea);
  console.log('osm place', q, o.status);
  if (o.place) out.osm[q] = o.place;
}
fs.writeFileSync(new URL('../sample/lookups-snapshot.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
fs.rmSync(dir, { recursive: true, force: true });
console.log('saved sample/lookups-snapshot.json');
