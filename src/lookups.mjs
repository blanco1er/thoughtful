// Real gifts (Channel3) and a real local experience (Google Places). Keys are read from the macOS Keychain at
// run time (set them with scripts/set-channel3-local.sh and scripts/set-places-local.sh), kept in memory only,
// and never written to a file, a log or the browser. Results are cached for 24 h to keep calls rare.
import { execFile } from 'node:child_process';
import { config } from './config.mjs';

export const KEYCHAIN = { channel3: 'thoughtful-channel3', places: 'thoughtful-google-places' };
const ACCOUNT = 'thoughtful';
const memo = new Map();

export function readKeychain(service) {
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

export function shapeProduct(p) {
  const offers = (p.offers || []).filter((o) => o?.url && o.price?.price > 0).sort((a, b) => a.price.price - b.price.price);
  const best = offers[0];
  if (!best) return null;
  const img = (p.images || []).find((i) => i.is_main_image) || p.images?.[0];
  let merchant = '';
  try { merchant = new URL(best.url).hostname.replace(/^www\./, ''); } catch {}
  return {
    id: String(p.id || ''),
    title: String(p.title || '').slice(0, 110),
    brand: p.brands?.[0]?.name || '',
    image: img?.url || null,
    price: best.price.price,
    currency: best.price.currency || 'USD',
    merchant: best.merchant_name || merchant,
    url: best.url,
  };
}

/** 3 real products for a gift idea. Status: ok | no_key | quota | error | empty. Never buys anything. */
export async function findGifts(state, query, { fetchImpl = fetch } = {}) {
  if (!query) return { status: 'empty', products: [] };
  const key = `gifts:${query.toLowerCase()}`;
  const hit = cached(state, key);
  if (hit) return { status: 'ok', products: hit, cached: true };
  const apiKey = await readKeychain(KEYCHAIN.channel3);
  if (!apiKey) return { status: 'no_key', products: [] };
  if (!quota(state, 'channel3', config.giftSearchesPerDay)) return { status: 'quota', products: [] };
  try {
    const r = await fetchImpl('https://api.trychannel3.com/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ query, limit: 8, filters: { availability: ['InStock'] }, config: { country: 'US', language: 'en', currency: 'USD' } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { status: 'error', code: r.status, products: [] };
    const products = ((await r.json()).products || []).map(shapeProduct).filter(Boolean).filter((p) => p.image)
      .filter((p, i, all) => all.findIndex((x) => x.title === p.title) === i).slice(0, 3);
    state.cache[key] = { at: Date.now(), value: products };
    return { status: products.length ? 'ok' : 'empty', products };
  } catch (e) {
    return { status: 'error', products: [] };
  }
}

/** One real place near the owner's home AREA (a neighbourhood or city typed in Settings, never GPS). */
export async function findPlace(state, query, area, { fetchImpl = fetch, lang = 'en' } = {}) {
  if (!query) return { status: 'empty', place: null };
  if (!area) return { status: 'no_area', place: null };
  const key = `place:${query.toLowerCase()}|${area.toLowerCase()}|${lang}`;
  const hit = cached(state, key);
  if (hit) return { status: 'ok', place: hit, cached: true };
  const apiKey = await readKeychain(KEYCHAIN.places);
  if (!apiKey) return { status: 'no_key', place: null };
  if (!quota(state, 'places', config.placeSearchesPerDay)) return { status: 'quota', place: null };
  try {
    const fields = ['id', 'displayName', 'shortFormattedAddress', 'rating', 'userRatingCount', 'googleMapsUri', 'websiteUri', 'businessStatus', 'regularOpeningHours.openNow'].map((f) => 'places.' + f).join(',');
    const r = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': fields },
      body: JSON.stringify({ textQuery: `${query} in ${area}`, pageSize: 5, languageCode: lang }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { status: 'error', code: r.status, place: null };
    const best = ((await r.json()).places || [])
      .filter((g) => g.businessStatus !== 'CLOSED_PERMANENTLY' && g.displayName?.text)
      .sort((a, b) => (b.rating || 0) * Math.log10(10 + (b.userRatingCount || 0)) - (a.rating || 0) * Math.log10(10 + (a.userRatingCount || 0)))[0];
    if (!best) return { status: 'empty', place: null };
    const place = { name: best.displayName.text.slice(0, 80), area: best.shortFormattedAddress || '', rating: best.rating ?? null, ratings: best.userRatingCount ?? null, url: best.websiteUri || best.googleMapsUri || null, mapsUrl: best.googleMapsUri || null };
    state.cache[key] = { at: Date.now(), value: place };
    return { status: 'ok', place };
  } catch {
    return { status: 'error', place: null };
  }
}

export async function keysStatus() {
  const [c, p] = await Promise.all([readKeychain(KEYCHAIN.channel3), readKeychain(KEYCHAIN.places)]);
  return { channel3: !!c, places: !!p };
}
