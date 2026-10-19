import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeProduct, storeName, findGifts, findPlace, findPlaceOsm, inGiftRange } from '../src/lookups.mjs';
import { emptyState } from '../src/store.mjs';
import { openStore } from '../src/store.mjs';
import { tmpDir } from './helpers.mjs';

// Test-only fake key values (not real keys): the code reads env first, before the Keychain.
process.env.CHANNEL3_API_KEY = 'test-not-a-key';
process.env.GOOGLE_PLACES_KEY = 'test-not-a-key';
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('merchant is the store or the brand, never the Channel3 redirect domain', () => {
  assert.equal(storeName('buy.trychannel3.com'), '');
  assert.equal(storeName('www.etsy.com'), 'Etsy');
  const p = shapeProduct({ id: 1, title: 'Pottery Wheel', brands: [{ name: 'MindWare' }], images: [{ url: 'https://x/y.jpg' }], offers: [{ url: 'https://buy.trychannel3.com/r/1', price: { price: 99.95, currency: 'USD' } }] });
  assert.equal(p.merchant, 'MindWare');
  const q = shapeProduct({ id: 2, title: 'Kit', images: [{ url: 'https://x/z.jpg' }], offers: [{ url: 'https://buy.trychannel3.com/r/2', domain: 'michaels.com', price: { price: 30 } }] });
  assert.equal(q.merchant, 'Michaels');
});

test('gift ideas stay in a gift price range, and one transient failure is retried', async () => {
  const s = emptyState();
  let calls = 0;
  const prod = (title, price) => ({ id: title, title, images: [{ url: `https://img/${title}.jpg` }], offers: [{ url: 'https://buy.trychannel3.com/r', price: { price } }] });
  const fetchImpl = async () => (++calls === 1 ? json({}, 503) : json({ products: [prod('Walkman', 898), prod('CD player', 44.99), prod('Tiny', 4), prod('Radio', 79)] }));
  const r = await findGifts(s, 'portable music player', { fetchImpl });
  assert.equal(calls, 2);
  assert.deepEqual(r.products.map((p) => p.title), ['CD player', 'Radio']);
  assert.ok(r.products.every(inGiftRange));
});

test('Google Places: only the place ID is written to the notebook (Maps Platform terms)', async () => {
  const dir = tmpDir();
  const store = openStore(dir, 'live');
  const fetchImpl = async () => json({ places: [{ id: 'ChIJtest', displayName: { text: 'Clay Studio' }, shortFormattedAddress: '1 Test St', rating: 4.9, userRatingCount: 1293, googleMapsUri: 'https://maps.google.com/?cid=1', businessStatus: 'OPERATIONAL' }] });
  const r = await findPlace(store.state, 'pottery class', 'Brooklyn', { fetchImpl });
  assert.equal(r.place.name, 'Clay Studio');
  assert.equal(r.place.source, 'google');
  store.save();
  const saved = JSON.stringify(JSON.parse((await import('node:fs')).readFileSync(store.file, 'utf8')).cache);
  assert.ok(saved.includes('ChIJtest'));
  assert.ok(!/Clay Studio|Test St|1293|4\.9/.test(saved), 'no name, address or rating stored');
});

test('OpenStreetMap fallback is attributed and polite (identifying User-Agent)', async () => {
  const s = emptyState();
  let ua = '';
  const fetchImpl = async (u, o) => { ua = o.headers['User-Agent']; return json([{ name: 'Elsewhere Clay', display_name: 'Elsewhere Clay, Pretoria', osm_type: 'node', osm_id: 1 }, { name: 'Brooklyn Clay', display_name: 'Brooklyn Clay, 9 Clay St, Greenpoint, Brooklyn', osm_type: 'node', osm_id: 42, address: { house_number: '9', road: 'Clay St', suburb: 'Greenpoint' } }]); };
  const r = await findPlaceOsm(s, 'pottery class', 'Brooklyn', { fetchImpl });
  assert.equal(r.place.source, 'osm');
  assert.equal(r.place.area, '9 Clay St, Greenpoint');
  assert.match(r.place.url, /openstreetmap\.org\/node\/42/);
  assert.match(ua, /^Thoughtful\//);
});
