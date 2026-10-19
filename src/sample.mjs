// "Sample household": INVENTED people and conversations, clearly labelled in the app, so anyone can try the
// same product without a Bee account. Dates are rendered relative to today so the demo never goes stale.
// It implements the same interface as the live Bee source; writes are recorded in memory (shown as
// "would be written to Bee"), nothing leaves the machine.
import fs from 'node:fs';

const DAY = 86_400_000;
const TZ = 'America/New_York';
export const SAMPLE_OWNER = 'Sam';
export const SAMPLE_HOME_AREA = 'Brooklyn, New York';

const fmt = (ms, opts, locale = 'en-US') => new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts }).format(new Date(ms));
const dayStr = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

/** Replace {+12:md} (month day), {+2:wd} (weekday), {+12:fr} (French "1er novembre") relative to a base day. */
export function render(text, base) {
  return text.replace(/\{([+-]\d+):(md|wd|fr)\}/g, (_, off, kind) => {
    const t = base + Number(off) * DAY;
    if (kind === 'md') return fmt(t, { month: 'long', day: 'numeric' });
    if (kind === 'wd') return fmt(t, { weekday: 'long' });
    return fmt(t, { day: 'numeric', month: 'long' }, 'fr-FR');
  });
}

// Each conversation: days ago, hour, and lines. "Sam" is the owner (Bee recognises his voice); everyone else is
// "Unknown", exactly like on a real Bee account where only the owner has done voice training.
export const CONVERSATIONS = [
  { id: 9001, daysAgo: 5, hour: 20, summary: 'Dinner with Maya after her trip to Japan', lines: [
    ['Sam', 'Maya, little sis, tell me everything, how was Kyoto?'],
    ['Unknown', 'Honestly the best part was a tiny ceramics studio in Gion. I have been dying to try a pottery wheel class ever since.'],
    ['Sam', 'You should. There is a studio near your place, I will send you the link tomorrow.'],
    ['Unknown', 'Please do. And do not forget my birthday this year, it is on {+12:md}, so maybe brunch?'],
    ['Unknown', 'I am completely addicted to matcha now, I make one every morning with the bamboo whisk I brought back.'],
    ['Sam', 'You were already like that before Kyoto.'],
    ['Unknown', 'My knee surgery is next month though, so no running for a while.'],
  ] },
  { id: 9002, daysAgo: 3, hour: 18, summary: 'Call with Theo about running and records', lines: [
    ['Sam', 'Theo! Ready for the race?'],
    ['Unknown', 'Ready-ish. My first half-marathon is on {-1:wd}, twenty-one kilometres, I am terrified.'],
    ['Sam', 'You will be fine. How is the new turntable?'],
    ['Unknown', 'I love it. Now I am hunting for old Blue Note jazz records, the original pressings.'],
    ['Sam', 'Let us do dinner on {+2:wd} to celebrate. I will book that ramen place on Court Street.'],
    ['Unknown', 'Deal, you are on.'],
  ] },
  { id: 9003, daysAgo: 2, hour: 15, summary: 'Visite chez Mamie Rose', lines: [
    ['Sam', 'Mamie, ta radio marche toujours ?'],
    ['Unknown', "Non, elle grésille, je n'entends plus ma musique classique le matin, ça me manque beaucoup."],
    ['Sam', "Je t'apporte l'album photo du jardin dimanche prochain, promis."],
    ['Unknown', 'Oh oui, avec les photos des tomates de cet été !'],
    ['Unknown', "Et dis à ta sœur que je l'ai vue à la messe dimanche."],
  ] },
  { id: 9004, daysAgo: 1, hour: 21, summary: 'TV playing in the living room', lines: [
    ['Unknown', 'Tonight on the show, we test five espresso machines so you do not have to.'],
    ['Unknown', 'This episode is sponsored by our friends at a coffee subscription service.'],
    ['Unknown', 'Number one would love a little more pressure, but the crema is gorgeous.'],
    ['Unknown', 'Like and subscribe, and we will see you next week.'],
    ['Unknown', 'Coming up after the break, the best grinders under two hundred dollars.'],
  ] },
  { id: 9005, daysAgo: 0, hour: 9, summary: 'Coffee with Jonas from work', lines: [
    ['Unknown', 'I started Spanish lessons. I want to talk with my in-laws in Valencia by next summer.'],
    ['Sam', 'That is great, Jonas. I will lend you my Spanish podcast list.'],
    ['Unknown', 'You are a lifesaver. I have also been climbing twice a week at the bouldering gym.'],
    ['Sam', 'Nice, you should come to the Gowanus one with us.'],
  ] },
];

