// The engine: read Bee, extract, guard, merge, plan nudges, send them at a quiet moment.
import { guardItems, isOwner } from './extract/filters.mjs';
import { transcriptFor } from './extract/prompt.mjs';
import { mergeItems, expire } from './notebook.mjs';
import { deriveNudges, runDue } from './nudges.mjs';
import { localDay } from './ritual.mjs';

const DAY = 86_400_000;
const MIN = 60_000;
export const MIN_UTTERANCES = 4;

/**
 * Should this conversation be read at all? Skips what the owner did not take part in (TV, radio, other people
 * talking nearby) and conversations still being captured (Bee bug #21: one can stay CAPTURING for hours, so we
 * also accept one that has been silent for `quietMinutes`).
 */
export function conversationGate(conv, { ownerName, now = Date.now(), quietMinutes = 20 }) {
  if (conv.state === 'CAPTURING') {
    const last = Math.max(...conv.utterances.map((u) => u.at || 0), conv.updatedAt || 0);
    if (now - last < quietMinutes * MIN) return 'still_capturing';
  }
  if (conv.utterances.length < MIN_UTTERANCES) return 'too_short';
  if (ownerName) {
    const mine = conv.utterances.filter((u) => isOwner(u.speaker, ownerName)).length;
    if (mine === 0) return 'owner_not_in_it';
  }
  return 'ok';
}

export function createEngine({ store, source, extractor, tz: tzOpt, now: nowFn = Date.now }) {
  let busy = null;
  let stopStream = null;
  const st = () => store.state;
  const log = (k, m) => store.log(k, m);
  const tz = () => tzOpt || st().settings.timezone || 'Europe/Paris';

  async function syncOnce() {
    const s = st();
    const now = nowFn();
    const counts = { read: 0, notes: 0, setAside: {}, skipped: {}, facts: 0 };
    try {
      const me = await source.me();
      if (me.firstName && !s.settings.ownerName) s.settings.ownerName = me.firstName;
      if (me.timezone) s.settings.timezone = me.timezone;
      const ownerName = s.settings.ownerName;
      const since = Math.max(now - 14 * DAY, (s.sync.lastSyncAt || now - 7 * DAY) - 6 * 3600e3);
      const list = await source.recentConversations(since);
      const capturing = list.filter((c) => c.state === 'CAPTURING').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
      s.sync.capturingSince = capturing ? capturing.startTime : null;
      s.sync.capturingUpdatedAt = capturing ? capturing.updatedAt : null;
      const people = () => Object.values(s.people).filter((p) => !['dismissed', 'forgotten'].includes(p.status));
      for (const c of list.sort((a, b) => (a.startTime || 0) - (b.startTime || 0))) {
        const done = s.processed['c' + c.id];
        if (done && done.updatedAt >= (c.updatedAt || 0)) continue;
        const conv = await source.conversation(c.id);
        if (!conv) continue;
        // Bee's voice recognition works on some accounts and not on others (bug #19). Only use "the owner was not
        // in it" as a gate once we have seen Bee recognise the owner at least once.
        if (ownerName && conv.utterances.some((u) => isOwner(u.speaker, ownerName))) s.sync.ownerSeen = true;
        const gate = conversationGate(conv, { ownerName: s.sync.ownerSeen ? ownerName : '', now, quietMinutes: s.settings.quietMinutes });
        if (gate !== 'ok') {
          counts.skipped[gate] = (counts.skipped[gate] || 0) + 1;
          if (gate !== 'still_capturing') s.processed['c' + c.id] = { updatedAt: conv.updatedAt || 0, items: 0, at: now, skipped: gate };
          continue;
        }
        counts.read++;
        const r = await extractor.conversation({ conv, ownerName, people: people(), today: localDay(now, tz()), timezone: tz() });
        const { kept, dropped } = guardItems(r.items, { transcriptText: transcriptFor(conv, ownerName, 1e7), utterances: conv.utterances, ownerName });
        for (const d of dropped) counts.setAside[d.reason] = (counts.setAside[d.reason] || 0) + 1;
        const saidAt = conv.startTime || now;
        const added = mergeItems(s, kept, { sourceId: 'c' + c.id, sourceType: 'conversation', saidAt, now });
        counts.notes += added.length;
        s.processed['c' + c.id] = { updatedAt: conv.updatedAt || 0, items: added.length, at: now };
        store.saveSoon();
      }
      // Bee's own guesses (pending facts) that are about someone close: one tap confirms them in Bee.
      const facts = (await source.pendingFacts()).filter((f) => !s.processed['f' + f.id]);
      if (facts.length) {
        const r = await extractor.facts({ facts, ownerName, people: people(), today: localDay(now, tz()) });
        const { kept, dropped } = guardItems(r.items.filter((i) => facts.some((f) => String(f.id) === String(i.bee_fact_id))), { sourceKind: 'bee_fact', ownerName });
        for (const d of dropped) counts.setAside[d.reason] = (counts.setAside[d.reason] || 0) + 1;
        for (const it of kept) {
          const f = facts.find((x) => String(x.id) === String(it.beeFactId));
          it.quote = f.text;
          counts.facts += mergeItems(s, [it], { sourceId: 'f' + f.id, sourceType: 'bee_fact', saidAt: f.createdAt || now, now }).length;
        }
        for (const f of facts) s.processed['f' + f.id] = { updatedAt: f.createdAt || 0, at: now };
      }
      let calendar = [];
      try { calendar = await source.calendar(); } catch {}
      s.cache.calendarCount = calendar.length;
      expire(s, now);
      deriveNudges(s, { now, tz: tz(), lang: s.settings.lang, calendar });
      s.sync.lastSyncAt = now;
      s.sync.lastError = null;
      const aside = Object.values(counts.setAside).reduce((a, b) => a + b, 0);
      if (counts.read || counts.facts || aside) {
        log('sync', `Read ${counts.read} conversation${counts.read === 1 ? '' : 's'} from Bee. ${counts.notes + counts.facts} new note${counts.notes + counts.facts === 1 ? '' : 's'} to confirm. ${aside} set aside (${Object.entries(counts.setAside).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ') || 'none'}).`);
      }
      return counts;
    } catch (e) {
      s.sync.lastError = { at: now, message: String(e?.code === 'spend_cap' ? 'Spending cap reached: extraction paused until tomorrow.' : e?.message || e).slice(0, 200) };
      throw e;
    } finally {
      store.save();
    }
  }

  return {
    async sync() {
      if (busy) return busy;
      busy = syncOnce().finally(() => { busy = null; });
      return busy;
    },
    async tick() {
      const r = await runDue(st(), { source, now: nowFn(), tz: tz(), log });
      if (r.length) store.save();
      return r;
    },
    startStream() {
      if (!source.stream || stopStream) return;
      stopStream = source.stream({
        onUtterance: (u) => { st().sync.lastUtteranceAt = u.at; },
        onConversation: (c) => {
          if (c.state === 'CAPTURING') { st().sync.capturingSince ||= c.at; st().sync.capturingUpdatedAt = c.at; }
          if (c.state === 'COMPLETED' || c.state === 'SUMMARIZED') setTimeout(() => this.sync().catch(() => {}), 90_000).unref?.();
        },
        onState: (state) => { st().sync.stream = state; },
      });
    },
    stop() { stopStream?.(); stopStream = null; },
  };
}
