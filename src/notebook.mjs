// The notebook: people and what Thoughtful learned about them. Pure functions on the state object,
// plus the few Bee writes that follow an explicit decision by the owner.
import { newId } from './store.mjs';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const DAY = 86_400_000;

// How long an unconfirmed or stale item stays around (R6: memories that expire).
export const TTL = { wish: 180, like: 365, life: 45, date: 400, plan: 2, promise: 60 };

export function findPerson(state, name) {
  const n = norm(name);
  if (!n) return null;
  const all = Object.values(state.people).filter((p) => !['forgotten', 'dismissed'].includes(p.status));
  return all.find((p) => norm(p.name) === n || (p.aliases || []).some((a) => norm(a) === n))
    || all.find((p) => n.split(' ').includes(norm(p.name)) || norm(p.name).split(' ')[0] === n.split(' ')[0])
    || null;
}

export function upsertPerson(state, { name, relation, since }, now = Date.now()) {
  const found = String(name).startsWith('?') ? Object.values(state.people).find((p) => (p.aliases || []).includes(String(name))) : findPerson(state, name);
  if (found) {
    if (!found.relation && relation) found.relation = relation;
    return found;
  }
  // Never create a confirmed person from a guess (Bee sometimes mixes family members): "suggested" until the owner says yes.
  const unnamed = String(name).startsWith('?');
  const p = { id: newId('p'), name: unnamed ? '' : String(name).trim(), relation: relation || '', aliases: unnamed ? [String(name)] : [], birthday: null, status: 'suggested', createdAt: now, ...(unnamed ? { unnamed: true, since: now } : {}) };
  state.people[p.id] = p;
  return p;
}

const similar = (a, b) => {
  const x = new Set(norm(a).split(' ').filter((w) => w.length > 3));
  const y = norm(b).split(' ').filter((w) => w.length > 3);
  if (!x.size || !y.length) return false;
  const common = y.filter((w) => x.has(w)).length;
  return common / Math.min(x.size, y.length) >= 0.6;
};

/** Merge guarded items into the notebook. Returns the ids of new items. */
export function mergeItems(state, items, { sourceId, sourceType = 'conversation', saidAt, now = Date.now() }) {
  const added = [];
  for (const it of items) {
    const person = upsertPerson(state, { name: it.person, relation: it.relation }, now);
    if (person.unnamed && it.unnamedSince) person.since = it.unnamedSince;
    const dup = Object.values(state.items).find((x) => x.personId === person.id && x.kind === it.kind && x.status !== 'forgotten' && (similar(x.textEn, it.textEn) || (x.quote && x.quote === it.quote)));
    if (dup) {
      // Heard again: more evidence, same item. Keep the most recent quote as the freshest proof.
      if (dup.sourceId !== sourceId) dup.mentions = (dup.mentions || 1) + 1; // re-reading the same conversation is not a new mention
      if ((saidAt || now) > (dup.saidAt || 0)) { dup.lastQuote = it.quote; dup.lastSaidAt = saidAt || now; }
      dup.confidence = Math.max(dup.confidence, it.confidence);
      continue;
    }
    const item = {
      id: newId('i'), personId: person.id, kind: it.kind, textEn: it.textEn, textFr: it.textFr || '', quote: it.quote,
      speaker: it.speaker, saidAt: saidAt || now, sourceId, sourceType, eventDate: it.eventDate, dateKind: it.dateKind,
      giftQuery: it.giftQuery, experienceQuery: it.experienceQuery, confidence: it.confidence, mentions: 1,
      status: 'pending', beeFactId: it.beeFactId ?? null, beeFactOrigin: it.beeFactId ? 'bee' : null, beeTodoId: null,
      createdAt: now, decidedAt: null, expiresAt: now + (TTL[it.kind] || 90) * DAY,
    };
    state.items[item.id] = item;
    added.push(item.id);
  }
  return added;
}

export function expire(state, now = Date.now()) {
  let n = 0;
  for (const it of Object.values(state.items)) {
    if (it.status === 'forgotten' || it.status === 'done') continue;
    if (it.kind === 'plan' && it.eventDate && Date.parse(it.eventDate + 'T23:59:59') < now) { it.status = 'done'; n++; continue; }
    if (it.expiresAt && it.expiresAt < now && it.status !== 'confirmed') { it.status = 'expired'; n++; }
  }
  return n;
}

// ---------- decisions (always an explicit tap or voice answer from the owner) ----------

export const nameOf = (p, lang = 'en') => (p?.name ? p.name : (lang === 'fr' ? 'quelqu’un' : 'someone') + (p?.since ? ` (${new Date(p.since).toISOString().slice(0, 10)})` : ''));

export function factTextFor(item, person) {
  const who = `${nameOf(person)}${person.relation ? ` (${person.relation})` : ''}`;
  const when = new Date(item.saidAt).toISOString().slice(0, 10);
  const verb = { like: 'likes:', wish: 'would love:', life: 'news:', date: 'important date:', plan: 'plan:', promise: 'I promised:' }[item.kind] || '';
  return `${who} ${verb} ${item.textEn}${item.eventDate ? ` (${item.eventDate})` : ''}. Heard by Bee on ${when}, kept with Thoughtful.`.slice(0, 300);
}

