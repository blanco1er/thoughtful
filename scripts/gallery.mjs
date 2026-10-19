#!/usr/bin/env node
// Builds the 3:2 Devpost gallery (3000×2000 JPEG) from screenshots of the SAMPLE household (invented data).
//   SHOTS=<folder with show15-light.png, phone-tonight.png, …> PLAYWRIGHT_CORE=<path> CHROME_PATH=<chrome> node scripts/gallery.mjs
// Output: docs/gallery/NN-name.jpg + docs/gallery/CAPTIONS.md (captions ≤ 140 characters, checked).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const SHOTS = process.env.SHOTS;
const OUT = path.resolve('docs/gallery');
fs.mkdirSync(OUT, { recursive: true });

const SLIDES = [
  { n: '01-tonight-echo', img: 'show15-light.png', kind: 'wide', k: 'Echo Show 15', t: 'One calm card, after Bee’s 8 PM summary.', p: 'Three things at most: a note to confirm, a birthday coming up, a promise you made. Nothing during the day.', c: 'Tonight on an Echo Show 15: one note to confirm, Maya’s birthday in 12 days, a promise. Sample household, invented data.' },
  { n: '02-surprise-echo', img: 'show15-light-show.png', kind: 'wide', k: 'Only when you say so', t: 'Her own words, real gifts, a real place.', p: 'Covered on shared screens until you tap Show, and covered again after ten minutes. The voice never reads a gift.', c: 'Tap Show: her own words, 3 real gifts in a gift price range (Channel3) and a real place nearby (Google Maps). Never bought for you.' },
  { n: '03-echo8-dark', img: 'show8-dark.png', kind: 'wide', k: 'Echo Show 8, dark', t: 'Readable from across the room.', p: 'An MCP Apps card served by Thoughtful’s MCP server, shown here in our open-source Alexa+-style host.', c: 'Echo Show 8 in dark mode: an MCP Apps card from Thoughtful’s MCP server, in the open-source mcp-voice-host simulator.' },
  { n: '04-tonight-phone', img: 'phone-tonight.png', kind: 'phone', k: 'iPhone', t: 'The same evening, in your hand.', p: 'Every note comes with the words Bee heard and the day it heard them. Yes keeps it, No sets it aside for good.', c: 'On iPhone: every note shows the words Bee heard and when. Yes keeps it, No sets it aside. At most 3 questions a day.' },
  { n: '05-gifts-phone', img: 'phone-gifts.png', kind: 'phone', k: 'Real data', t: 'From what she said to a real gift.', p: 'Gift ideas between $15 and $250 with the real store. From Google, only the place ID is ever stored.', c: 'Real gift ideas with their real stores, and a place from Google Maps (only its ID is stored; OpenStreetMap without a key).' },
  { n: '06-person-phone', img: 'phone-person.png', kind: 'phone', k: 'A notebook you control', t: 'Confirmed notes become Bee facts.', p: 'Edit a name, a relation or a birthday. Forget any note: it is erased here and in Bee.', c: 'Each person: confirmed notes become Bee facts other agents can use. Forget erases a note here and in Bee.' },
  { n: '07-onboarding', img: 'phone-onboarding.png', kind: 'phone', k: 'First launch', t: 'Never interrupts. Nothing without your yes.', p: 'Health, conflicts, politics, religion and money are removed on your Mac before anything is sent for extraction.', c: 'First launch: three promises and a consent line. Sensitive sentences are removed on the Mac before anything leaves it.' },
  { n: '08-privacy', img: 'phone-settings.png', kind: 'phone', k: 'Privacy', t: 'Everything stays on your Mac.', p: 'Short notes and their proof in a private file. Never transcripts, never audio. Erase everything in one tap.', c: 'Settings: what Thoughtful stores, Bedrock spend against a hard cap, and Erase everything (in Bee too).' },
  { n: '09-sunday-tv', img: 'tv-sunday.png', kind: 'wide', k: 'Sunday, on the TV', t: 'Your week with the people you love.', p: 'Family-safe: names and counts only, readable from the sofa, navigable with a remote.', c: 'Sunday on the TV: a family-safe view of the week, names and counts only, navigable with a Fire TV remote.' },
  { n: '10-how', img: null, kind: 'diagram', k: 'How it works', t: 'Bee hears. Thoughtful remembers. You decide.', p: '', c: 'How it works: Bee CLI library → Bedrock (Nova 2 Lite) → guards → private notebook → Echo Show, iPhone, wrist and TV.' },
];

