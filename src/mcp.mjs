// Thoughtful as an MCP server (Streamable HTTP, protocol 2025-11-25, stateless, JSON responses) with an MCP Apps
// card for the evening ritual on an Echo Show (ui://thoughtful/tonight-<hash>.html).
// Each tool answer: content[0] = the sentence a voice assistant can say (never an id, never a gift on a shared
// device), content[1] = data for the assistant (ids), not to be read aloud.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { STRINGS, t, rel } from './i18n.mjs';

export const SERVER_INFO = { name: 'thoughtful', title: 'Thoughtful', version: '0.1.0' };
export const MCP_APP_MIME = 'text/html;profile=mcp-app';
const UI_EXTENSION = 'io.modelcontextprotocol/ui';
const INSTRUCTIONS = `Thoughtful keeps a private notebook about the people the user loves, built from what their Bee wearable heard.
Use tonight_card for the evening ritual ("what's on Thoughtful tonight?"). Use person_brief before the user sees someone.
Never read gift ideas aloud on a shared device: they are a surprise. Never buy anything. Ask before forgetting a note.`;

const CARD_SRC = new URL('./ui/tonight-card.html', import.meta.url);
let cardCache = null;
export function card(publicBase = '') {
  if (cardCache && cardCache.base === publicBase) return cardCache;
  const dict = { en: pickCardStrings('en'), fr: pickCardStrings('fr') };
  const html = fs.readFileSync(CARD_SRC, 'utf8').replace('/*__STRINGS__*/{}', JSON.stringify(dict)).replace('/*__REL__*/{}', JSON.stringify(relTable())).replace('__IMG_BASE__', publicBase);
  const hash = crypto.createHash('sha256').update(html).digest('hex').slice(0, 8);
  cardCache = { base: publicBase, html, uri: `ui://thoughtful/tonight-${hash}.html` };
  return cardCache;
}
function relTable() {
  const keys = ['sister', 'little sister', 'brother', 'friend', 'best friend', 'mother', 'father', 'grandmother', 'grandfather', 'colleague', 'partner', 'wife', 'husband', 'son', 'daughter', 'cousin', 'aunt', 'uncle', 'neighbour', 'neighbor'];
  return Object.fromEntries(keys.map((k) => [k, rel('fr', k)]));
}
function pickCardStrings(lang) {
  const out = {};
  for (const k of Object.keys(STRINGS.en)) if (/^(tonight|confirm|occasion|see|promise|kind|when|date|app|place)\./.test(k)) out[k] = STRINGS[lang][k] ?? STRINGS.en[k];
  return out;
}

const fmtDay = (d, lang) => new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));

/** The sentence an assistant says for tonight's card. Never mentions a gift or a quote (the room may not be private). */
export function spokenTonight(card, lang = 'en') {
  const fr = lang === 'fr';
  const parts = [];
  for (const e of card.elements) {
    if (e.type === 'confirm') parts.push(fr ? `une note sur ${e.person.name} à confirmer` : `a note about ${e.person.name} to confirm`);
    if (e.type === 'occasion') parts.push(e.daysLeft === 0 ? (fr ? `c'est l'anniversaire de ${e.person.name} aujourd'hui` : `it's ${e.person.name}'s birthday today`) : fr ? `l'anniversaire de ${e.person.name} dans ${e.daysLeft} jours` : `${e.person.name}'s birthday in ${e.daysLeft} days`);
    if (e.type === 'see') parts.push(fr ? `vous voyez ${e.person.name} ${e.daysLeft === 0 ? "aujourd'hui" : e.daysLeft === 1 ? 'demain' : `dans ${e.daysLeft} jours`}` : `you see ${e.person.name} ${e.daysLeft === 0 ? 'today' : e.daysLeft === 1 ? 'tomorrow' : `in ${e.daysLeft} days`}`);
    if (e.type === 'promise') parts.push(fr ? `une promesse à ${e.person.name}` : `a promise to ${e.person.name}`);
  }
  if (!parts.length) return fr ? "Rien ce soir. Je vous dirai quand quelque chose en vaudra la peine." : "Nothing tonight. I'll tell you when something is worth it.";
  const list = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + (fr ? ' et ' : ', and ') + parts[parts.length - 1];
  const n = parts.length;
  return (fr ? `${n === 1 ? 'Une chose' : n === 2 ? 'Deux choses' : 'Trois choses'} ce soir : ${list}.` : `${n === 1 ? 'One thing' : n === 2 ? 'Two things' : 'Three things'} tonight: ${list}.`).replace(/^./, (c) => c.toUpperCase());
}

const say = (text, data) => ({ content: [{ type: 'text', text }, ...(data ? [{ type: 'text', text: 'Assistant data (do not read aloud): ' + JSON.stringify(data) }] : [])] });

