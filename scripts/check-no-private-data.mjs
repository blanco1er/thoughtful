#!/usr/bin/env node
// Refuses a commit that could carry private data: runtime files, secrets, or the owner's last name.
// Run before every commit (npm run check). Prints file names only, never what matched.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const problems = [];
for (const f of files) {
  if (/(^|\/)(notebook\.json|prefs\.json|pairing-token)$|\.env($|\.)|\.pem$|\.key$/.test(f)) problems.push(`${f}: runtime or secret file`);
}
// Secret-looking strings (AWS keys, bearer tokens, Google API keys).
const SECRET = /([A-Za-z0-9._%+-]+@gmail\.com|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{35})/;
// The owner's last name, read from the Bee CLI at run time if it is signed in (never printed).
let lastName = null;
try {
  const { createLiveSource } = await import('../src/bee.mjs');
  const src = createLiveSource();
  const me = await src.bee.api.me();
  if (me?.last_name && me.last_name.length > 2) lastName = new RegExp(`\\b${me.last_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
} catch {}
for (const f of files) {
  if (!fs.existsSync(f) || fs.statSync(f).size > 2e6 || /\.(png|jpg|jpeg|mp4|ico)$/.test(f)) continue;
  const text = fs.readFileSync(f, 'utf8');
  if (SECRET.test(text)) problems.push(`${f}: looks like a secret`);
  if (lastName && lastName.test(text)) problems.push(`${f}: contains the owner's last name`);
}
// Commit identities must be the public no-reply address (a local machine name or a Gmail address would leak).
try {
  const ids = execFileSync('git', ['log', '--format=%ae%n%ce'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  if (ids.some((e) => !e.endsWith('@users.noreply.github.com'))) problems.push('git history: a commit author or committer is not the no-reply address');
} catch {}
if (problems.length) { console.error('Private data check FAILED:\n  ' + problems.join('\n  ')); process.exit(1); }
console.log(`Private data check passed (${files.length} files${lastName ? ', owner last name checked' : ''}).`);