const css = `*{box-sizing:border-box}html,body{margin:0}body{width:1500px;height:1000px;background:#f6f1ea;color:#1f1a16;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}
.k{font-size:22px;font-weight:600;color:#a63f1a;margin:0 0 14px}.t{font:700 54px/1.08 ui-rounded,"SF Pro Rounded",-apple-system,system-ui;letter-spacing:-.02em;margin:0 0 18px}.p{font-size:25px;line-height:1.42;color:#6a5f55;margin:0}
.brand{position:absolute;left:72px;bottom:46px;display:flex;align-items:center;gap:12px;font-weight:600;color:#6a5f55;font-size:22px}.brand svg{width:34px;height:34px}
.phone{display:grid;grid-template-columns:600px 1fr;gap:40px;align-items:center;height:100%;padding:0 90px 0 72px}.phone img{height:900px;border-radius:56px;box-shadow:0 30px 80px rgba(60,40,20,.22),0 0 0 10px #1f1a16;justify-self:center}
.wide{padding:64px 72px 0;height:100%}.wide .head{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:end;margin-bottom:34px}.wide .t{margin:0}.wide img{display:block;margin:0 auto;max-width:1300px;max-height:640px;border-radius:26px;box-shadow:0 30px 80px rgba(60,40,20,.2)}
.diag{padding:64px 72px 150px;height:100%;display:flex;flex-direction:column}.flow{display:grid;grid-template-columns:repeat(5,1fr);gap:18px;margin-top:40px}.box{background:#fff;border-radius:22px;padding:26px 22px;min-height:300px}.box b{display:block;font-size:26px;margin-bottom:12px}.box span{font-size:21px;line-height:1.45;color:#6a5f55}.arrow{color:#b4471f}
.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:auto}.fact{border-top:2px solid rgba(70,50,30,.14);padding-top:14px}.fact b{font:700 52px/1 ui-rounded,-apple-system,system-ui;display:block;margin-bottom:6px}.fact span{font-size:19px;color:#6a5f55}`;
const mark = `<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#b4471f"/><path d="M16 12h16a2 2 0 0 1 2 2v22l-10-6-10 6V14a2 2 0 0 1 2-2Z" fill="#fff"/><circle cx="24" cy="21" r="3" fill="#b4471f"/></svg>`;
const img = (f) => `data:image/png;base64,${fs.readFileSync(path.join(SHOTS, f)).toString('base64')}`;
function page(s) {
  const brand = `<div class="brand">${mark}Thoughtful · built on Bee</div>`;
  if (s.kind === 'phone') return `<div class="phone"><div><p class="k">${s.k}</p><h1 class="t">${s.t}</h1><p class="p">${s.p}</p></div><img src="${img(s.img)}"></div>${brand}`;
  if (s.kind === 'wide') return `<div class="wide"><div class="head"><div><p class="k">${s.k}</p><h1 class="t">${s.t}</h1></div><p class="p">${s.p}</p></div><img src="${img(s.img)}"></div>${brand}`;
  return `<div class="diag"><p class="k">${s.k}</p><h1 class="t">${s.t}</h1>
    <div class="flow">
      <div class="box"><b>Bee</b><span>Apple Watch or wearable. Conversations, who spoke, pending facts, calendar, live stream.</span></div>
      <div class="box"><b>@beeai/cli/lib</b><span>Read, and write facts and to-dos with alarms. Own reconnection for the stream.</span></div>
      <div class="box"><b>Amazon Bedrock</b><span>Nova 2 Lite, long talks in overlapping windows, private sentences removed first, spend cap.</span></div>
      <div class="box"><b>Guards in code</b><span>Quote found verbatim, promise said by you, no health, conflicts, politics, money, TV.</span></div>
      <div class="box"><b>Right moment</b><span>Echo Show card (MCP Apps), iPhone, one tap on the wrist when nobody is talking, TV on Sunday.</span></div>
    </div>
    <div class="facts"><div class="fact"><b>0</b><span>leaks in every benchmark run</span></div><div class="fact"><b>79–93 %</b><span>of what matters kept (10 invented talks)</span></div><div class="fact"><b>≤ 2</b><span>reminders a day, never mid-conversation</span></div><div class="fact"><b>&lt; 1 ¢</b><span>per conversation on Bedrock, hard cap in code</span></div></div></div>${brand}`;
}

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
let md = '# Devpost gallery (upload one at a time, in this order)\n\nAll screenshots use the sample household (invented people and conversations).\n\n| # | File | Caption (≤ 140 characters) |\n|---|---|---|\n';
for (const s of SLIDES) {
  if (s.c.length > 140) throw new Error(`caption too long (${s.c.length}): ${s.n}`);
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page(s)}</body></html>`);
  await p.waitForTimeout(150);
  const png = path.join(OUT, s.n + '.png');
  await p.screenshot({ path: png });
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', png, '--out', path.join(OUT, s.n + '.jpg')], { stdio: 'ignore' });
  fs.rmSync(png);
  md += `| ${s.n.slice(0, 2)} | ${s.n}.jpg | ${s.c} (${s.c.length}) |\n`;
  console.log(s.n, s.c.length);
}
fs.writeFileSync(path.join(OUT, 'CAPTIONS.md'), md);
await browser.close();
