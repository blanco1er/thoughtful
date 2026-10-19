// Deterministic guards applied to EVERY extracted item, whatever produced it (Bedrock or rules).
// The model proposes; this code decides. An item that fails a guard is dropped, never shown.

export const KINDS = ['like', 'wish', 'life', 'promise', 'date', 'plan'];
export const MIN_CONFIDENCE = 0.6;

// Topics Thoughtful never brings back on its own (R7): health, conflicts, politics, religion, other people's money,
// intimacy. Bilingual EN/FR word stems, matched on word starts.
const SENSITIVE = [
  // health
  'sick', 'illness', 'ill ', 'disease', 'cancer', 'tumor', 'tumour', 'hospital', 'surgery', 'doctor', 'diagnos', 'therapy', 'therapist', 'depress', 'anxiety', 'pregnan', 'miscarriage', 'medication', 'pills', 'chemo', 'rehab', 'addiction', 'drug addict', 'alcoholi', 'suicid', 'died', 'funeral', 'grief',
  'malade', 'maladie', 'hôpital', 'hopital', 'chirurgi', 'médecin', 'medecin', 'diagnost', 'thérap', 'therap', 'dépress', 'depress', 'angoiss', 'enceinte', 'grossesse', 'fausse couche', 'médicament', 'medicament', 'cancer', 'décéd', 'deced', 'enterrement', 'obsèques', 'obseques', 'deuil',
  // conflicts, intimacy
  'divorce', 'breakup', 'break up', 'broke up', 'cheating', 'affair', 'fight', 'argument', 'angry at', 'lawsuit', 'custody', 'sex ', 'sexual', 'dating app',
  'divorc', 'rupture', 'séparé', 'separe', 'tromp', 'dispute', 'engueul', 'fâché', 'fache', 'procès', 'proces', 'garde des enfants', 'sexe',
  // politics, religion
  'vote', 'election', 'messe', 'mass on sunday', 'élection', 'politic', 'politique', 'republican', 'democrat', 'parti ', 'religio', 'church', 'église', 'eglise', 'mosque', 'mosquée', 'synagog', 'pray', 'prière', 'priere',
  // other people's money
  'debt', 'loan', 'salary', 'mortgage', 'bankrupt', 'owes', 'dette', 'pret bancaire', 'salaire', 'credit immo', 'faillite', 'chomage', 'unemploy', 'got fired', 'licenci',
];

// Things that sound like TV, a podcast or a video playing near the watch (Bee hears them too).
// Item level: only strong signals (a like such as "she loves Ghibli films" must survive). The model also flags
// media per item, and whole conversations that sound like a broadcast are skipped upstream (sync.mjs).
const MEDIA = ['like and subscribe', 'subscribe to', 'abonnez vous', 'sponsored by', 'this episode', 'cet episode', 'this video', 'cette video', 'commercial break'];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

const flat = (s) => norm(s).replace(/'/g, ' ');
const startsWord = (n, w) => { const k = flat(w); return k && n.includes(' ' + k + (w.endsWith(' ') ? ' ' : '')); };
export function isSensitive(...texts) {
  const n = ' ' + flat(texts.join(' ')) + ' ';
  return SENSITIVE.some((w) => startsWord(n, w));
}

export function looksLikeMedia(...texts) {
  const n = ' ' + flat(texts.join(' ')) + ' ';
  return MEDIA.some((w) => startsWord(n, w));
}

// The quote must really be in what Bee heard (anti-hallucination). We accept small transcription noise:
// at least 80 % of the quote's words must appear, in order, inside one window of the transcript.
export function quoteIsGrounded(quote, transcriptText) {
  const q = norm(quote).split(' ').filter(Boolean);
  if (q.length < 3) return false;
  const t = norm(transcriptText).split(' ');
  if (norm(transcriptText).includes(q.join(' '))) return true;
  const need = Math.ceil(q.length * 0.8);
  const span = q.length * 2;
  const heads = new Set(q.slice(0, 3));
  // Longest common subsequence between the quote and a window of the transcript (words may be added or missing).
  const lcs = (w) => {
    const prev = new Array(w.length + 1).fill(0);
    for (const a of q) {
      let diag = 0;
      for (let j = 1; j <= w.length; j++) { const keep = prev[j]; prev[j] = a === w[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1]); diag = keep; }
    }
    return prev[w.length];
  };
  for (let i = 0; i < t.length; i++) {
    if (!heads.has(t[i])) continue;
    if (lcs(t.slice(i, i + span)) >= need) return true;
  }
  return false;
}