/**
 * Confirm an item. Also confirms its person, writes a Bee fact (or confirms Bee's own pending fact), and
 * learns a birthday. Bee writes are best effort: the local decision is never lost if Bee is offline.
 */
export async function confirmItem(state, id, { source, log, now = Date.now(), writeToBee = true } = {}) {
  const it = state.items[id];
  if (!it) throw Object.assign(new Error('not_found'), { status: 404 });
  if (it.status === 'confirmed') return { item: it, already: true };
  const person = state.people[it.personId];
  it.status = 'confirmed';
  it.decidedAt = now;
  it.expiresAt = now + (TTL[it.kind] || 90) * 4 * DAY;
  if (person && person.status !== 'confirmed') person.status = 'confirmed';
  if (it.kind === 'date' && it.dateKind === 'birthday' && it.eventDate && person) person.birthday = it.eventDate.slice(5);
  let bee = null;
  if (writeToBee && source && it.kind !== 'promise' && it.kind !== 'plan') {
    try {
      if (it.beeFactOrigin === 'bee' && it.beeFactId) {
        await source.confirmFact(it.beeFactId);
        bee = 'confirmed_bee_fact';
      } else if (!it.beeFactId) {
        it.beeFactId = 'pending';
        const r = await source.createFact(factTextFor(it, person));
        it.beeFactId = r.id ?? null;
        it.beeFactOrigin = 'thoughtful';
        if (r.id != null) { await source.confirmFact(r.id); bee = 'wrote_bee_fact'; }
      }
    } catch (e) {
      if (it.beeFactId === 'pending') it.beeFactId = null;
      it.beeWriteError = String(e?.message || e).slice(0, 120);
      bee = 'bee_write_failed';
    }
  }
  log?.('decision', `Kept 1 note${bee === 'wrote_bee_fact' ? ' and saved it as a confirmed Bee fact' : bee === 'confirmed_bee_fact' ? ' and confirmed Bee’s own fact' : ''}.`);
  return { item: it, bee };
}

export function rejectItem(state, id, { log, now = Date.now() } = {}) {
  const it = state.items[id];
  if (!it) throw Object.assign(new Error('not_found'), { status: 404 });
  it.status = 'rejected';
  it.decidedAt = now;
  // a "No" on the only item of a suggested person means the person was a misunderstanding
  const p = state.people[it.personId];
  if (p && p.status === 'suggested' && !Object.values(state.items).some((x) => x.personId === p.id && x.status !== 'rejected')) p.status = 'dismissed';
  log?.('decision', 'Set 1 note aside. Thoughtful will not use it.');
  return { item: it };
}

/** Forget = removed from the notebook (text erased locally) and, if Thoughtful wrote it to Bee, deleted there too. */
export async function forgetItem(state, id, { source, log } = {}) {
  const it = state.items[id];
  if (!it) throw Object.assign(new Error('not_found'), { status: 404 });
  let bee = null;
  if (source && it.beeFactOrigin === 'thoughtful' && it.beeFactId != null && it.beeFactId !== 'pending') {
    try { await source.deleteFact(it.beeFactId); bee = 'deleted_bee_fact'; } catch (e) { bee = 'bee_delete_failed'; }
  }
  if (source && it.beeTodoId != null) {
    try { await source.completeTodo(it.beeTodoId); } catch {}
  }
  delete state.items[id];
  state.nudges = state.nudges.filter((n) => n.itemId !== id);
  log?.('forget', `Forgot 1 note${bee === 'deleted_bee_fact' ? ' and removed it from Bee' : ''}.`);
  return { bee };
}

export function markDone(state, id, { now = Date.now() } = {}) {
  const it = state.items[id];
  if (!it) throw Object.assign(new Error('not_found'), { status: 404 });
  it.status = 'done';
  it.decidedAt = now;
  return { item: it };
}

export function confirmPerson(state, id, { name, relation, birthday } = {}) {
  const p = state.people[id];
  if (!p) throw Object.assign(new Error('not_found'), { status: 404 });
  p.status = 'confirmed';
  if (name && name.trim()) { p.name = name.trim().slice(0, 40); delete p.unnamed; }
  if (relation !== undefined) p.relation = String(relation).trim().slice(0, 30);
  if (birthday !== undefined) p.birthday = /^\d{2}-\d{2}$/.test(birthday) ? birthday : null;
  return p;
}

export function personView(state, p, lang = 'en') {
  const items = Object.values(state.items).filter((i) => i.personId === p.id && ['confirmed', 'pending'].includes(i.status));
  return {
    id: p.id, name: p.name, unnamed: !!p.unnamed, since: p.since || null, relation: p.relation, birthday: p.birthday, status: p.status,
    notes: items.sort((a, b) => (b.lastSaidAt || b.saidAt) - (a.lastSaidAt || a.saidAt)).map((i) => itemView(i, lang)),
  };
}

export function itemView(i, lang = 'en') {
  return {
    id: i.id, kind: i.kind, status: i.status, text: (lang === 'fr' && i.textFr) || i.textEn, quote: i.lastQuote || i.quote,
    saidAt: i.lastSaidAt || i.saidAt, mentions: i.mentions || 1, eventDate: i.eventDate, dateKind: i.dateKind,
    source: i.sourceType, inBee: i.beeFactId != null && i.beeFactId !== 'pending', confidence: i.confidence,
  };
}
