#!/usr/bin/env node
// thoughtful serve [--sample] [--host 0.0.0.0] [--port 4317] [--no-sync]
// thoughtful sync [--sample]       read Bee once, extract, print counts (never the content)
// thoughtful doctor                check Bee CLI, Bedrock profile, keys (prints yes/no only)
import os from 'node:os';
import { config } from '../src/config.mjs';
import { createContext } from '../src/app.mjs';
import { createServer } from '../src/server.mjs';
import { keysStatus } from '../src/lookups.mjs';

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
  console.log(`AWS profile .............. ${process.env.AWS_PROFILE || '(default chain)'} · model ${config.model}`);
  console.log(`Channel3 key in Keychain . ${keys.channel3 ? 'yes' : 'no (scripts/set-channel3-local.sh)'}`);
  console.log(`Places key in Keychain ... ${keys.places ? 'yes' : 'no (scripts/set-places-local.sh)'}`);
  console.log(`Private data folder ...... ${config.dataDir.replace(os.homedir(), '~')}`);
}

if (cmd === 'doctor') { await doctor(); process.exit(0); }

if (cmd === 'sync') {
  if (ctx.mode === 'sample') await ctx.ensureSampleSeed();
  const r = await ctx.sync();
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
  setInterval(() => { ctx.current.engine.tick().catch(() => {}); }, 60_000).unref();
  if (ctx.mode === 'live') ctx.current.engine.startStream();
}
const stop = async () => { ctx.current.engine.stop(); await srv.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
