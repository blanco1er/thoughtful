// Real gifts (Channel3) and a real local experience (Google Places). Keys are read from the macOS Keychain at
// run time (set them with scripts/set-channel3-local.sh and scripts/set-places-local.sh), kept in memory only,
// and never written to a file, a log or the browser. Results are cached for 24 h to keep calls rare.
import { execFile } from 'node:child_process';
import { config } from './config.mjs';

export const KEYCHAIN = { channel3: 'thoughtful-channel3', places: 'thoughtful-google-places' };
const ACCOUNT = 'thoughtful';
const memo = new Map();

export function readKeychain(service) {
  if (process.env.THOUGHTFUL_NO_KEYS === '1') return Promise.resolve(null); // see what judges without keys see
  if (memo.has(service)) return Promise.resolve(memo.get(service));
  const env = { channel3: 'CHANNEL3_API_KEY', places: 'GOOGLE_PLACES_KEY' };
  const fromEnv = Object.entries(KEYCHAIN).find(([, s]) => s === service)?.[0];
  if (fromEnv && process.env[env[fromEnv]]) return Promise.resolve(process.env[env[fromEnv]].trim());
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', service, '-a', ACCOUNT, '-w'], { timeout: 4000 }, (err, stdout) => {
      const v = err ? null : String(stdout).trim() || null;
      memo.set(service, v);
      resolve(v);
    });
  });
}
export const forgetKeyMemo = () => memo.clear();

const today = () => new Date().toISOString().slice(0, 10);
function quota(state, name, max) {
  state.cache.quota ||= {};
  const q = state.cache.quota[name] ||= { day: today(), n: 0 };
  if (q.day !== today()) { q.day = today(); q.n = 0; }
  if (q.n >= max) return false;
  q.n++;
  return true;
}
function cached(state, key) {
  const c = state.cache[key];
  return c && Date.now() - c.at < 24 * 3600e3 ? c.value : null;
}

// A store's name as people say it. Channel3 links go through its own redirect (buy.trychannel3.com), so the
// merchant comes from the offer's `domain`; an unknown or redirect domain gives way to the brand, or nothing.
const STORES = { 'amazon.com': 'Amazon', 'target.com': 'Target', 'walmart.com': 'Walmart', 'etsy.com': 'Etsy', 'bestbuy.com': 'Best Buy', 'macys.com': 'Macy’s', 'nordstrom.com': 'Nordstrom', 'wayfair.com': 'Wayfair', 'crateandbarrel.com': 'Crate & Barrel', 'potterybarn.com': 'Pottery Barn', 'westelm.com': 'West Elm', 'michaels.com': 'Michaels', 'orientaltrading.com': 'Oriental Trading', 'vevor.com': 'VEVOR', 'davidstea.com': 'DAVIDsTEA', 'urbanoutfitters.com': 'Urban Outfitters', 'uncommongoods.com': 'Uncommon Goods', 'barnesandnoble.com': 'Barnes & Noble', 'bluenote.com': 'Blue Note', 'sony.com': 'Sony', '1stdibs.com': '1stDibs', 'chairish.com': 'Chairish', 'bhphotovideo.com': 'B&H', 'kohls.com': 'Kohl’s', 'harrods.com': 'Harrods', 'uturnaudio.com': 'U-Turn Audio', 'garmentory.com': 'Garmentory', 'aprikamatcha.com': 'Aprika' };
export function storeName(domain = '') {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '').replace(/^shop\./, '');
  if (!d || /trychannel3|channel3/.test(d)) return '';
  if (STORES[d]) return STORES[d];
  const label = d.split('.')[0].replace(/\d{2,}/g, '').replace(/[-_]+/g, ' ').trim();
  return label ? label.replace(/\b\w/g, (c) => c.toUpperCase()) : '';
}

export function shapeProduct(p) {
  const offers = (p.offers || []).filter((o) => o?.url && o.price?.price > 0).sort((a, b) => a.price.price - b.price.price);
  const best = offers[0];
  if (!best) return null;
  const img = (p.images || []).find((i) => i.is_main_image) || p.images?.[0];
  const brand = p.brands?.[0]?.name || '';
  return {
    id: String(p.id || ''),
    title: String(p.title || '').slice(0, 110),
    brand,
    image: img?.url || null,
    price: best.price.price,
    currency: best.price.currency || 'USD',
    merchant: storeName(best.domain || best.merchant_domain) || best.merchant_name || brand || '',
    url: best.url,
  };
}

