// Application context shared by the web API and the MCP server: one store, one Bee source and one engine per mode.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { openStore } from './store.mjs';
import { createLiveSource } from './bee.mjs';
import { createSampleSource, createReplayExtractor, SAMPLE_HOME_AREA, loadRecording } from './sample.mjs';
import { createBedrockExtractor } from './extract/bedrock.mjs';
import { createEngine } from './engine.mjs';
import { confirmItem, rejectItem, forgetItem, markDone, confirmPerson, personView } from './notebook.mjs';
import { tonight, localDay } from './ritual.mjs';
import { planNudge, atLocal } from './nudges.mjs';
import { findGifts, findPlace, keysStatus } from './lookups.mjs';

const DAY = 86_400_000;

function pickExtractor(mode, store, override) {
  if (override) return override;
  const want = config.extractor;
  if (mode === 'sample' && want !== 'bedrock') return createReplayExtractor();
  return createBedrockExtractor({ spend: store.state.spend });
}

export function createContext({ dataDir = config.dataDir, mode: initialMode, sources = {}, extractors = {}, now = Date.now, lookups } = {}) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const prefsFile = path.join(dataDir, 'prefs.json');
  const prefs = (() => { try { return JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch { return {}; } })();
  const lk = lookups || { findGifts, findPlace, keysStatus };
  const modes = {};
  let mode = initialMode || prefs.mode || 'live';

  function open(m) {
    if (modes[m]) return modes[m];
    const store = openStore(dataDir, m);
    const source = sources[m] || (m === 'sample' ? createSampleSource({ now }) : createLiveSource());
    if (m === 'sample') {
      store.state.settings.homeArea ||= SAMPLE_HOME_AREA;
      store.state.settings.consent ||= { at: now(), version: 1, sample: true };
    }
    const extractor = pickExtractor(m, store, extractors[m]);
    const engine = createEngine({ store, source, extractor, now });
    modes[m] = { mode: m, store, source, extractor, engine };
    return modes[m];
  }

  const cur = () => open(mode);
  const S = () => cur().store.state;
  const lang = () => S().settings.lang || 'en';
  const tz = () => S().settings.timezone || 'Europe/Paris';
  const save = () => cur().store.save();
  const log = (k, m) => cur().store.log(k, m);

  const ctx = {
    get mode() { return mode; },
    get current() { return cur(); },
    open,
    setMode(m) {
      if (!['live', 'sample'].includes(m)) throw Object.assign(new Error('bad_mode'), { status: 400 });
      mode = m;
      fs.writeFileSync(prefsFile, JSON.stringify({ ...prefs, mode: m }), { mode: 0o600 });
      return cur();
    },
    needsOnboarding() { return mode === 'live' ? !S().settings.consent : false; },
    firstRun() { return mode === 'live' && !prefs.mode && !fs.existsSync(path.join(dataDir, 'live', 'notebook.json')); },

    tonight() { return tonight(S(), { now: now(), tz: tz(), lang: lang() }); },

    async summary() {
      const s = S();
      const keys = await lk.keysStatus().catch(() => ({ channel3: false, places: false }));
      const ex = cur().extractor;
      return {
        mode, firstRun: ctx.firstRun(), needsOnboarding: ctx.needsOnboarding(),
        settings: s.settings,
        tonight: ctx.tonight(),
        people: ctx.people(),
        activity: s.activity.slice(0, 20),
        connection: {
          stream: s.sync.stream || null, lastSyncAt: s.sync.lastSyncAt, lastError: s.sync.lastError,
          extractor: ex.name, model: ex.name === 'bedrock' ? config.model : ex.recordedWith, recordedOn: ex.recordedOn || null,
          spendToday: s.spend.day === new Date(now()).toISOString().slice(0, 10) ? s.spend.usd : 0, spendCap: config.spendCapDayUsd,
          keys,
        },
        sampleWrites: mode === 'sample' ? cur().source.writes : undefined,
      };
    },

    /** "Sunday" view for a TV: family-safe, names and counts only (no quotes, no gifts). */
    week() {
      const s = S();
      const t = now();
      const today = localDay(t, tz());
      const items = Object.values(s.items);
      const name = (id) => s.people[id]?.name || '';
      const learned = {};
      for (const i of items) if (i.status === 'confirmed' && i.kind !== 'promise' && i.saidAt > t - 7 * DAY) learned[i.personId] = (learned[i.personId] || 0) + 1;
      const upcoming = [];
      for (const p of Object.values(s.people)) {
        if (p.status !== 'confirmed' || !p.birthday) continue;
        const y = Number(today.slice(0, 4));
        let d = `${y}-${p.birthday}`;
        if (d < today) d = `${y + 1}-${p.birthday}`;
        const days = Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / DAY);
        if (days <= 30) upcoming.push({ name: p.name, relation: p.relation, date: d, days, kind: 'birthday' });
      }
      const seeing = items.filter((i) => i.kind === 'plan' && i.status === 'confirmed' && i.eventDate && i.eventDate >= today && i.eventDate <= localDay(t + 7 * DAY, tz()))
        .map((i) => ({ name: name(i.personId), date: i.eventDate })).sort((a, b) => a.date.localeCompare(b.date));
      const promises = items.filter((i) => i.kind === 'promise');
      return {
        mode, lang: lang(), today,
        learned: Object.entries(learned).map(([pid, n]) => ({ name: name(pid), relation: s.people[pid]?.relation || '', n })).sort((a, b) => b.n - a.n),
        upcoming: upcoming.sort((a, b) => a.days - b.days),
        seeing,
        promises: { kept: promises.filter((i) => i.status === 'done' && i.decidedAt > t - 7 * DAY).length, open: promises.filter((i) => i.status === 'confirmed').length },
        reminders: s.nudges.filter((n) => n.status === 'sent' && n.sentAt > t - 7 * DAY).length,
      };
    },

    people() {
      const s = S();
      return Object.values(s.people).filter((p) => ['confirmed', 'suggested'].includes(p.status)).map((p) => {
        const items = Object.values(s.items).filter((i) => i.personId === p.id && ['confirmed', 'pending'].includes(i.status));
        return { id: p.id, name: p.name, relation: p.relation, status: p.status, birthday: p.birthday, notes: items.filter((i) => i.status === 'confirmed').length, pending: items.filter((i) => i.status === 'pending').length, last: Math.max(0, ...items.map((i) => i.lastSaidAt || i.saidAt)) };
      }).filter((p) => p.status === 'confirmed' || p.pending > 0).sort((a, b) => (a.status === 'confirmed' ? 0 : 1) - (b.status === 'confirmed' ? 0 : 1) || b.last - a.last);
    },
    person(id) {
      const p = S().people[id];
      if (!p) throw Object.assign(new Error('not_found'), { status: 404 });
      return personView(S(), p, lang());
    },
    findPersonByName(name) {
      const n = String(name || '').toLowerCase().trim();
      return Object.values(S().people).find((p) => p.status === 'confirmed' && (p.name.toLowerCase() === n || p.name.toLowerCase().startsWith(n) || (p.relation || '').toLowerCase() === n)) || null;
    },

    // ----- decisions -----
    async confirm(id) {
      const r = await confirmItem(S(), id, { source: cur().source, log, now: now(), writeToBee: S().settings.writeToBee !== false });
      save();
      return { ok: true, bee: r.bee, person: S().people[r.item.personId]?.name };
    },
    reject(id) { rejectItem(S(), id, { log, now: now() }); save(); return { ok: true }; },
    async forget(id) { const r = await forgetItem(S(), id, { source: cur().source, log }); save(); return { ok: true, ...r }; },
    done(id) {
      markDone(S(), id, { now: now() });
      for (const n of S().nudges) if (n.itemId === id && n.status === 'planned') { n.status = 'cancelled'; }
      save();
      return { ok: true };
    },
    remind(id, when = 'tomorrow9') {
      const it = S().items[id];
      if (!it) throw Object.assign(new Error('not_found'), { status: 404 });
      const p = S().people[it.personId];
      const today = localDay(now(), tz());
      const day = localDay(now() + (when === 'in3days' ? 3 : 1) * DAY, tz());
      const due = atLocal(day, '09:00', tz());
      const fr = lang() === 'fr';
      const text = it.kind === 'promise'
        ? `${fr ? 'Promis à' : 'Promised'} ${p?.name}: ${(fr && it.textFr) || it.textEn}`
        : `${p?.name}: ${(fr && it.textFr) || it.textEn}`;
      const n = planNudge(S(), { key: `remind:${id}:${day}`, itemId: id, personId: it.personId, kind: it.kind === 'promise' ? 'promise' : 'occasion', text, dueAt: due, now: now() });
      save();
      return { ok: true, dueAt: n?.dueAt || due, day, today };
    },
    updatePerson(id, body = {}) { const p = confirmPerson(S(), id, body); save(); return { ok: true, person: { id: p.id, name: p.name } }; },
    async forgetPerson(id) {
      const s = S();
      const p = s.people[id];
      if (!p) throw Object.assign(new Error('not_found'), { status: 404 });
      for (const it of Object.values(s.items).filter((i) => i.personId === id)) await forgetItem(s, it.id, { source: cur().source });
      delete s.people[id];
      log('forget', 'Forgot 1 person and every note about them.');
      save();
      return { ok: true };
    },
    // "Show" on a shared screen lasts 10 minutes, then the surprise is covered again.
    reveal(on = true) { S().reveals = on ? { [localDay(now(), tz())]: now() } : {}; save(); return { ok: true }; },
    settings(body = {}) {
      const s = S().settings;
      if (body.lang && ['en', 'fr'].includes(body.lang)) s.lang = body.lang;
      if (typeof body.ritualTime === 'string' && /^\d{2}:\d{2}$/.test(body.ritualTime)) s.ritualTime = body.ritualTime;
      if (body.maxNudgesPerDay !== undefined) s.maxNudgesPerDay = Math.max(0, Math.min(2, Number(body.maxNudgesPerDay) | 0));
      if (body.quietMinutes !== undefined) s.quietMinutes = Math.max(10, Math.min(60, Number(body.quietMinutes) | 0));
      if (typeof body.homeArea === 'string') s.homeArea = body.homeArea.replace(/[0-9]{1,5}\s*(rue|avenue|bd|boulevard|street|st\.?|ave)\b.*/i, '').trim().slice(0, 60);
      if (typeof body.paused === 'boolean') s.paused = body.paused;
      if (typeof body.writeToBee === 'boolean') s.writeToBee = body.writeToBee;
      save();
      return { ok: true, settings: s };
    },
    onboard({ lang: l, consent, mode: m }) {
      if (consent !== true) throw Object.assign(new Error('consent_required'), { status: 400 });
      if (m) ctx.setMode(m);
      const s = S().settings;
      if (l && ['en', 'fr'].includes(l)) s.lang = l;
      s.consent = { at: now(), version: 1 };
      save();
      return { ok: true };
    },
    async erase({ alsoBee = true } = {}) {
      const c = cur();
      const s = c.store.state;
      let deleted = 0;
      if (alsoBee) {
        for (const it of Object.values(s.items)) {
          if (it.beeFactOrigin === 'thoughtful' && it.beeFactId != null && it.beeFactId !== 'pending') {
            try { await c.source.deleteFact(it.beeFactId); deleted++; } catch {}
          }
        }
      }
      const keep = { lang: s.settings.lang };
      c.store.reset();
      c.store.state.settings.lang = keep.lang;
      if (mode === 'sample') { delete modes.sample; open('sample'); }
      c.store.save();
      return { ok: true, beeFactsDeleted: deleted };
    },
    async sync() { const r = await cur().engine.sync(); return { ok: true, ...r }; },

    /** Sample household: read it once, then replay "previous evenings" so the notebook is not empty on day one. */
    async ensureSampleSeed() {
      const c = open('sample');
      const s = c.store.state;
      if (s.sync.lastSyncAt) return false;
      await c.engine.sync();
      const byName = (n) => Object.values(s.people).find((p) => p.name.toLowerCase().startsWith(n));
      const keepPending = (it) => {
        const p = s.people[it.personId];
        return (p?.name === 'Maya' && it.kind === 'like') || p?.name?.startsWith('Jonas') || it.sourceType === 'bee_fact';
      };
      const past = now() - 2 * DAY;
      for (const it of Object.values(s.items)) {
        if (keepPending(it)) continue;
        await confirmItem(s, it.id, { source: c.source, now: past, writeToBee: true });
      }
      const mamie = byName('mamie');
      if (mamie) mamie.relation ||= 'grandmother';
      s.activity = [];
      c.store.log('sync', 'Sample household loaded: 5 invented conversations read. The TV show and the sensitive parts were set aside.');
      c.store.save();
      return true;
    },

    async extras(kind = 'occasion') {
      const card = ctx.tonight();
      const el = card.elements.find((e) => e.type === kind);
      if (!el) return { gifts: { status: 'empty', products: [] }, place: { status: 'empty', place: null } };
      const s = S();
      const [gifts, place] = await Promise.all([
        lk.findGifts(s, el.giftQuery),
        lk.findPlace(s, el.experienceQuery, s.settings.homeArea, { lang: lang() }),
      ]);
      save();
      return { gifts, place, giftQuery: el.giftQuery, experienceQuery: el.experienceQuery };
    },
  };
  return ctx;
}

export { loadRecording };
