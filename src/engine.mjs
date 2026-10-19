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

// What the owner sees when reading Bee fails: the cause and the way out, never a stack trace.
export function friendlyError(e) {
  const m = String(e?.message || e || '');
  if (e?.code === 'spend_cap') return 'Spending cap reached: extraction is paused until tomorrow.';
  if (/Could not load credentials|CredentialsProviderError|ExpiredToken|security token|UnrecognizedClient|SSO/i.test(m + ' ' + e?.name)) return 'Amazon Bedrock credentials are missing or expired for this AWS profile. Run "aws sso login" (or set THOUGHTFUL_AWS_PROFILE), then "Read Bee now".';
  if (/AccessDenied|not authorized|use case details/i.test(m + ' ' + e?.name)) return 'This AWS account cannot use the extraction model yet (Bedrock model access). Nothing was read.';
  if (/Not logged in|unauthori[sz]ed|401|bee login/i.test(m)) return 'The Bee CLI is not signed in on this Mac. Run "npx bee login".';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(m)) return 'No network: Thoughtful will read Bee again automatically.';
  return m.slice(0, 160) || 'Unknown error';
}

/** Same person, same kind, same or very close note (or the same quote): one item, not two (windows overlap). */
export function dedupeItems(items) {
  const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = (x) => new Set(norm(x).split(' ').filter((w) => w.length > 3));
  const close = (a, b) => { const A = words(a), B = [...words(b)]; if (!A.size || !B.length) return false; return B.filter((w) => A.has(w)).length / Math.min(A.size, B.length) >= 0.6; };
  const out = [];
  for (const it of items) {
    const dup = out.find((o) => (norm(o.quote) && norm(o.quote) === norm(it.quote)) || (norm(o.person) === norm(it.person) && o.kind === it.kind && close(o.textEn, it.textEn)));
    if (dup) { if ((it.confidence || 0) > (dup.confidence || 0)) Object.assign(dup, it); continue; }
    out.push({ ...it });
  }
  return out;
}

export function createEngine({ store, source, extractor, tz: tzOpt, now: nowFn = Date.now }) {
  let busy = null;
  let stopStream = null;
  const st = () => store.state;
  const log = (k, m) => store.log(k, m);
  const tz = () => tzOpt || st().settings.timezone || 'Europe/Paris';

  async function syncOnce({ reprocessLast = 0 } = {}) {
    const s = st();
    const now = nowFn();
    const counts = { read: 0, notes: 0, setAside: {}, skipped: {}, facts: 0, errors: 0, conversations: [] };
    try {
      const me = await source.me();
      if (me.firstName && !s.settings.ownerName) s.settings.ownerName = me.firstName;
      if (me.timezone) s.settings.timezone = me.timezone;
      const ownerName = s.settings.ownerName;
      const since = reprocessLast > 0 ? now - 14 * DAY : Math.max(now - 14 * DAY, (s.sync.lastSyncAt || now - 7 * DAY) - 6 * 3600e3);
      const list = await source.recentConversations(since);
      if (reprocessLast > 0) {
        // Read again the N most recent finished conversations (e.g. after a fix). Notes already kept are not duplicated.
        const done = list.filter((c) => c.state !== 'CAPTURING').sort((a, b) => (b.startTime || 0) - (a.startTime || 0)).slice(0, reprocessLast);
        for (const c of done) delete s.processed['c' + c.id];
      }
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
        // Each window is checked against its own sentences (verbatim quote), then the windows are merged.
        const parts = r.parts || [{ items: r.items || [], utterances: conv.utterances, parseError: !!r.parseError }];
        const diag = { key: 'c' + c.id, id: String(c.id).slice(-4), chars: r.chars ?? transcriptFor(conv, ownerName, 1e9).length, windows: parts.length, windowsSkipped: r.windowsSkipped || 0, raw: 0, kept: 0, added: 0, parseErrors: 0, rejected: {}, kinds: {} };
        const keptAll = [];
        for (const part of parts) {
          if (part.parseError) { diag.parseErrors++; counts.errors++; }
          diag.raw += part.items.length;
          const { kept, dropped } = guardItems(part.items, { transcriptText: transcriptFor({ utterances: part.utterances }, ownerName, 1e9), utterances: part.utterances, ownerName });
          for (const d of dropped) { counts.setAside[d.reason] = (counts.setAside[d.reason] || 0) + 1; diag.rejected[d.reason] = (diag.rejected[d.reason] || 0) + 1; }
          keptAll.push(...kept);
        }
        const unique = dedupeItems(keptAll);
        diag.kept = unique.length;
        diag.rejected.duplicate_across_windows = keptAll.length - unique.length || undefined;
        for (const it of unique) diag.kinds[it.kind] = (diag.kinds[it.kind] || 0) + 1;
        const saidAt = conv.startTime || now;
        const added = mergeItems(s, unique, { sourceId: 'c' + c.id, sourceType: 'conversation', saidAt, now });
        diag.added = added.length;
        counts.notes += added.length;
        counts.conversations.push(diag);
        // counts only: never a name, a quote or a sentence
        console.log(`[thoughtful] conversation …${diag.id}: ${diag.chars} chars, ${diag.windows} window(s)${diag.windowsSkipped ? ` (+${diag.windowsSkipped} not read: cap)` : ''}, ${diag.raw} raw, ${diag.kept} kept, ${diag.added} new, parse errors ${diag.parseErrors}, rejected ${JSON.stringify(diag.rejected)}, kinds ${JSON.stringify(diag.kinds)}`);
        s.processed['c' + c.id] = { updatedAt: conv.updatedAt || 0, items: added.length, at: now, windows: diag.windows, raw: diag.raw, parseErrors: diag.parseErrors };
        store.saveSoon();
      }
      // Bee's own guesses (pending facts) that are about someone close: one tap confirms them in Bee.
      const facts = (await source.pendingFacts()).filter((f) => !s.processed['f' + f.id]);
      if (facts.length) {
        const r = await extractor.facts({ facts, ownerName, people: people(), today: localDay(now, tz()) });
        if (r.parseError) counts.errors++;
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
      // a part the model answered with broken JSON is read again next time
      for (const d of counts.conversations) if (d.parseErrors) delete s.processed[d.key];
      const aside = Object.values(counts.setAside).reduce((a, b) => a + b, 0);
      if (counts.read || counts.facts || aside || counts.errors) {
        const windows = counts.conversations.reduce((a, d) => a + d.windows, 0);
        log('sync', `Read ${counts.read} conversation${counts.read === 1 ? '' : 's'} from Bee (${windows} part${windows === 1 ? '' : 's'}). ${counts.notes + counts.facts} new note${counts.notes + counts.facts === 1 ? '' : 's'} to confirm. ${aside} set aside (${Object.entries(counts.setAside).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ') || 'none'}).${counts.errors ? ` ${counts.errors} unreadable model answer${counts.errors === 1 ? '' : 's'}.` : ''}`);
      }
      if (counts.errors) s.sync.lastError = { at: now, message: `${counts.errors} model answer(s) could not be read; those parts will be read again next time.` };
      return counts;
    } catch (e) {
      s.sync.lastError = { at: now, message: friendlyError(e) };
      throw e;
    } finally {
      store.save();
    }
  }

  return {
    async sync(opts = {}) {
      if (busy) return busy;
      busy = syncOnce(opts).finally(() => { busy = null; });
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