export const PENDING_FACTS = [
  { id: 7001, daysAgo: 5, text: "Sam's sister Maya recently travelled to Kyoto and loved its ceramics studios." },
  { id: 7002, daysAgo: 1, text: 'Sam is preparing a hackathon project.' },
];

export const CALENDAR = [{ offset: 2, hour: 19, minute: 30, title: 'Dinner with Theo', attendees: ['Theo'] }];

function atHour(base, daysAgo, hour) {
  // base = today 00:00 in TZ (approx); good enough for invented data
  return base - daysAgo * DAY + hour * 3600e3;
}

export function sampleToday(now = Date.now()) {
  const d = dayStr(now);
  // midnight in New York (UTC-4/-5); the offset error of one hour does not matter for invented data
  return Date.parse(d + 'T04:00:00Z');
}

export function createSampleSource({ now = () => Date.now() } = {}) {
  const writes = { facts: [], todos: [] };
  let nextFact = 80000, nextTodo = 90000;
  const base = () => sampleToday(now());
  const conv = (c) => {
    const start = atHour(base(), c.daysAgo, c.hour);
    return {
      id: c.id, state: 'COMPLETED', startTime: start, endTime: start + c.lines.length * 40_000, updatedAt: start + c.lines.length * 40_000 + 60_000,
      shortSummary: c.summary, summary: c.summary,
      utterances: c.lines.map(([speaker, text], i) => ({ id: c.id * 100 + i, speaker, text: render(text, base()), at: start + i * 40_000 })),
    };
  };
  return {
    kind: 'sample',
    writes,
    async me() { return { firstName: SAMPLE_OWNER, timezone: TZ }; },
    async isConnected() { return true; },
    async recentConversations(since) {
      return CONVERSATIONS.map(conv).filter((c) => c.startTime >= since && c.startTime <= now())
        .map(({ utterances, ...c }) => ({ ...c, utterancesCount: utterances.length }));
    },
    async conversation(id) { const c = CONVERSATIONS.find((x) => x.id === Number(id)); return c ? conv(c) : null; },
    async pendingFacts() { return PENDING_FACTS.map((f) => ({ id: f.id, text: f.text, tags: [], createdAt: base() - f.daysAgo * DAY + 22 * 3600e3, confirmed: false })); },
    async calendar() {
      return CALENDAR.map((e) => ({ title: e.title, attendees: e.attendees, start: base() + e.offset * DAY + (e.hour * 60 + e.minute) * 60_000, end: base() + e.offset * DAY + (e.hour * 60 + e.minute + 90) * 60_000 }));
    },
    async createFact(text) { const id = ++nextFact; writes.facts.push({ id, text, confirmed: false, at: now() }); return { id }; },
    async confirmFact(id) { const f = writes.facts.find((x) => x.id === id); if (f) f.confirmed = true; else writes.facts.push({ id, confirmed: true, bee: true, at: now() }); },
    async deleteFact(id) { const i = writes.facts.findIndex((x) => x.id === id); if (i >= 0) writes.facts.splice(i, 1); },
    async createTodo(text, alarmAt) { const id = ++nextTodo; writes.todos.push({ id, text, alarmAt, at: now() }); return { id }; },
    async completeTodo(id) { const t = writes.todos.find((x) => x.id === id); if (t) t.completed = true; },
  };
}

// ---------- recorded extraction (so the sample works without AWS) ----------
// scripts/record-sample.mjs runs the real Bedrock extractor once on the conversations above and saves its raw
// output here, with dates stored as offsets from the recording day. Replay shifts them to today.
const RECORDED = new URL('../sample/recorded-extraction.json', import.meta.url);

export function loadRecording() {
  try { return JSON.parse(fs.readFileSync(RECORDED, 'utf8')); } catch { return null; }
}

export function createReplayExtractor({ now = () => Date.now() } = {}) {
  const rec = loadRecording();
  const shift = (items) => (items || []).map((i) => {
    if (typeof i.event_offset_days !== 'number') return i;
    const { event_offset_days, ...rest } = i;
    return { ...rest, event_date: dayStr(sampleToday(now()) + event_offset_days * DAY + 12 * 3600e3) };
  });
  return {
    name: 'replay',
    recordedWith: rec?.modelId || null,
    recordedOn: rec?.recordedOn || null,
    async conversation({ conv }) { return { items: shift(rec?.conversations?.[conv.id]) }; },
    async facts() { return { items: shift(rec?.facts) }; },
  };
}

export const recordingPath = RECORDED;
export { dayStr as sampleDayStr };
