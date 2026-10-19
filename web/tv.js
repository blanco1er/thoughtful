import { t as tr, rel } from '/i18n.mjs';
const el = document.getElementById('tv');
let tiles = [];
// D-pad: left/right move between tiles (a Fire TV remote sends arrow keys).
addEventListener('keydown', (e) => {
  const i = tiles.indexOf(document.activeElement);
  if (e.key === 'ArrowRight') { tiles[Math.min(tiles.length - 1, i + 1)]?.focus(); e.preventDefault(); }
  if (e.key === 'ArrowLeft') { tiles[Math.max(0, i - 1)]?.focus(); e.preventDefault(); }
});
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function headline(w, T) {
  const n = w.learned.reduce((a, x) => a + x.n, 0);
  return T(n ? 'tv.head' : 'tv.head.0', { n, p: w.learned.length });
}
async function draw() {
  let w;
  try { w = await (await fetch('/api/week')).json(); } catch { el.innerHTML = '<p class="loading">Thoughtful is not reachable.</p>'; return; }
  const lang = w.lang || 'en';
  const T = (k, v) => tr(lang, k, v);
  document.documentElement.lang = lang;
  const day = (d) => new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
  const who = (x) => `<b>${esc(x.name)}</b>${x.relation ? ` <span>· ${esc(rel(lang, x.relation))}</span>` : ''}`;
  el.innerHTML = `
    <div class="head"><div><p class="kick">${esc(T('tv.title'))}</p><h1>${esc(headline(w, T))}</h1></div><p>${esc(day(w.today))}${w.mode === 'sample' ? ` · <span class="sample">${esc(T('sample.badge'))}</span>` : ''}</p></div>
    <div class="grid">
      <section tabindex="0"><h2>${esc(T('tv.learned'))}</h2>${w.learned.length ? w.learned.map((x) => `<div class="row"><span style="color:var(--label)">${who(x)}</span><span>${esc(T('tv.learned.n', { n: x.n }))}</span></div>`).join('') : `<p class="empty">${esc(T('tv.learned.none'))}</p>`}</section>
      <section tabindex="0"><h2>${esc(T('tv.upcoming'))}</h2>${w.upcoming.length ? w.upcoming.map((x) => `<div class="row"><span style="color:var(--label)">${who(x)}</span><span>${esc(T('occasion.birthday'))} · ${esc(T('tv.upcoming.in', { d: x.days }))}</span></div>`).join('') : `<p class="empty">${esc(T('tv.upcoming.none'))}</p>`}
        ${w.seeing.length ? `<h2 style="margin-top:.6em">${esc(T('tv.seeing'))}</h2>${w.seeing.map((x) => `<div class="row"><b>${esc(x.name)}</b><span>${esc(day(x.date))}</span></div>`).join('')}` : ''}</section>
      <section tabindex="0"><h2>${esc(T('tv.promises'))}</h2><div class="row"><b>${esc(T('tv.promises.v', { kept: w.promises.kept, open: w.promises.open }))}</b></div>
        <p class="empty" style="margin-top:.6em">${esc(T('tv.quiet', { n: w.reminders }))}</p></section>
    </div>
    <div class="foot"><span>${esc(T('tv.private'))}</span><span>Thoughtful · Bee</span></div>`;
  const had = tiles.indexOf(document.activeElement);
  tiles = [...el.querySelectorAll('section')];
  tiles[Math.max(0, had)]?.focus();
}
draw();
setInterval(() => { if (document.visibilityState === 'visible') draw(); }, 15 * 60_000);
