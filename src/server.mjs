// Local HTTP server: the iPhone web app, its JSON API, the MCP endpoint (/mcp) and a tiny image proxy for the
// Echo Show card. Listens on 127.0.0.1 by default. To open it from an iPhone (same Wi-Fi or Tailscale), start it
// with --host 0.0.0.0: every request then needs the pairing token printed at start (kept as a cookie).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { handleMcp } from './mcp.mjs';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const I18N = fileURLToPath(new URL('./i18n.mjs', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const isLoopback = (h) => ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1'].includes(h);

function pairingToken(dataDir) {
  const f = path.join(dataDir, 'pairing-token');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch {}
  const t = crypto.randomBytes(18).toString('base64url');
  fs.writeFileSync(f, t, { mode: 0o600 });
  return t;
}

async function readJson(req, max = 64 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error('too_large'), { status: 413 }); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('bad_json'), { status: 400 }); }
}

const send = (res, status, body, headers = {}) => {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': isBuf || typeof body === 'string' ? headers['Content-Type'] || 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...headers });
  res.end(data);
};

export function createServer(ctx, { host = '127.0.0.1', port = 4317, dataDir } = {}) {
  const lan = !isLoopback(host);
  const token = lan ? pairingToken(dataDir) : null;
  let publicBase = `http://127.0.0.1:${port}`;

  const authorized = (req, url) => {
    if (!lan) return true;
    if (isLoopback(req.socket.remoteAddress)) return true;
    const cookie = /(?:^|;\s*)thoughtful=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    return cookie === token || url.searchParams.get('pair') === token;
  };
  // Browser writes must come from this app's own page (no cross-site requests to a local server).
  const sameOrigin = (req) => {
    const o = req.headers.origin;
    if (!o) return true;
    try { return new URL(o).host === req.headers.host; } catch { return false; }
  };

  const routes = async (req, res, url) => {
    const p = url.pathname;
    const m = req.method;
    if (p === '/api/state' && m === 'GET') return send(res, 200, await ctx.summary());
    if (p === '/api/week' && m === 'GET') return send(res, 200, ctx.week());
    if (p === '/api/extras' && m === 'GET') return send(res, 200, await ctx.extras(url.searchParams.get('kind') || 'occasion'));
    if (p.startsWith('/api/people/') && m === 'GET') {
      // A link to someone who was forgotten is not an error: the app goes back to the list (UB-43).
      try { return send(res, 200, ctx.person(decodeURIComponent(p.split('/')[3]))); } catch (e) { if (e.status === 404) return send(res, 200, { notFound: true }); throw e; }
    }
    if (m !== 'POST') return null;
    if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden_origin' });
    const body = await readJson(req);
    let r;
    const [, , a, id, action] = p.split('/');
    if (a === 'onboarding') r = ctx.onboard(body);
    else if (a === 'settings') r = ctx.settings(body);
    else if (a === 'mode') { ctx.setMode(body.mode); if (body.mode === 'sample') await ctx.ensureSampleSeed(); r = { ok: true }; }
    else if (a === 'sync') r = await ctx.sync();
    else if (a === 'reveal') r = ctx.reveal(body.show !== false);
    else if (a === 'erase') r = await ctx.erase({ alsoBee: body.alsoBee !== false });
    else if (a === 'items' && id) {
      const iid = decodeURIComponent(id);
      if (action === 'confirm') r = await ctx.confirm(iid);
      else if (action === 'reject') r = ctx.reject(iid);
      else if (action === 'forget') r = await ctx.forget(iid);
      else if (action === 'done') r = ctx.done(iid);
      else if (action === 'remind') r = ctx.remind(iid, body.when);
    } else if (a === 'people' && id) {
      const pid = decodeURIComponent(id);
      if (action === 'forget') r = await ctx.forgetPerson(pid);
      else r = ctx.updatePerson(pid, body);
    }
    if (!r) return send(res, 404, { error: 'not_found' });
    return send(res, 200, r);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      if (!authorized(req, url)) return send(res, 401, 'Open the pairing link printed by Thoughtful on your Mac.');
      if (lan && url.searchParams.get('pair') === token) res.setHeader('Set-Cookie', `thoughtful=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
      if (url.pathname === '/mcp') {
        // MCP clients (mcp-voice-host, Claude, an Alexa+ add-on bridge) talk Streamable HTTP here.
        if (req.headers.origin && !sameOrigin(req) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin)) return send(res, 403, { error: 'forbidden_origin' });
        const body = ['POST', 'PUT'].includes(req.method) ? Buffer.concat(await (async () => { const a = []; for await (const c of req) a.push(c); return a; })()) : undefined;
        const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'), body });
        const r = await handleMcp(ctx, request, { publicBase });
        const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
        res.writeHead(r.status, headers);
        return res.end(Buffer.from(await r.arrayBuffer()));
      }
      if (url.pathname === '/img') return proxyImage(ctx, url, res);
      if (url.pathname === '/healthz') return send(res, 200, { ok: true, mode: ctx.mode });
      if (url.pathname.startsWith('/api/')) {
        const r = await routes(req, res, url);
        if (r === null) return send(res, 405, { error: 'method_not_allowed' });
        return;
      }
      if (url.pathname === '/i18n.mjs') return send(res, 200, fs.readFileSync(I18N), { 'Content-Type': TYPES['.mjs'] });
      // static web app
      let file = path.normalize(path.join(WEB, url.pathname === '/tv' ? 'tv.html' : decodeURIComponent(url.pathname)));
      if (!file.startsWith(WEB)) return send(res, 403, 'forbidden');
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) file = path.join(WEB, 'index.html');
      return send(res, 200, fs.readFileSync(file), { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'" });
    } catch (e) {
      const status = e?.status || 500;
      if (status >= 500) console.error('[thoughtful]', e?.message || e);
      return send(res, status, { error: status >= 500 ? 'internal' : e.message });
    }
  });

  return {
    server, token,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const a = server.address();
          publicBase = `http://127.0.0.1:${a.port}`;
          resolve({ port: a.port, host, token });
        });
      });
    },
    close() { return new Promise((r) => server.close(() => r())); },
  };
}

// Only images that Thoughtful itself returned as gift ideas can be proxied (no open proxy).
async function proxyImage(ctx, url, res) {
  const u = url.searchParams.get('u') || '';
  const cache = ctx.current.store.state.cache;
  const allowed = Object.entries(cache).some(([k, v]) => k.startsWith('gifts:') && (v.value || []).some((p) => p.image === u));
  if (!allowed || !/^https:\/\//.test(u)) return send(res, 404, 'not found');
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return send(res, 404, 'not found');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4 * 1024 * 1024) return send(res, 404, 'too big');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  } catch { send(res, 404, 'not found'); }
}
