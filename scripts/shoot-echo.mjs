#!/usr/bin/env node
// Screenshots of tonight's card in mcp-voice-host (Echo Show 15 / Show 8 / phone frames), light and dark.
//   MASK=1 blurs names, notes and quotes (screenshots of real data).
//   HOST_URL=http://localhost:4290 OUT=./shots PLAYWRIGHT_CORE=<path to playwright-core> CHROME_PATH=<chrome> node scripts/shoot-echo.mjs
// Prints page errors and horizontal overflow; exits 1 if any.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const HOST = process.env.HOST_URL || 'http://localhost:4290';
const OUT = process.env.OUT || 'shots';
const SAY = process.env.SAY || "what's on thoughtful tonight";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const shots = (process.env.SHOTS || 'show15:light,show15:dark,show8:light,phone:light').split(',');
let bad = 0;
for (const s of shots) {
  const [device, theme] = s.split(':');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, colorScheme: theme });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const u = `${HOST}/?${new URLSearchParams([['device', device], ['theme', theme], ['tts', 'captions'], ['say', SAY], ...(process.env.INSPECTOR ? [['inspector', process.env.INSPECTOR]] : []), ...(process.env.SAY2 ? [['say', process.env.SAY2]] : [])])}`;
  await page.goto(u, { waitUntil: 'networkidle' });
  await page.waitForTimeout(Number(process.env.WAIT || 3500));
  if (process.env.CLICK) {
    for (const frame of page.frames()) {
      const b = await frame.$(`button[data-act="${process.env.CLICK}"]`).catch(() => null);
      if (b) { await b.click(); await page.waitForTimeout(2500); break; }
    }
  }
  if (process.env.MASK) {
    // Real data: blur names, notes and quotes in the card and the spoken reply before the screenshot.
    await page.addStyleTag({ content: '#reply{filter:blur(8px)}' }).catch(() => {});
    for (const frame of page.frames()) await frame.addStyleTag({ content: '.headline,.quote,.mono,h1,.note-text,.cover strong,.gift b,.place b,.meta,.kicker{filter:blur(7px)}' }).catch(() => {});
    await page.waitForTimeout(300);
  }
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (over > 0) errs.push(`horizontal overflow ${over}px`);
  const f = path.join(OUT, `${device}-${theme}${process.env.CLICK ? '-' + process.env.CLICK : ''}.png`);
  await page.screenshot({ path: f });
  console.log(f, errs.length ? 'ERRORS: ' + errs.join(' | ') : 'ok');
  bad += errs.length;
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
