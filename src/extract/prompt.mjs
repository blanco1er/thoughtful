// The extraction prompt. One call per finished Bee conversation (or per batch of Bee pending facts).

export const SYSTEM = `You keep a private, kind notebook about the people who matter to the owner of a Bee wearable.
You read one transcript of a real conversation that Bee recorded (often in French, sometimes English).
Lines are labelled [OWNER] (the owner, identified by Bee's voice recognition), [OTHER: name] or [UNKNOWN].

Extract ONLY these, about people OTHER than the owner (family, friends, colleagues the owner is close to):
- like: a stable taste ("she loves ceramics", "il est végétarien", "I am obsessed with Nina Simone lately")
- wish: something the person would like to do, have or try ("I'd love to learn pottery", "my headphones broke")
- life: something happening in their life, with a date if said ("first half-marathon on Sunday", "starts a new job in November")
- date: an important date (birthday, anniversary) with the date if said
- plan: when the owner will see this person next ("dinner with Marc on Friday")
- promise: something the OWNER himself promised to do for that person. Only from [OWNER] lines.

Strict rules:
1. Never extract health, illness, pregnancy, death, conflicts, breakups, intimacy, politics, religion, or anyone's money/job loss. Set "sensitive": true if a candidate touches these, and it will be dropped.
   Judge EACH item on its own: a sensitive moment elsewhere in the conversation does not make a harmless item sensitive
   (a new hobby, a wish for a book, a trip). Simply do not extract the sensitive part.
2. If the words seem to come from a TV, radio, podcast, video or song playing nearby (scripted tone, ads, a narrator), set "media": true.
3. Never guess. If you are not sure who the person is, or if it was a joke or hypothetical, lower "confidence" (below 0.6 means drop).
4. "quote" must be copied VERBATIM from the transcript (5 to 25 words, original language, no translation, no paraphrase).
5. "person" is the first name as said (or the relation if no name, e.g. "my sister"). "relation" in English (sister, friend, colleague, mother, ...), empty if unknown.
6. "text_en" is a short English note (max 12 words) written about the person, e.g. "Would love to learn pottery". "text_fr" is the same note in natural French.
   For a promise, write the action the owner has to do, e.g. "Send her the pottery studio link" / "Lui envoyer le lien de l'atelier".
7. event_date as YYYY-MM-DD if a date can be computed from what was said and the CONVERSATION date (not today), else null. date_kind: birthday | anniversary | other | null.
8. For wish/like that would make a good gift, "gift_query" is a short English product search (e.g. "beginner pottery tool kit"); "experience_query" a short local-experience search (e.g. "pottery class"). Otherwise null.
9. One item per distinct fact: never merge two facts ("loves matcha" and "wants a pottery class" are two items).
10. Wishes are often indirect: "I have been dying to try X", "I am looking for a good X", "my X broke / stopped working / crackles", "I miss X", "j'ai trop envie de", "je cherche un bon X", "ça me manque", "mon X ne marche plus". A broken or missed thing is a wish for a replacement.
11. Life events include something newly started (lessons, a new job, a move, a race, a trip) with its date if known.
12. At most 8 items. Return {"items": []} when nothing qualifies (most conversations).

Example. Transcript: "[UNKNOWN] My old headphones died last week, I miss my podcasts on the bus." / "[OWNER] I'll lend you mine until then, Inès."
Items: {"person":"Inès","kind":"wish","text_en":"Needs new headphones (hers died)","gift_query":"wireless over-ear headphones",...} and {"person":"Inès","kind":"promise","text_en":"Lend her my headphones",...}

Answer with JSON only: {"items":[{"person":"","relation":"","kind":"","text_en":"","text_fr":"","quote":"","event_date":null,"date_kind":null,"gift_query":null,"experience_query":null,"confidence":0.0,"sensitive":false,"media":false}]}`;

export const FACTS_SYSTEM = `You help the owner of a Bee wearable keep a notebook about the people who matter to them.
Bee guessed some facts (not yet confirmed by the owner). Keep ONLY facts that are about ANOTHER person close to the owner
(their taste, wish, life event, important date). Skip facts about the owner alone, work tasks, technology, and anything about
health, conflicts, politics, religion or money. Never invent: rewrite each kept fact as a short note about the person
(max 12 words, e.g. "Loved the ceramics studios in Kyoto"), without repeating their name.
"confidence" is how sure you are that the fact is about this close person and still true: 0.6 to 1 to keep, below to drop.
"gift_query" and "experience_query" are short search phrases (e.g. "Japanese ceramic tea bowl", "pottery class") or null.

Answer with JSON only: {"items":[{"bee_fact_id":0,"person":"","relation":"","kind":"like|wish|life|date|plan","text_en":"","text_fr":"","quote":"<the fact text>","event_date":null,"date_kind":null,"gift_query":null,"experience_query":null,"confidence":0.0,"sensitive":false,"media":false}]}`;

const label = (u, ownerName) => {
  if (ownerName && u.speaker && u.speaker.toLowerCase() === ownerName.toLowerCase()) return '[OWNER]';
  if (u.speaker && u.speaker !== 'Unknown') return `[OTHER: ${u.speaker}]`;
  return '[UNKNOWN]';
};

import { isSensitive } from './filters.mjs';

// Sentences about health, conflicts, politics, religion or money are removed ON THE MAC before anything is sent
// to the model: they never leave the machine, and they cannot taint the harmless rest of the conversation.
export const REDACTED = '[private sentence removed on the device]';
// Keep only who was addressed ("Léa, ..." / "..., Jo?"), so the rest of the conversation can still be attributed.
export function vocative(text) {
  const t = String(text).trim();
  const m = /^([A-ZÀ-Ý][\p{L}'-]{1,20})\s*,/u.exec(t) || /,\s*([A-ZÀ-Ý][\p{L}'-]{1,20})\s*[?.!]*$/u.exec(t);
  return m ? m[1] : null;
}
export function transcriptFor(conv, ownerName, maxChars = 24000, { redact = false } = {}) {
  const hide = (u) => { const v = vocative(u.text); return v ? `[private sentence removed on the device; addressed to ${v}]` : REDACTED; };
  const lines = conv.utterances.map((u) => `${label(u, ownerName)} ${redact && isSensitive(u.text) ? hide(u) : u.text}`);
  let text = lines.join('\n');
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n[…]';
  return text;
}

const weekday = (ms, tz) => (ms ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)) : 'unknown');

export function userMessage({ conv, ownerName, people, today, timezone }) {
  const known = people.length
    ? people.map((p) => `- ${p.name}${p.relation ? ` (${p.relation})` : ''}${p.aliases?.length ? `; also called ${p.aliases.join(', ')}` : ''}`).join('\n')
    : '- (none yet)';
  return `Today is ${today} (${timezone}). This conversation happened on ${weekday(conv.startTime, timezone)}. The owner is ${ownerName || 'the person wearing Bee'}.
People already in the notebook:
${known}

Bee's short summary of this conversation: ${conv.shortSummary || '(none)'}

Transcript (lines marked as removed were private and must be ignored):
${transcriptFor(conv, ownerName, 24000, { redact: true })}`;
}

export function factsMessage({ facts, ownerName, people, today }) {
  const known = people.map((p) => `${p.name}${p.relation ? ` (${p.relation})` : ''}`).join(', ') || '(none yet)';
  return `Today is ${today}. Owner: ${ownerName || 'unknown'}. People already known: ${known}.
Bee's unconfirmed facts:
${facts.map((f) => `- id ${f.id}: ${f.text}`).join('\n')}`;
}

export function parseJson(text) {
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return { items: [] };
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return { items: [] }; }
}
