// Live Bee source. Every read and write goes through the official Bee CLI library (@beeai/cli/lib),
// which runs the signed `bee` binary with --json. Nothing here calls Bee over raw HTTP.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBeeClient } from '@beeai/cli/lib';

// Run the platform binary directly. Going through the npm wrapper (bin/bee.js) leaves the real process alive
// when we stop a stream, and npm 11 may skip the postinstall step that marks the binary executable.
export function resolveBeeBinary() {
  if (process.env.BEE_CLI_PATH) return process.env.BEE_CLI_PATH;
  try {
    // The package only exports "./lib": resolve it and walk up to the package root.
    const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@beeai/cli/lib'))), '..', '..');
    const plat = { darwin: 'mac', linux: 'linux' }[process.platform];
    const bin = path.join(pkg, 'dist', 'platforms', `${plat}-${process.arch}`, 'bee');
    if (plat && fs.existsSync(bin)) {
      try { fs.accessSync(bin, fs.constants.X_OK); } catch { fs.chmodSync(bin, 0o755); }
      return bin;
    }
    return path.join(pkg, 'bin', 'bee.js');
  } catch {
    return 'bee';
  }
}

const ms = (v) => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : v ? Date.parse(v) : null);

export function normalizeConversation(raw) {
  const c = raw?.conversation || raw;
  if (!c) return null;
  const ts = c.transcriptions || [];
  // Prefer the final (non-realtime) transcription when Bee has produced one.
  const finals = ts.filter((t) => !t.realtime);
  const chosen = finals.length ? finals : ts;
  const utterances = chosen.flatMap((t) => t.utterances || [])
    .map((u) => ({ id: u.id, speaker: u.speaker || 'Unknown', text: String(u.text || '').trim(), at: ms(u.spoken_at) || ms(u.created_at) }))
    .filter((u) => u.text);
  // Bee bug #3: the same sentence can come back twice.
  const seen = new Set();
  const dedup = utterances.filter((u) => { const k = u.speaker + '|' + u.text; if (seen.has(k)) return false; seen.add(k); return true; });
  return {
    id: c.id,
    state: c.state,
    startTime: ms(c.start_time),
    endTime: ms(c.end_time),
    updatedAt: ms(c.updated_at),
    shortSummary: c.short_summary || '',
    summary: c.summary || '',
    utterances: dedup,
  };
}

export function createLiveSource({ client } = {}) {
  const bee = client || createBeeClient({ command: resolveBeeBinary() });
  const api = bee.api;
  return {
    kind: 'live',
    bee,
    async me() {
      const m = await api.me();
      return { firstName: m?.first_name || '', timezone: m?.timezone || 'UTC' };
    },
    async isConnected() { return bee.auth.isAuthenticated(); },
    async recentConversations(sinceMs, max = 60) {
      const out = [];
      let cursor;
      for (let page = 0; page < 6 && out.length < max; page++) {
        const r = await api.conversations.list({ limit: 20, ...(cursor ? { cursor } : {}) });
        const list = r?.conversations || [];
        for (const c of list) out.push({ id: c.id, state: c.state, startTime: ms(c.start_time), endTime: ms(c.end_time), updatedAt: ms(c.updated_at), shortSummary: c.short_summary || '', utterancesCount: c.utterances_count ?? null });
        cursor = r?.next_cursor;
        if (!cursor || !list.length || ms(list[list.length - 1].start_time) < sinceMs) break;
      }
      return out.filter((c) => (c.startTime || 0) >= sinceMs);
    },
    async conversation(id) { return normalizeConversation(await api.conversations.get(id)); },
    async pendingFacts() {
      const r = await api.facts.list({ limit: 50, unconfirmed: true });
      return (r?.facts || []).map((f) => ({ id: f.id, text: f.text, tags: f.tags || [], createdAt: ms(f.created_at), confirmed: !!f.confirmed }));
    },
    async calendar() {
      const r = await api.today();
      return (r?.calendar_events || []).map((e) => ({
        title: e.title || e.summary || '',
        start: ms(e.start_time || e.start || e.startTime),
        end: ms(e.end_time || e.end || e.endTime),
        attendees: (e.attendees || []).map((a) => (typeof a === 'string' ? a : a.name || a.email || '')).filter(Boolean),
      }));
    },
    async changed(cursor) { return api.changed(cursor ? { cursor } : {}); },
    async createFact(text) { const r = await api.facts.create(text); return { id: r?.id ?? r?.fact?.id }; },
    async confirmFact(id) { await api.facts.confirm(id); },
    async deleteFact(id) { await api.facts.delete(id); },
    async createTodo(text, alarmAtIso) {
      const r = await api.todos.create({ text, ...(alarmAtIso ? { alarmAt: alarmAtIso } : {}) });
      return { id: r?.id ?? r?.todo?.id };
    },
    async completeTodo(id) { await api.todos.update(id, { completed: true }); },
    // Realtime: reconnect forever with backoff (Bee bug #16: the stream does not reconnect by itself).
    stream({ onUtterance, onConversation, onSpeaker, onState } = {}) {
      let stopped = false;
      let current = null;
      let delay = 2000;
      (async () => {
        while (!stopped) {
          try {
            current = bee.sse.streamJson({ types: ['new-utterance', 'new-conversation', 'update-conversation', 'update-conversation-summary', 'delete-conversation'] });
            onState?.('connected');
            delay = 2000;
            for await (const ev of current.events) {
              const d = ev.data || {};
              if (d.utterance) onUtterance?.({ at: Date.now(), speaker: d.utterance.speaker, conversationUuid: d.conversation_uuid });
              else if (d.conversation) onConversation?.({ id: d.conversation.id, state: d.conversation.state, at: Date.now() });
              else if (d.conversation_id && d.short_summary !== undefined) onConversation?.({ id: d.conversation_id, state: 'SUMMARIZED', at: Date.now() });
              else if (d.utterance_id && d.person_first_name !== undefined) onSpeaker?.({ at: Date.now() });
            }
          } catch (e) {
            onState?.('error', String(e?.message || e).slice(0, 140));
          }
          if (stopped) break;
          onState?.('reconnecting');
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, 60_000);
        }
      })();
      return () => { stopped = true; try { current?.close(); } catch {} };
    },
  };
}
