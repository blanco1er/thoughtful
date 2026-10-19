// Local, private notebook. One JSON file per mode ("live" = the owner's Bee, "sample" = invented household),
// written atomically, readable by the owner only. Nothing here ever goes into the git repository.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SCHEMA_VERSION = 1;

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    settings: {
      lang: 'en',
      consent: null, // { at, version } once the owner agreed on the first-run screen
      ownerName: '',
      ritualTime: '20:05', // just after Bee's own 8 PM daily summary
      maxNudgesPerDay: 2,
      quietMinutes: 20, // never notify within 20 min of the last heard sentence
      homeArea: '', // e.g. "Paris 11e"; used for local experiences. Never a street address.
      paused: false,
      writeToBee: true, // confirmed items become Bee facts; kept promises become Bee todos
    },
    people: {},
    items: {},
    processed: {}, // source id -> { updatedAt, items, at }
    nudges: [],
    sync: { cursor: null, lastSyncAt: null, lastError: null, lastUtteranceAt: null, capturingSince: null },
    spend: { day: null, usd: 0, totalUsd: 0, calls: 0 },
    reveals: {}, // cardDay -> true once "Show" was tapped on a shared screen
    activity: [], // what Thoughtful did, with counts only (transparency panel)
    cache: {},
  };
}

export function openStore(dir, mode = 'live') {
  const folder = path.join(dir, mode);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); fs.chmodSync(folder, 0o700); } catch {}
  const file = path.join(folder, 'notebook.json');
  let state = emptyState();
  if (fs.existsSync(file)) {
    try { state = migrate(JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch { fs.renameSync(file, file + '.unreadable-' + Date.now()); }
  }
  let timer = null;
  const store = {
    mode, file, folder,
    get state() { return state; },
    save() {
      const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
    saveSoon() { clearTimeout(timer); timer = setTimeout(() => store.save(), 150); timer.unref?.(); },
    reset() { state = emptyState(); store.save(); },
    log(kind, message) {
      state.activity.unshift({ at: Date.now(), kind, message });
      state.activity.length = Math.min(state.activity.length, 80);
    },
  };
  return store;
}

function migrate(s) {
  const base = emptyState();
  return { ...base, ...s, settings: { ...base.settings, ...(s.settings || {}) }, sync: { ...base.sync, ...(s.sync || {}) }, spend: { ...base.spend, ...(s.spend || {}) } };
}

export const newId = (prefix) => prefix + '_' + crypto.randomBytes(5).toString('hex');
