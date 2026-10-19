#!/usr/bin/env node
// thoughtful serve [--sample] [--host 0.0.0.0] [--port 4317] [--no-sync]
// thoughtful sync [--sample]       read Bee once, extract, print counts (never the content)
// thoughtful doctor                check Bee CLI, Bedrock profile, keys (prints yes/no only)
import os from 'node:os';
import { config } from '../src/config.mjs';
import { createContext } from '../src/app.mjs';
import { createServer } from '../src/server.mjs';
import { keysStatus } from '../src/lookups.mjs';
import { checkAwsCredentials } from '../src/extract/bedrock.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith('--') ? args.shift() : 'serve';
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const ctx = createContext({ mode: flag('--sample') ? 'sample' : undefined });

async function doctor() {
  const live = ctx.open('live');
  const ok = await live.source.isConnected().catch(() => false);
  const keys = await keysStatus();
  console.log(`Bee CLI signed in ........ ${ok ? 'yes' : 'no (run: npx bee login)'}`);
  const aws = await checkAwsCredentials();
  console.log(`AWS profile .............. ${aws.profile} · credentials ${aws.ok ? 'yes' : 'no (aws sso login, or thoughtful config aws-profile <name>)'} · model ${config.model}`);
  console.log(`Channel3 key in Keychain . ${keys.channel3 ? 'yes' : 'no (scripts/set-channel3-local.sh)'}`);
  console.log(`Places key in Keychain ... ${keys.places ? 'yes' : 'no (scripts/set-places-local.sh)'}`);
  console.log(`Private data folder ...... ${config.dataDir.replace(os.homedir(), '~')}`);
}

if (cmd === 'doctor') { await doctor(); process.exit(0); }

// thoughtful config aws-profile <name>   (saved in the private data folder, used when no env variable is set)
if (cmd === 'config') {
  const [key, value] = args;
  if (key !== 'aws-profile' || !value) { console.log('usage: thoughtful config aws-profile <name>'); process.exit(2); }
  const f = path.join(config.dataDir, 'prefs.json');
  let prefs = {}; try { prefs = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(f, JSON.stringify({ ...prefs, awsProfile: value }), { mode: 0o600 });
  console.log(`AWS profile for Thoughtful: ${value}`);
  process.exit(0);
}

if (cmd === 'sync') {
  if (ctx.mode === 'sample') await ctx.ensureSampleSeed();
  const n = Number(opt('--reprocess-last', 0)) || 0;
  const r = await ctx.sync({ reprocessLast: n });
  if (!r.ok) { console.error('Could not read Bee:', r.error); process.exit(1); }
  for (const d of r.conversations || []) console.log(`  conversation …${d.id}: ${d.chars} chars, ${d.windows} window(s)${d.windowsSkipped ? ` (+${d.windowsSkipped} over the cap)` : ''}, raw ${d.raw}, kept ${d.kept}, new ${d.added}, parse errors ${d.parseErrors}, rejected ${JSON.stringify(d.rejected)}, kinds ${JSON.stringify(d.kinds)}`);
  const card = ctx.tonight();
  console.log(`Read ${r.read} conversation(s), ${r.notes + r.facts} new note(s), set aside: ${JSON.stringify(r.setAside)}, skipped: ${JSON.stringify(r.skipped)}`);
  console.log(`Tonight: ${card.elements.map((e) => e.type).join(', ') || 'nothing'} · ${card.counts.people} people · ${card.counts.kept} kept · ${card.counts.pending} to confirm`);
  process.exit(0);
}

const host = opt('--host', config.host);
const port = Number(opt('--port', config.port));
if (ctx.mode === 'sample') await ctx.ensureSampleSeed();
const srv = createServer(ctx, { host, port, dataDir: config.dataDir });
const { port: p, token } = await srv.listen();
console.log(`Thoughtful is running (${ctx.mode === 'sample' ? 'sample household, invented data' : 'your Bee'}).`);
console.log(`  App on this Mac:   http://127.0.0.1:${p}/`);
console.log(`  MCP endpoint:      http://127.0.0.1:${p}/mcp`);
if (token) {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  for (const ip of ips) console.log(`  iPhone (pair once): http://${ip}:${p}/?pair=${token}`);
}

// Background loops: read Bee every few minutes, send due reminders every minute, keep the live stream open.
const live = !flag('--no-sync');
const loop = async () => {
  if (ctx.current.store.state.settings.paused) return;
  if (ctx.mode === 'live' && !ctx.current.store.state.settings.consent) return;
  if (ctx.mode === 'live') ctx.current.engine.startStream();
  try { await ctx.current.engine.sync(); } catch (e) { console.error('[sync]', String(e?.message || e).slice(0, 160)); }
};
if (live) {
  setTimeout(loop, 1500);
  setInterval(loop, config.syncEveryMs).unref();
  // Every minute: send due reminders; and at the evening card time (default 20:05, right after Bee's 8 PM
  // summary) read Bee once more so tonight's card holds the whole day.
  let ritualDone = null;
  setInterval(() => {
    ctx.current.engine.tick().catch(() => {});
    const st = ctx.current.store.state.settings;
    const tz = st.timezone || 'Europe/Paris';
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    if (hm >= (st.ritualTime || '20:05') && ritualDone !== day) { ritualDone = day; loop(); }
  }, 60_000).unref();
  if (ctx.mode === 'live') ctx.current.engine.startStream();
}
const stop = async () => { ctx.current.engine.stop(); await srv.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
