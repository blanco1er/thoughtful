// Tonight's card: never more than three things, chosen by rules the owner can read (R2).
//   1. one note to confirm (at most 3 decisions a day, never a queue to empty),
//   2. one occasion coming up in the next 14 days (or, if none, someone you will see soon),
//   3. one promise to keep.
import { itemView } from './notebook.mjs';

const DAY = 86_400_000;
export const OCCASION_WINDOW_DAYS = 14;
export const MAX_DECISIONS_PER_DAY = 3;
export const REVEAL_MS = 10 * 60_000;

export function localDay(now = Date.now(), tz = 'Europe/Paris') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

// Days between two YYYY-MM-DD strings (calendar days, no DST surprises).
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY);

export function nextBirthday(mmdd, today) {
  if (!/^\d{2}-\d{2}$/.test(mmdd || '')) return null;
  const y = Number(today.slice(0, 4));
  let d = `${y}-${mmdd}`;
  if (mmdd === '02-29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) d = `${y}-02-28`;
  if (daysBetween(today, d) < 0) d = `${y + 1}-${mmdd === '02-29' ? '02-28' : mmdd}`;
  return d;
}

function score(it, now) {
  const ageDays = (now - (it.lastSaidAt || it.saidAt)) / DAY;
  const kindBoost = { wish: 0.3, date: 0.3, life: 0.2, promise: 0.25, like: 0.1, plan: 0 }[it.kind] || 0;
  return it.confidence + Math.min(3, it.mentions || 1) * 0.1 + kindBoost - Math.min(1, ageDays / 30) * 0.2;
}

export function tonight(state, { now = Date.now(), tz = 'Europe/Paris', lang = 'en' } = {}) {
  const today = localDay(now, tz);
  const people = state.people;
  const items = Object.values(state.items);
  const alive = (p) => p && !['dismissed', 'forgotten'].includes(p.status);
  const person = (id) => { const p = people[id]; return p ? { id: p.id, name: p.name, relation: p.relation, status: p.status } : null; };
  const elements = [];

  // 1. One note to confirm
  const decidedToday = items.filter((i) => i.decidedAt && localDay(i.decidedAt, tz) === today && ['confirmed', 'rejected'].includes(i.status)).length;
  const pending = items.filter((i) => i.status === 'pending' && alive(people[i.personId]) && i.kind !== 'plan');
  if (decidedToday < MAX_DECISIONS_PER_DAY && pending.length) {
    // People already in the notebook first: a note about someone you know is easier to answer than a newcomer.
    const known = (i) => (people[i.personId]?.status === 'confirmed' ? 0.25 : 0);
    const it = pending.sort((a, b) => score(b, now) + known(b) - score(a, now) - known(a))[0];
    elements.push({ type: 'confirm', item: itemView(it, lang), person: person(it.personId), left: Math.min(pending.length, MAX_DECISIONS_PER_DAY - decidedToday) });
  }

  // 2. The next occasion within 14 days (birthday or dated item), else someone you will see soon
  const occasions = [];
  for (const p of Object.values(people)) {
    if (p.status !== 'confirmed') continue;
    const b = nextBirthday(p.birthday, today);
    if (b) occasions.push({ personId: p.id, date: b, kind: 'birthday' });
  }
  for (const i of items) {
    if (i.status !== 'confirmed' || i.kind !== 'date' || !i.eventDate) continue;
    if (i.dateKind === 'birthday' && people[i.personId]?.birthday) continue;
    const d = i.dateKind === 'birthday' || i.dateKind === 'anniversary' ? nextBirthday(i.eventDate.slice(5), today) : i.eventDate;
    occasions.push({ personId: i.personId, date: d, kind: i.dateKind || 'other', itemId: i.id });
  }
  const soon = occasions.map((o) => ({ ...o, daysLeft: daysBetween(today, o.date) }))
    .filter((o) => o.daysLeft >= 0 && o.daysLeft <= OCCASION_WINDOW_DAYS && alive(people[o.personId]))
    .sort((a, b) => a.daysLeft - b.daysLeft);
  if (soon.length) {
    const o = soon[0];
    const evidence = items.filter((i) => i.personId === o.personId && i.status === 'confirmed' && ['wish', 'like'].includes(i.kind))
      .sort((a, b) => (b.kind === 'wish') - (a.kind === 'wish') || (b.mentions || 1) - (a.mentions || 1) || (b.lastSaidAt || b.saidAt) - (a.lastSaidAt || a.saidAt));
    // Gifts come from what the person WISHED first, then from what they love; same for a thing to do together.
    const gift = evidence.find((i) => i.giftQuery);
    const exp = evidence.find((i) => i.experienceQuery);
    elements.push({
      type: 'occasion', person: person(o.personId), date: o.date, daysLeft: o.daysLeft, kind: o.kind,
      evidence: evidence.slice(0, 3).map((i) => itemView(i, lang)),
      // No product idea but something to do? A kit or a gift card for that activity is the natural gift.
      giftQuery: gift?.giftQuery || (exp?.experienceQuery ? `${exp.experienceQuery} gift` : null), experienceQuery: exp?.experienceQuery || null,
      giftFrom: gift?.id || null, experienceFrom: exp?.id || null,
    });
  } else {
    const plans = items.filter((i) => i.kind === 'plan' && i.status === 'confirmed' && i.eventDate && alive(people[i.personId]))
      .map((i) => ({ i, d: daysBetween(today, i.eventDate) })).filter((x) => x.d >= 0 && x.d <= 3).sort((a, b) => a.d - b.d);
    if (plans.length) {
      const { i, d } = plans[0];
      const news = items.filter((x) => x.personId === i.personId && x.status === 'confirmed' && ['life', 'like', 'wish'].includes(x.kind))
        .sort((a, b) => (b.kind === 'life') - (a.kind === 'life') || (b.lastSaidAt || b.saidAt) - (a.lastSaidAt || a.saidAt));
      elements.push({ type: 'see', person: person(i.personId), date: i.eventDate, daysLeft: d, plan: itemView(i, lang), evidence: news.slice(0, 2).map((x) => itemView(x, lang)) });
    }
  }

  // 3. One promise to keep (said by the owner himself, confirmed, not done)
  const promises = items.filter((i) => i.kind === 'promise' && i.status === 'confirmed' && alive(people[i.personId]))
    .sort((a, b) => a.saidAt - b.saidAt);
  if (promises.length) {
    const it = promises[0];
    elements.push({ type: 'promise', item: itemView(it, lang), person: person(it.personId), reminder: state.nudges.find((n) => n.itemId === it.id && n.status === 'planned') || null });
  }

  return {
    day: today,
    elements,
    revealed: typeof state.reveals?.[today] === 'number' && now - state.reveals[today] < REVEAL_MS,
    counts: {
      people: Object.values(people).filter((p) => p.status === 'confirmed').length,
      kept: items.filter((i) => i.status === 'confirmed').length,
      pending: pending.length,
    },
  };
}