// Which utterance does the quote come from? Returns the speaker label of the best overlapping utterance.
export function speakerOfQuote(quote, utterances, ownerName) {
  const q = new Set(norm(quote).split(' ').filter((w) => w.length > 2));
  let best = null, score = 0;
  for (const u of utterances || []) {
    const words = norm(u.text).split(' ');
    const s = words.filter((w) => q.has(w)).length;
    if (s > score) { score = s; best = u; }
  }
  if (!best) return 'unknown';
  return isOwner(best.speaker, ownerName) ? 'owner' : best.speaker && best.speaker !== 'Unknown' ? 'other' : 'unknown';
}

export const isOwner = (speaker, ownerName) => !!ownerName && norm(speaker) === norm(ownerName);

// Search phrases go to Channel3 / Google Places: no places ("near her place"), no questions, no names.
export function cleanQuery(q) {
  if (!q) return null;
  let s = String(q).replace(/\?.*$/, '').replace(/\b(near|close to|around|in her|in his|pr[eè]s de|à côté de|chez)\b.*$/i, '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
  if (/^(what|which|could|would|how|quel|quelle)\b/i.test(s) || s.split(' ').length > 8) return null;
  return s ? s.slice(0, 60) : null;
}

export function clampDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  const d = new Date(s + 'T12:00:00Z');
  return Number.isNaN(d.getTime()) ? null : String(s);
}

/**
 * Validate and clean model output. Returns { kept, dropped } where dropped items carry a reason
 * (counted in the activity log, never shown with their text).
 */
export function guardItems(rawItems, { transcriptText, utterances, ownerName, sourceKind = 'conversation' }) {
  const kept = [], dropped = [];
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    const it = {
      person: String(raw.person || '').trim().slice(0, 40),
      relation: String(raw.relation || '').trim().slice(0, 30),
      kind: KINDS.includes(raw.kind) ? raw.kind : null,
      textEn: String(raw.text_en || raw.text || '').trim().slice(0, 160),
      textFr: String(raw.text_fr || '').trim().slice(0, 180),
      quote: String(raw.quote || '').trim().slice(0, 220),
      eventDate: clampDate(raw.event_date),
      dateKind: ['birthday', 'anniversary', 'other'].includes(raw.date_kind) ? raw.date_kind : null,
      giftQuery: cleanQuery(raw.gift_query),
      experienceQuery: cleanQuery(raw.experience_query),
      confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
      beeFactId: raw.bee_fact_id ?? null,
    };
    const why = (r) => dropped.push({ reason: r, kind: it.kind });
    if (!it.kind || !it.textEn) { why('malformed'); continue; }
    if (!it.person) { why('no_person'); continue; }
    if (raw.sensitive === true || isSensitive(it.textEn, it.textFr, it.quote)) { why('sensitive'); continue; }
    if (raw.media === true || looksLikeMedia(it.quote, it.textEn)) { why('media'); continue; }
    if (it.confidence < MIN_CONFIDENCE) { why('low_confidence'); continue; }
    if (sourceKind === 'conversation') {
      if (!quoteIsGrounded(it.quote, transcriptText)) { why('quote_not_found'); continue; }
      const who = speakerOfQuote(it.quote, utterances, ownerName);
      it.speaker = who;
      // A promise is only a promise if the owner said it himself (Bee speaker identification).
      if (it.kind === 'promise' && who !== 'owner') { why('promise_not_owner'); continue; }
    } else {
      it.speaker = 'bee';
    }
    if (it.person && ownerName && norm(it.person) === norm(ownerName)) { why('about_owner'); continue; }
    kept.push(it);
  }
  return { kept, dropped };
}