// One retry after a transient failure (network, 429, 5xx): seen once while recording the sample.
async function withRetry(fn, { tries = 2, wait = 1200 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fn();
      if (r.ok || (r.status < 500 && r.status !== 429)) return r;
      last = r;
    } catch (e) { last = e; }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, wait));
  }
  if (last instanceof Error) throw last;
  return last;
}

export const inGiftRange = (p) => p.price >= config.giftPriceMin && p.price <= config.giftPriceMax;

/** 3 real products for a gift idea, in a gift price range. Status: ok | no_key | quota | error | empty. Never buys. */
export async function findGifts(state, query, { fetchImpl = fetch } = {}) {
  if (!query) return { status: 'empty', products: [] };
  const key = `gifts:${query.toLowerCase()}`;
  const hit = cached(state, key);
  if (hit) return { status: hit.length ? 'ok' : 'empty', products: hit, cached: true };
  const apiKey = await readKeychain(KEYCHAIN.channel3);
  if (!apiKey) return { status: 'no_key', products: [] };
  if (!quota(state, 'channel3', config.giftSearchesPerDay)) return { status: 'quota', products: [] };
  try {
    const r = await withRetry(() => fetchImpl('https://api.trychannel3.com/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ query, limit: 12, filters: { availability: ['InStock'], price: { max_price: config.giftPriceMax } }, config: { country: 'US', language: 'en', currency: 'USD' } }),
      signal: AbortSignal.timeout(15000),
    }));
    if (!r.ok) return { status: 'error', code: r.status, products: [] };
    const products = ((await r.json()).products || []).map(shapeProduct).filter(Boolean).filter((p) => p.image).filter(inGiftRange)
      .filter((p, i, all) => all.findIndex((x) => x.title === p.title) === i).slice(0, 3);
    state.cache[key] = { at: Date.now(), value: products };
    return { status: products.length ? 'ok' : 'empty', products };
  } catch {
    return { status: 'error', products: [] };
  }
}

// ---------- places ----------
// Google Maps Platform terms: only the place ID may be stored durably. Thoughtful keeps the place ID (and the query)
// in the notebook; name, address and rating are fetched live and kept in memory for one hour at most.
const placeMemo = new Map();
const PLACE_FIELDS = ['id', 'displayName', 'shortFormattedAddress', 'rating', 'userRatingCount', 'googleMapsUri', 'websiteUri', 'businessStatus'];

function googlePlace(g) {
  return { id: g.id, name: String(g.displayName?.text || '').slice(0, 80), area: g.shortFormattedAddress || '', rating: g.rating ?? null, ratings: g.userRatingCount ?? null, url: g.googleMapsUri || g.websiteUri || null, source: 'google' };
}

