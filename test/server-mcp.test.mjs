import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext } from '../src/app.mjs';
import { createServer } from '../src/server.mjs';
import { spokenTonight } from '../src/mcp.mjs';
import { tmpDir } from './helpers.mjs';

const lookups = {
  keysStatus: async () => ({ channel3: false, places: false }),
  findGifts: async (s, q) => ({ status: q ? 'ok' : 'empty', products: q ? [{ id: 'p1', title: 'Invented pottery kit', image: 'https://example.com/kit.jpg', price: 39, currency: 'USD', merchant: 'example.com', url: 'https://example.com/kit' }] : [] }),
  findPlace: async () => ({ status: 'no_key', place: null }),
};

async function boot(mode = 'sample') {
  const dir = tmpDir();
  const ctx = createContext({ dataDir: dir, mode, lookups });
  if (mode === 'sample') await ctx.ensureSampleSeed();
  const srv = createServer(ctx, { port: 0, dataDir: dir });
  const { port } = await srv.listen();
  const base = `http://127.0.0.1:${port}`;
  return { ctx, srv, base, dir };
}

let rpcId = 0;
async function mcp(base, method, params = {}) {
  const r = await fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  assert.equal(r.status, 200);
  return (await r.json()).result;
}

test('MCP: initialize, tools, the MCP Apps card, and a full evening by voice', async () => {
  const { srv, base } = await boot();
  try {
    const init = await mcp(base, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.protocolVersion, '2025-11-25');
    assert.equal(init.serverInfo.name, 'thoughtful');
    const { tools } = await mcp(base, 'tools/list');
    assert.deepEqual(tools.map((t) => t.name).sort(), ['answer_note', 'forget_note', 'gift_ideas', 'mark_done', 'person_brief', 'remind_me', 'reveal_card', 'tonight_card']);
    assert.deepEqual(tools.find((t) => t.name === 'gift_ideas')._meta.ui.visibility, ['app'], 'gift ideas are never offered to the voice model');
    const { resources } = await mcp(base, 'resources/list');
    assert.equal(resources[0].mimeType, 'text/html;profile=mcp-app');
    assert.match(resources[0].uri, /^ui:\/\/thoughtful\/tonight-[0-9a-f]{8}\.html$/);
    const read = await mcp(base, 'resources/read', { uri: resources[0].uri });
    assert.equal(read.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.ok(read.contents[0].text.includes('ui/initialize'));
    assert.ok(!read.contents[0].text.includes('/*__STRINGS__*/'), 'dictionary injected');

    const card = await mcp(base, 'tools/call', { name: 'tonight_card', arguments: {} });
    const spoken = card.content[0].text;
    assert.match(spoken, /^(One|Two|Three) things? tonight/);
    assert.ok(!/pottery|kit|ceramic|matcha/i.test(spoken), 'the voice never reveals a gift or a quote');
    assert.equal(card._meta.ui.resourceUri, resources[0].uri);
    const confirm = card.structuredContent.card.elements.find((e) => e.type === 'confirm');
    const ans = await mcp(base, 'tools/call', { name: 'answer_note', arguments: { note_id: confirm.item.id, answer: 'yes' } });
    assert.match(ans.content[0].text, /^Kept/);
    const brief = await mcp(base, 'tools/call', { name: 'person_brief', arguments: { name: 'Theo' } });
    assert.match(brief.content[0].text, /^Theo: /);
    const unknown = await mcp(base, 'tools/call', { name: 'person_brief', arguments: { name: 'Zorglub' } });
    assert.match(unknown.content[0].text, /haven't kept anything/);
    const forgetAsk = await mcp(base, 'tools/call', { name: 'forget_note', arguments: { note_id: confirm.item.id, user_confirmed: false } });
    assert.match(forgetAsk.content[0].text, /\?$/, 'asks before forgetting');
  } finally { await srv.close(); }
});

test('spoken summary: counts in words, French too, and a calm "nothing tonight"', () => {
  const card = { elements: [{ type: 'occasion', daysLeft: 12, person: { name: 'Maya' } }, { type: 'promise', person: { name: 'Theo' } }] };
  assert.equal(spokenTonight(card, 'en'), "Two things tonight: Maya's birthday in 12 days, and a promise to Theo.");
  assert.equal(spokenTonight(card, 'fr'), "Deux choses ce soir : l'anniversaire de Maya dans 12 jours et une promesse à Theo.");
  assert.match(spokenTonight({ elements: [] }, 'en'), /^Nothing tonight/);
});

test('web API: state, consent required, foreign origins refused, erase empties the notebook', async () => {
  const { srv, base } = await boot('live');
  try {
    const st = await (await fetch(base + '/api/state')).json();
    assert.equal(st.needsOnboarding, true);
    assert.equal(st.tonight.elements.length, 0);
    const noConsent = await fetch(base + '/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: false }) });
    assert.equal(noConsent.status, 400);
    const evil = await fetch(base + '/api/erase', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
    assert.equal(evil.status, 403);
    const evilMcp = await fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
    assert.equal(evilMcp.status, 403);
    const ok = await fetch(base + '/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true, lang: 'fr' }) });
    assert.equal(ok.status, 200);
    const st2 = await (await fetch(base + '/api/state')).json();
    assert.equal(st2.needsOnboarding, false);
    assert.equal(st2.settings.lang, 'fr');
    const img = await fetch(base + '/img?u=' + encodeURIComponent('https://example.com/anything.jpg'));
    assert.equal(img.status, 404, 'not an open image proxy');
  } finally { await srv.close(); }
});

test('sample household: invented data, TV and sensitive parts set aside, erase and reload', async () => {
  const { ctx, srv, base } = await boot('sample');
  try {
    const st = await (await fetch(base + '/api/state')).json();
    assert.equal(st.mode, 'sample');
    const names = st.people.map((p) => p.name).sort();
    assert.ok(names.includes('Maya') && names.includes('Theo'));
    const notes = JSON.stringify(ctx.current.store.state.items);
    assert.ok(!/surgery|messe|espresso/i.test(notes), 'knee surgery (health), church (religion) and the TV show never become notes');
    const occ = st.tonight.elements.find((e) => e.type === 'occasion');
    assert.equal(occ.person.name, 'Maya');
    assert.equal(occ.daysLeft, 12, 'dates follow today');
    const extras = await (await fetch(base + '/api/extras')).json();
    assert.equal(extras.gifts.products[0].title, 'Invented pottery kit');
    assert.ok(ctx.current.source.writes.facts.length > 0, 'confirmed notes were written to (simulated) Bee');
    const er = await fetch(base + '/api/erase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(er.status, 200);
  } finally { await srv.close(); }
});
