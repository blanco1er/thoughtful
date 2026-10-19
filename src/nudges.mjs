// The right moment, without interrupting. A nudge is a Bee todo with an alarm (it reaches the phone and the
// watch through the Bee app). Thoughtful creates it just in time, and only when nobody is talking:
//   - never within `quietMinutes` of the last sentence Bee heard (live stream) or while a conversation is capturing,
//   - never more than `maxNudgesPerDay` (default 2),
//   - never while paused.
import { newId } from './store.mjs';
import { localDay, daysBetween, nextBirthday } from './ritual.mjs';
import { nameOf } from './notebook.mjs';

const MIN = 60_000;
export const POSTPONE_MIN = 10;
export const MAX_POSTPONES = 12; // two hours of conversation, then we give up for this nudge

export function sentToday(state, now, tz) {
  const d = localDay(now, tz);
  return state.nudges.filter((n) => n.status === 'sent' && localDay(n.sentAt, tz) === d).length;
}

export function isQuiet(state, now) {
  const q = (state.settings.quietMinutes ?? 20) * MIN;
  if (state.sync.lastUtteranceAt && now - state.sync.lastUtteranceAt < q) return false;
  if (state.sync.capturingSince && now - (state.sync.capturingUpdatedAt || state.sync.capturingSince) < q) return false;
  return true;
}

/** Plan a nudge once (dedupe by key). */
export function planNudge(state, { key, itemId = null, personId = null, kind, text, dueAt, now = Date.now() }) {
  if (state.nudges.some((n) => n.key === key && n.status !== 'cancelled')) return null;
  const n = { id: newId('n'), key, itemId, personId, kind, text: String(text).slice(0, 120), dueAt, status: 'planned', postponed: 0, createdAt: now, sentAt: null, beeTodoId: null, reason: null };
  state.nudges.push(n);
  return n;
}

const atLocal = (day, hhmm, tz) => {
  // Build the UTC instant of `day hh:mm` in timezone tz.
  const [h, m] = hhmm.split(':').map(Number);
  const guess = Date.parse(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(guess));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asTz = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
  return guess - (asTz - guess);
};
export { atLocal };

/** Derive automatic nudges from the notebook: "before you see them" and "occasion in 7 days". */
export function deriveNudges(state, { now = Date.now(), tz = 'Europe/Paris', lang = 'en', calendar = [] } = {}) {
  const today = localDay(now, tz);
  const items = Object.values(state.items);
  const people = state.people;
  const fr = lang === 'fr';
  const planned = [];
  const newsFor = (pid) => items.filter((x) => x.personId === pid && x.status === 'confirmed' && ['life', 'wish', 'like'].includes(x.kind))
    .sort((a, b) => (b.kind === 'life') - (a.kind === 'life') || (b.lastSaidAt || b.saidAt) - (a.lastSaidAt || a.saidAt))[0];
  const line = (it) => (fr && it.textFr) || it.textEn;

  // Before you see someone: a confirmed plan today, or a calendar event that names a confirmed person.
  const seeing = [];
  for (const i of items) if (i.kind === 'plan' && i.status === 'confirmed' && i.eventDate === today) seeing.push({ pid: i.personId, at: atLocal(today, '09:00', tz), key: `see:${i.id}` });
  for (const ev of calendar) {
    if (!ev.start || localDay(ev.start, tz) !== today) continue;
    const hay = (ev.title + ' ' + (ev.attendees || []).join(' ')).toLowerCase();
    for (const p of Object.values(people)) {
      if (p.status !== 'confirmed' || !p.name) continue; // an unnamed person cannot be matched in a calendar
      if (hay.includes(p.name.toLowerCase())) seeing.push({ pid: p.id, at: ev.start - 30 * MIN, key: `cal:${p.id}:${today}` });
    }
  }
  for (const s of seeing) {
    const news = newsFor(s.pid);
    if (!news) continue;
    const p = people[s.pid];
    const n = planNudge(state, { key: s.key, personId: s.pid, itemId: news.id, kind: 'see', dueAt: Math.max(now, s.at), now,
      text: `${fr ? 'Avant de voir' : 'Seeing'} ${nameOf(p, lang)}: ${line(news)}` });
    if (n) planned.push(n);
  }

  // Occasion: 7 days before, at 9:00, if a gift is not already chosen.
  for (const p of Object.values(people)) {
    if (p.status !== 'confirmed') continue;
    const b = nextBirthday(p.birthday, today);
    if (!b || daysBetween(today, b) !== 7) continue;
    const n = planNudge(state, { key: `bday7:${p.id}:${b}`, personId: p.id, kind: 'occasion', dueAt: Math.max(now, atLocal(today, '09:00', tz)), now,
      text: fr ? `Anniversaire de ${nameOf(p, lang)} dans 7 jours. Idées prêtes dans Thoughtful.` : `${nameOf(p, lang)}'s birthday in 7 days. Ideas are ready in Thoughtful.` });
    if (n) planned.push(n);
  }
  return planned;
}

/**
 * Send what is due, if the moment is right. `source.createTodo` writes a Bee todo with alarm_at one minute later,
 * so Bee itself rings the phone and the watch.
 */
export async function runDue(state, { source, now = Date.now(), tz = 'Europe/Paris', log } = {}) {
  const results = [];
  const due = state.nudges.filter((n) => n.status === 'planned' && n.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
  for (const n of due) {
    if (state.settings.paused) { n.status = 'skipped'; n.reason = 'paused'; results.push(n); continue; }
    if (sentToday(state, now, tz) >= (state.settings.maxNudgesPerDay ?? 2)) { n.status = 'skipped'; n.reason = 'daily_limit'; results.push(n); continue; }
    if (!isQuiet(state, now)) {
      if (n.postponed >= MAX_POSTPONES) { n.status = 'skipped'; n.reason = 'never_quiet'; }
      else { n.postponed++; n.dueAt = now + POSTPONE_MIN * MIN; n.reason = 'conversation_in_progress'; }
      results.push(n);
      continue;
    }
    try {
      const alarm = new Date(Math.ceil((now + MIN) / MIN) * MIN).toISOString();
      const r = await source.createTodo(n.text, alarm);
      n.status = 'sent'; n.sentAt = now; n.beeTodoId = r.id ?? null; n.alarmAt = alarm; n.reason = null;
      if (n.itemId && state.items[n.itemId] && n.kind === 'promise') state.items[n.itemId].beeTodoId = r.id ?? null;
      log?.('nudge', `Sent 1 reminder to Bee (todo with an alarm). ${sentToday(state, now, tz)} of ${state.settings.maxNudgesPerDay ?? 2} today.`);
    } catch (e) {
      n.postponed++; n.dueAt = now + POSTPONE_MIN * MIN; n.reason = 'bee_unreachable';
    }
    results.push(n);
  }
  return results;
}