export async function placeDetails(placeId, { fetchImpl = fetch, lang = 'en' } = {}) {
  const m = placeMemo.get(placeId + lang);
  if (m && Date.now() - m.at < 3600e3) return m.place;
  const apiKey = await readKeychain(KEYCHAIN.places);
  if (!apiKey) return null;
  const r = await withRetry(() => fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=${lang}`, {
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': PLACE_FIELDS.join(',') }, signal: AbortSignal.timeout(8000),
  }));
  if (!r.ok) return null;
  const place = googlePlace(await r.json());
  placeMemo.set(placeId + lang, { at: Date.now(), place });
  return place;
}

/** One real place near the owner's home AREA (a neighbourhood or city typed in Settings, never GPS). */
export async function findPlace(state, query, area, { fetchImpl = fetch, lang = 'en' } = {}) {
  if (!query) return { status: 'empty', place: null };
  if (!area) return { status: 'no_area', place: null };
  const key = `placeid:${query.toLowerCase()}|${area.toLowerCase()}`;
  const apiKey = await readKeychain(KEYCHAIN.places);
  if (!apiKey) return { status: 'no_key', place: null };
  try {
    const known = state.cache[key]?.value;
    if (known?.placeId) {
      const place = await placeDetails(known.placeId, { fetchImpl, lang });
      if (place) return { status: 'ok', place };
    }
    if (!quota(state, 'places', config.placeSearchesPerDay)) return { status: 'quota', place: null };
    const r = await withRetry(() => fetchImpl('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': PLACE_FIELDS.map((f) => 'places.' + f).join(',') },
      body: JSON.stringify({ textQuery: `${query} in ${area}`, pageSize: 5, languageCode: lang }),
      signal: AbortSignal.timeout(8000),
    }));
    if (!r.ok) return { status: 'error', code: r.status, place: null };
    const best = ((await r.json()).places || [])
      .filter((g) => g.businessStatus !== 'CLOSED_PERMANENTLY' && g.displayName?.text)
      .sort((a, b) => (b.rating || 0) * Math.log10(10 + (b.userRatingCount || 0)) - (a.rating || 0) * Math.log10(10 + (a.userRatingCount || 0)))[0];
    if (!best) return { status: 'empty', place: null };
    const place = googlePlace(best);
    state.cache[key] = { at: Date.now(), value: { placeId: best.id } }; // the ID only
    placeMemo.set(best.id + lang, { at: Date.now(), place });
    return { status: 'ok', place };
  } catch {
    return { status: 'error', place: null };
  }
}

// Without a Google key: OpenStreetMap (Nominatim), data © OpenStreetMap contributors (ODbL), shown with attribution.
// Usage policy: an identifying User-Agent, at most one request per second, results cached.
let lastOsm = 0;
export async function findPlaceOsm(state, query, area, { fetchImpl = fetch, lang = 'en' } = {}) {
  if (!query || !area) return { status: 'empty', place: null };
  const key = `osm:${query.toLowerCase()}|${area.toLowerCase()}`;
  const hit = cached(state, key);
  if (hit !== null) return { status: hit ? 'ok' : 'empty', place: hit || null };
  // Nominatim searches names, not activities: "pottery wheel class" → "pottery studio, Brooklyn", then broader.
  const core = query.replace(/\b(class(?:es)?|workshops?|lessons?|courses?|sessions?|beginners?|for|near|her|his|place|cours|atelier|stage|d[eu]s?)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const town = area.split(',')[0].trim();
  const tries = [...new Set([`${core} studio, ${town}`, `${core}, ${area}`, `${core.split(' ')[0]} studio, ${town}`, `${query}, ${area}`].filter((x) => x.length > town.length + 2))];
  const politeFetch = async (u) => {
    const waitMs = Math.max(0, lastOsm + 1100 - Date.now());
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    lastOsm = Date.now();
    return withRetry(() => fetchImpl(u, { headers: { 'User-Agent': 'Thoughtful/0.1 (open-source Bee hackathon project; github.com/blanco1er)', 'Accept-Language': lang }, signal: AbortSignal.timeout(8000) }));
  };
  try {
    let best = null;
    for (const q of tries) {
      const r = await politeFetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(q)}`);
      if (!r.ok) continue;
      const parts = area.toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
      const list = (await r.json()).filter((x) => x.name && parts.every((p) => String(x.display_name || '').toLowerCase().includes(p)));
      best = list.find((x) => ['craft', 'shop', 'amenity', 'leisure', 'tourism', 'club'].includes(x.category)) || list[0] || null;
      if (best) break;
    }
    const place = best ? { name: String(best.name).slice(0, 80), area: [best.address?.road && [best.address?.house_number, best.address.road].filter(Boolean).join(' '), best.address?.suburb || best.address?.city_district || best.address?.city].filter(Boolean).join(', '), rating: null, ratings: null, url: `https://www.openstreetmap.org/${best.osm_type}/${best.osm_id}`, source: 'osm' } : null;
    state.cache[key] = { at: Date.now(), value: place || false };
    return { status: place ? 'ok' : 'empty', place };
  } catch {
    return { status: 'error', place: null };
  }
}

export async function keysStatus() {
  const [c, p] = await Promise.all([readKeychain(KEYCHAIN.channel3), readKeychain(KEYCHAIN.places)]);
  return { channel3: !!c, places: !!p };
}