export function createMcpServer(ctx, { publicBase = '' } = {}) {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, extensions: { [UI_EXTENSION]: {} } },
    instructions: INSTRUCTIONS,
  });
  const c = card(publicBase);
  const uiMeta = { ui: { csp: publicBase ? { resourceDomains: [publicBase] } : {}, prefersBorder: false } };
  server.registerResource('tonight-card', c.uri, { title: "Tonight's card", description: 'Thoughtful evening card (MCP App view): at most three things, surprises hidden until "Show".', mimeType: MCP_APP_MIME, _meta: uiMeta },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: MCP_APP_MIME, text: c.html, _meta: uiMeta }] }));

  const lang = () => ctx.current.store.state.settings.lang || 'en';
  const withCard = (r, structured) => ({ ...r, structuredContent: structured, _meta: { ui: { resourceUri: c.uri } } });
  const cardPayload = () => {
    const tn = ctx.tonight();
    return { kind: 'tonight', lang: lang(), mode: ctx.mode, card: tn };
  };

  server.registerTool('tonight_card', {
    title: "Tonight's card",
    description: 'Show tonight\'s Thoughtful card: at most three things about the people the user loves (one note to confirm, an occasion coming up or someone they will see, one promise). Use for "what\'s on Thoughtful tonight", "anything about my family tonight".',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: c.uri, invoking: 'Opening tonight’s card…', invoked: 'Tonight’s card' } },
  }, async () => {
    const p = cardPayload();
    const ids = p.card.elements.map((e) => ({ type: e.type, note_id: e.item?.id, person: e.person?.name }));
    return withCard(say(spokenTonight(p.card, lang()), { elements: ids }), p);
  });

  server.registerTool('answer_note', {
    title: 'Keep or set aside a note',
    description: 'Record the user\'s answer to "did Bee hear this right?" for one note: yes keeps it (and saves it to Bee as a confirmed fact), no sets it aside forever. Only call after the user answered.',
    inputSchema: { note_id: z.string().describe('note_id from tonight_card'), answer: z.enum(['yes', 'no']).describe('the user\'s answer') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    _meta: { ui: { resourceUri: c.uri } },
  }, async ({ note_id, answer }) => {
    const fr = lang() === 'fr';
    try {
      const r = answer === 'yes' ? await ctx.confirm(note_id) : ctx.reject(note_id);
      const text = answer === 'yes' ? (fr ? `C'est noté${r.bee === 'wrote_bee_fact' || r.bee === 'confirmed_bee_fact' ? ', et enregistré dans Bee' : ''}.` : `Kept${r.bee === 'wrote_bee_fact' || r.bee === 'confirmed_bee_fact' ? ', and saved to Bee' : ''}.`) : (fr ? 'Mis de côté. Je ne l\'utiliserai pas.' : "Set aside. I won't use it.");
      return withCard(say(text, { note_id, answer }), cardPayload());
    } catch {
      return { isError: true, ...say(fr ? 'Je ne trouve plus cette note. Rien n\'a changé.' : "I can't find that note anymore. Nothing changed.") };
    }
  });

  server.registerTool('remind_me', {
    title: 'Remind me later',
    description: 'Plan one quiet reminder about a note (a promise or an occasion). It reaches the user\'s phone and watch through Bee, at 9 AM, never during a conversation.',
    inputSchema: { note_id: z.string().describe('note_id from tonight_card (the promise or the occasion note)'), when: z.enum(['tomorrow_morning', 'in_3_days']).default('tomorrow_morning').describe('tomorrow_morning (tomorrow at 9, "tomorrow", "in the morning") or in_3_days ("in three days", "later this week")') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    _meta: { ui: { resourceUri: c.uri } },
  }, async ({ note_id, when }) => {
    const fr = lang() === 'fr';
    try {
      ctx.remind(note_id, when === 'in_3_days' ? 'in3days' : 'tomorrow9');
      const text = when === 'in_3_days' ? (fr ? 'Je vous le rappelle dans trois jours, à 9 heures.' : "I'll remind you in three days, at 9 AM.") : (fr ? 'Je vous le rappelle demain à 9 heures, sur votre téléphone et votre montre.' : "I'll remind you tomorrow at 9 AM, on your phone and watch.");
      return withCard(say(text, { note_id, when }), cardPayload());
    } catch {
      return { isError: true, ...say(fr ? 'Je ne trouve plus cette note.' : "I can't find that note anymore.") };
    }
  });

  server.registerTool('mark_done', {
    title: 'Mark a promise as done',
    description: 'Mark a promise the user kept as done. It leaves the evening card and any planned reminder is cancelled.',
    inputSchema: { note_id: z.string().describe('note_id of the promise, from tonight_card ("I did it", "done", "c\'est fait")') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: c.uri } },
  }, async ({ note_id }) => {
    const fr = lang() === 'fr';
    try { ctx.done(note_id); return withCard(say(fr ? 'Bravo, c\'est fait.' : 'Nice. Done.'), cardPayload()); }
    catch { return { isError: true, ...say(fr ? 'Je ne trouve plus cette promesse.' : "I can't find that promise anymore.") }; }
  });

  server.registerTool('person_brief', {
    title: 'Before you see someone',
    description: 'What the user should remember about one person before seeing them: confirmed notes only (news in their life, what they love, what the user promised). Use for "what should I remember about Theo before dinner?".',
    inputSchema: { name: z.string().describe('first name or relation, e.g. "Theo", "my sister"') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ name }) => {
    const fr = lang() === 'fr';
    const p = ctx.findPersonByName(String(name).replace(/^(my|ma|mon)\s+/i, ''));
    if (!p) return say(fr ? `Je n'ai encore rien gardé sur ${name}.` : `I haven't kept anything about ${name} yet.`);
    const v = ctx.person(p.id);
    const notes = v.notes.filter((n) => n.status === 'confirmed' && n.kind !== 'date').slice(0, 3);
    if (!notes.length) return say(fr ? `Rien de confirmé sur ${p.name} pour l'instant.` : `Nothing confirmed about ${p.name} yet.`);
    const lines = notes.map((n) => n.kind === 'promise' ? (fr ? `vous avez promis : ${n.text.toLowerCase()}` : `you promised: ${n.text.toLowerCase()}`) : n.text.charAt(0).toLowerCase() + n.text.slice(1));
    return say(`${p.name}: ${lines.join('; ')}.`, { person_id: p.id });
  });

  server.registerTool('gift_ideas', {
    title: 'Gift ideas (card only)',
    description: 'Real gift ideas and one place nearby for the occasion on tonight\'s card. Called by the card after the user tapped "Show". Never read aloud.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
    _meta: { ui: { resourceUri: c.uri, visibility: ['app'] } },
  }, async () => {
    const x = await ctx.extras('occasion');
    const proxied = (u) => (u && publicBase ? `${publicBase}/img?u=${encodeURIComponent(u)}` : u);
    const gifts = { ...x.gifts, products: (x.gifts.products || []).map((p) => ({ ...p, image: proxied(p.image) })) };
    // Voice-complete without spoiling the surprise: counts only, never a product or a place name.
    const n = gifts.products?.length || 0;
    const who = ctx.tonight().elements.find((e) => e.type === 'occasion')?.person?.name || '';
    const fr = lang() === 'fr';
    const text = n || x.place?.place
      ? (fr ? `${n ? `${n} idée${n > 1 ? 's' : ''} de cadeau pour ${who}` : `Une idée pour ${who}`}${x.place?.place ? ' et un lieu où aller ensemble' : ''}. Je ne les dis pas à voix haute, pour garder la surprise.` : `${n ? `${n} gift idea${n > 1 ? 's' : ''} for ${who}` : `An idea for ${who}`}${x.place?.place ? ', and a place to go together' : ''}. I won't say them out loud, to keep the surprise.`)
      : (fr ? `Pas encore d'idée de cadeau pour ${who}.` : `No gift idea for ${who} yet.`);
    return { content: [{ type: 'text', text }], structuredContent: { kind: 'extras', gifts, place: x.place } };
  });

  server.registerTool('reveal_card', {
    title: 'Show or hide surprises',
    description: 'Show or hide the surprise part of tonight\'s card on a shared screen. Called by the card buttons.',
    inputSchema: { show: z.boolean().describe('true to show the surprise part ("show", "afficher"), false to cover it again ("hide", "masquer")') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: c.uri, visibility: ['app'] } },
  }, async ({ show }) => {
    ctx.reveal(show);
    const fr = lang() === 'fr';
    const text = show
      ? (fr ? 'La surprise est visible sur cet écran pendant dix minutes, puis elle se cache toute seule.' : 'The surprise is visible on this screen for ten minutes, then it hides itself again.')
      : (fr ? 'La surprise est de nouveau cachée.' : 'The surprise is hidden again.');
    return withCard(say(text), cardPayload());
  });

  server.registerTool('forget_note', {
    title: 'Forget a note',
    description: 'Erase one note from the notebook (and from Bee if Thoughtful wrote it there). Ask the user to confirm first.',
    inputSchema: { note_id: z.string().describe('note_id of the note to erase ("forget that", "oublie ça")'), user_confirmed: z.boolean().describe('true only after the user explicitly said yes') },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async ({ note_id, user_confirmed }) => {
    const fr = lang() === 'fr';
    if (!user_confirmed) return say(fr ? 'Vous voulez vraiment que j\'oublie cette note ?' : 'Do you want me to forget this note for good?');
    try { await ctx.forget(note_id); return say(fr ? 'C\'est oublié.' : 'Forgotten.'); }
    catch { return { isError: true, ...say(fr ? 'Je ne trouve plus cette note.' : "I can't find that note anymore.") }; }
  });

  server.server.registerCapabilities({ tools: { listChanged: false }, resources: { listChanged: false } });
  return server;
}

/** Handle one MCP HTTP request (stateless: a fresh server + transport per request). */
export async function handleMcp(ctx, request, { publicBase } = {}) {
  const server = createMcpServer(ctx, { publicBase });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    queueMicrotask(() => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  }
}

export { t };
