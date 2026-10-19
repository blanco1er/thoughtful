// Test helpers. Every person, sentence and date here is INVENTED.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyState } from '../src/store.mjs';

export const tmpDir = (p = 'thoughtful-test-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

export function fakeSource(over = {}) {
  const calls = [];
  let n = 100;
  return {
    kind: 'fake', calls,
    async me() { return { firstName: 'Sam', timezone: 'Europe/Paris' }; },
    async isConnected() { return true; },
    async recentConversations() { return over.conversations?.map(({ utterances, ...c }) => c) || []; },
    async conversation(id) { return over.conversations?.find((c) => c.id === id) || null; },
    async pendingFacts() { return over.facts || []; },
    async calendar() { return over.calendar || []; },
    async createFact(text) { calls.push(['createFact', text]); return { id: ++n }; },
    async confirmFact(id) { calls.push(['confirmFact', id]); },
    async deleteFact(id) { calls.push(['deleteFact', id]); },
    async createTodo(text, alarm) { calls.push(['createTodo', text, alarm]); if (over.todoFails) throw new Error('offline'); return { id: ++n }; },
    async completeTodo(id) { calls.push(['completeTodo', id]); },
  };
}

export function fakeExtractor(byConv = {}, facts = []) {
  return {
    name: 'fake',
    async conversation({ conv }) { return { items: byConv[conv.id] || [] }; },
    async facts() { return { items: facts }; },
  };
}

export const T0 = Date.parse('2026-10-19T18:00:00Z'); // Monday 19 Oct 2026, 20:00 in Paris

export function conv(id, lines, { at = T0 - 3600e3, state = 'COMPLETED' } = {}) {
  return {
    id, state, startTime: at, endTime: at + lines.length * 30e3, updatedAt: at + lines.length * 30e3, shortSummary: '', summary: '',
    utterances: lines.map(([speaker, text], i) => ({ id: id * 100 + i, speaker, text, at: at + i * 30e3 })),
  };
}

export function stateWith(fn) { const s = emptyState(); fn?.(s); return s; }
