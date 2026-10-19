// Thoughtful web app (iPhone first, works on any browser). Vanilla ES modules, no build step.
import { t as tr, LOCALE, rel } from '/i18n.mjs';

const root = document.getElementById('root');
let S = null; // last /api/state
// Language: a manual EN/FR choice wins (kept on this device and in the notebook); otherwise the device language.
const manualLang = () => { try { return localStorage.getItem('thoughtful.lang.manual'); } catch { return null; } };
const deviceLang = () => (/^fr\b/i.test(navigator.language || '') ? 'fr' : 'en');
let lang = ['en', 'fr'].includes(manualLang()) ? manualLang() : deviceLang();
let extras = null, extrasFor = null;
const T = (k, v) => tr(lang, k, v);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const loc = () => LOCALE[lang];
const dayLabel = (d) => new Intl.DateTimeFormat(loc(), { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
const shortDate = (ms) => new Intl.DateTimeFormat(loc(), { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(ms));
const timeAgo = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto' });
  return m < 60 ? rtf.format(-Math.max(0, m), 'minute') : m < 1440 ? rtf.format(-Math.round(m / 60), 'hour') : rtf.format(-Math.round(m / 1440), 'day');
};
const money = (n, c) => new Intl.NumberFormat(loc(), { style: 'currency', currency: c || 'USD', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
const initial = (n) => esc(String(n || '?').trim().charAt(0).toUpperCase());
const when = (d) => (d === 0 ? T('when.today') : d === 1 ? T('when.tomorrow') : T('when.in', { d }));
const icon = (id, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
document.documentElement.lang = lang;
if (new URLSearchParams(location.search).get('mask') === '1') document.documentElement.classList.add('masked');
document.getElementById('splash-text').textContent = T('loading');

// ---------- API ----------
async function api(path, body) {
  const headers = { 'X-Thoughtful-Lang': lang };
  const r = await fetch(path, body === undefined ? { headers } : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error || r.status), { status: r.status });
  return r.json();
}
async function load() {
  S = await api('/api/state');
  if (!manualLang() && S.settings?.langChosen && ['en', 'fr'].includes(S.settings.lang) && S.settings.lang !== lang) setLang(S.settings.lang, false);
  return S;
}

// ---------- feedback ----------
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 3600);
}
function confirmAlert({ title, detail, ok }) {
  const d = document.getElementById('alert');
  document.getElementById('alert-t').textContent = title;
  document.getElementById('alert-d').textContent = detail;
  const yes = document.getElementById('alert-ok'), no = document.getElementById('alert-no');
  yes.textContent = ok; no.textContent = T('cancel');
  return new Promise((resolve) => {
    const done = (v) => { d.close(); yes.onclick = no.onclick = null; resolve(v); };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    d.oncancel = (e) => { e.preventDefault(); done(false); };
    d.onclick = (e) => { if (e.target === d) done(false); };
    d.showModal();
    no.focus();
  });
}
// One action at a time per button: disabled + busy state while the request runs (no double submit).
async function act(btn, fn) {
  if (btn?.getAttribute('aria-busy') === 'true') return;
  btn?.setAttribute('aria-busy', 'true');
  if (btn) btn.disabled = true;
  try { await fn(); }
  catch (e) { toast(e.status ? T('toast.error') : T('toast.offline')); }
  finally { if (btn?.isConnected) { btn.disabled = false; btn.removeAttribute('aria-busy'); } }
}

function setLang(l, persist = true) {
  lang = l;
  document.documentElement.lang = l;
  if (!persist) return;
  try { localStorage.setItem('thoughtful.lang.manual', l); } catch {}
  if (S && !S.firstRun) api('/api/settings', { lang: l }).catch(() => {});
}

// ---------- chrome ----------
function langSwitch() {
  return `<div class="lang" role="group" aria-label="${esc(T('set.lang'))}"><button type="button" data-lang="en" aria-pressed="${lang === 'en'}">EN</button><button type="button" data-lang="fr" aria-pressed="${lang === 'fr'}">FR</button></div>`;
}
function topbar() {
  return `<div class="topbar"><span class="brand">${icon('mark')}${esc(T('app.name'))}</span>${langSwitch()}</div>`;
}
function tabbar(active) {
  const tab = (id, ic, label) => `<a href="#/${id}" ${active === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${esc(T(label))}</span></a>`;
  return `<nav class="tabbar" aria-label="Thoughtful">${tab('tonight', 'moon', 'tab.tonight')}${tab('people', 'people', 'tab.people')}${tab('settings', 'gear', 'tab.settings')}</nav>`;
}
function sampleBanner() {
  if (S.mode !== 'sample') return '';
  return `<div class="banner" role="note">${icon('info')}<div><b>${esc(T('sample.badge'))}.</b> ${esc(T('sample.note'))}</div></div>`;
}
function errorBanner() {
  const e = S.connection?.lastError;
  if (!e || S.mode === 'sample') return '';
  return `<div class="banner warn" role="alert">${icon('info')}<div><b>${esc(T('err.title'))}.</b> ${esc(e.message)} <button class="btn plain" data-sync type="button">${esc(T('retry'))}</button></div></div>`;
}

// ---------- views ----------
function onboarding() {
  root.innerHTML = `<main class="app onb"><div class="topbar"><span></span>${langSwitch()}</div>
    <svg class="mark" aria-hidden="true"><use href="#i-mark"/></svg>
    <h1>${esc(T('onb.title'))}</h1>
    <p class="lead">${esc(T('onb.lead'))}</p>
    <ul class="promise-list">
      <li>${icon('hush')}<div><b>${esc(T('onb.p1.t'))}</b><span>${esc(T('onb.p1.d'))}</span></div></li>
      <li>${icon('check')}<div><b>${esc(T('onb.p2.t'))}</b><span>${esc(T('onb.p2.d'))}</span></div></li>
      <li>${icon('lock')}<div><b>${esc(T('onb.p3.t'))}</b><span>${esc(T('onb.p3.d'))}</span></div></li>
    </ul>
    <label class="consent"><input type="checkbox" id="consent"><span>${esc(T('onb.consent'))}</span></label>
    <p class="err" id="onb-err" hidden>${esc(T('onb.consent.needed'))}</p>
    <div class="stack">
      <button class="btn primary wide" id="go-live" type="button">${esc(T('onb.live'))}</button>
      <p class="hint">${esc(T('onb.live.hint'))}</p>
      <button class="btn wide" id="go-sample" type="button">${esc(T('onb.sample'))}</button>
    </div></main>`;
  const go = (mode) => async (e) => {
    const consent = document.getElementById('consent').checked;
    if (mode === 'live' && !consent) { document.getElementById('onb-err').hidden = false; document.getElementById('consent').focus(); return; }
    await act(e.currentTarget, async () => {
      if (mode === 'live') await api('/api/onboarding', { lang, consent: true, mode: 'live' });
      else { await api('/api/mode', { mode: 'sample' }); await api('/api/settings', { lang }); }
      await load();
      location.hash = '#/tonight';
      route();
    });
  };
  document.getElementById('go-live').onclick = go('live');
  document.getElementById('go-sample').onclick = go('sample');
}

function quote(n) {
  const src = n.source === 'bee_fact' ? T('confirm.heardBee', { date: shortDate(n.saidAt) }) : T('confirm.heard', { date: shortDate(n.saidAt) });
  return `<p class="quote">“${esc(n.quote)}”</p><p class="meta">${esc(src)}${n.mentions > 1 ? ` · ${n.mentions}×` : ''}</p>`;
}

function summarySentence(c) {
  const bits = [];
  const occ = c.elements.find((e) => e.type === 'occasion');
  const see = c.elements.find((e) => e.type === 'see');
  const conf = c.elements.find((e) => e.type === 'confirm');
  const prom = c.elements.find((e) => e.type === 'promise');
  if (occ) bits.push(occ.kind === 'birthday' ? T(occ.daysLeft === 0 ? 'tonight.sum.birthday.0' : occ.daysLeft === 1 ? 'tonight.sum.birthday.1' : 'tonight.sum.birthday', { name: occ.person.name, d: occ.daysLeft }) : T('tonight.sum.occasion', { name: occ.person.name, what: T('occasion.' + occ.kind).toLowerCase(), d: occ.daysLeft }));
  if (see) bits.push(T('tonight.sum.see', { name: see.person.name, when: when(see.daysLeft) }));
  if (conf) bits.push(T(conf.left > 1 ? 'tonight.sum.confirm.n' : 'tonight.sum.confirm', { n: conf.left }));
  if (prom) bits.push(T('tonight.sum.promise', { name: prom.person.name }));
  const s = bits.map((b, i) => (i ? b.charAt(0).toLowerCase() + b.slice(1) : b));
  return s.length === 1 ? s[0] + '.' : s.slice(0, -1).join(', ') + (lang === 'fr' ? ' et ' : ', and ') + s[s.length - 1] + '.';
}

function tonightView() {
  const c = S.tonight;
  let html = `<main class="app">${topbar()}<p class="date">${esc(dayLabel(c.day))}</p>`;
  if (!c.elements.length) {
    html += `<h1 class="title">${esc(T('tonight.nothing.t'))}</h1>${sampleBanner()}${errorBanner()}
      <div class="empty"><svg class="mark" aria-hidden="true"><use href="#i-moon"/></svg><p>${esc(T('tonight.nothing.d'))}</p>
      <button class="btn" data-sync type="button">${esc(T('set.sync'))}</button></div></main>${tabbar('tonight')}`;
    root.innerHTML = html;
    return;
  }
  html += `<h1 class="title">${esc(summarySentence(c))}</h1>${sampleBanner()}${errorBanner()}`;
  for (const e of c.elements) {
    if (e.type === 'confirm') {
      const newP = e.person.status === 'suggested' ? `<p class="meta">${esc(T('confirm.newPerson', { name: e.person.name, rel: e.person.relation ? ` (${rel(lang, e.person.relation)})` : '' }))}</p>` : '';
      html += `<section class="moment" aria-label="${esc(T('confirm.title'))}"><p class="kicker">${esc(T('confirm.title'))}</p>
        <div class="who"><div class="mono" aria-hidden="true">${initial(e.person.name)}</div><p class="headline">${esc(e.person.name)}${e.person.relation ? ` <span class="soft">· ${esc(rel(lang, e.person.relation))}</span>` : ''}<br>${esc(e.item.text)}</p></div>
        ${quote(e.item)}${newP}
        <div class="actions"><button class="btn primary" type="button" data-confirm="${esc(e.item.id)}">${esc(T('confirm.yes'))}</button><button class="btn" type="button" data-reject="${esc(e.item.id)}">${esc(T('confirm.no'))}</button></div>
        <p class="small">${esc(e.left > 1 ? T('confirm.left', { n: e.left - 1 }) : T('confirm.left.0'))}</p></section>`;
    } else if (e.type === 'occasion') {
      html += `<section class="moment" aria-label="${esc(T('occasion.' + e.kind))}"><p class="kicker">${esc(T('occasion.' + e.kind))} · ${esc(dayLabel(e.date))}</p>
        <div class="who"><div class="mono" aria-hidden="true">${initial(e.person.name)}</div><p class="headline">${esc(e.person.name)} <span class="soft">· ${esc(when(e.daysLeft))}</span></p></div>`;
      html += e.evidence.length ? e.evidence.map((n) => `<p class="note-text">${esc(n.text)}</p>${quote(n)}`).join('') : `<p class="meta">${esc(T('occasion.noWords', { name: e.person.name }))}</p>`;
      html += `<div id="extras">${extrasHtml(e)}</div>
        <div class="actions"><button class="btn" type="button" data-remind="${esc(e.evidence[0]?.id || '')}" data-when="in3days" ${e.evidence[0] ? '' : 'hidden'}>${esc(T('occasion.remind'))}</button></div></section>`;
    } else if (e.type === 'see') {
      html += `<section class="moment"><p class="kicker">${esc(T('see.title', { name: e.person.name }))} · ${esc(dayLabel(e.date))}</p>
        <div class="who"><div class="mono" aria-hidden="true">${initial(e.person.name)}</div><p class="headline">${esc(e.plan.text)}</p></div>
        ${e.evidence.map((n) => `<p class="note-text">${esc(n.text)}</p>${quote(n)}`).join('')}</section>`;
    } else if (e.type === 'promise') {
      html += `<section class="moment"><p class="kicker">${esc(T('promise.title', { name: e.person.name }))}</p>
        <div class="who"><div class="mono" aria-hidden="true">${initial(e.person.name)}</div><p class="headline">${esc(e.item.text)}</p></div>
        ${quote(e.item)}
        ${e.reminder ? `<p class="meta">${esc(T('promise.planned', { when: shortDate(e.reminder.dueAt) }))}</p>` : ''}
        <div class="actions">${e.reminder ? '' : `<button class="btn" type="button" data-remind="${esc(e.item.id)}" data-when="tomorrow9">${esc(T('promise.remind'))}</button>`}<button class="btn plain" type="button" data-done="${esc(e.item.id)}">${esc(T('promise.done'))}</button></div></section>`;
    }
  }
  html += `</main>${tabbar('tonight')}`;
  root.innerHTML = html;
  const occ = c.elements.find((e) => e.type === 'occasion');
  const key = occ ? `${occ.person.id}|${occ.giftQuery}|${occ.experienceQuery}` : null;
  if (occ && extrasFor !== key) {
    extrasFor = key; extras = null;
    api('/api/extras?kind=occasion').then((x) => { extras = x; const el = document.getElementById('extras'); if (el) el.innerHTML = extrasHtml(occ); }).catch(() => { extras = { gifts: { status: 'error' }, place: {} }; const el = document.getElementById('extras'); if (el) el.innerHTML = extrasHtml(occ); });
  }
}

function placeHtml(pl) {
  const p = pl.place;
  const reviews = p.rating ? `${new Intl.NumberFormat(loc(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(p.rating)} ★${p.ratings ? ' · ' + T('occasion.reviews', { n: new Intl.NumberFormat(loc()).format(p.ratings) }) : ''}` : '';
  const source = p.source === 'google' ? T('place.google') : p.source === 'osm' ? T('place.osm') : '';
  return `<a class="place" href="${esc(p.url || '#')}" target="_blank" rel="noopener noreferrer"><b>${esc(p.name)}</b>${p.area ? `<span class="place-line">${esc(p.area)}</span>` : ''}${reviews ? `<span class="place-line">${esc(reviews)}</span>` : ''}${source ? `<span class="place-src">${esc(source)}</span>` : ''}</a>`;
}

function extrasHtml(e) {
  if (!e.giftQuery && !e.experienceQuery) return '';
  if (!extras) return `<div class="extras"><div class="gifts" aria-hidden="true"><div class="sk" style="aspect-ratio:.8"></div><div class="sk" style="aspect-ratio:.8"></div><div class="sk" style="aspect-ratio:.8"></div></div></div>`;
  let h = '';
  const g = extras.gifts || {};
  if (g.products?.length) {
    h += `<section class="extra"><p class="kicker">${esc(T('occasion.gifts', { name: e.person.name }))}</p><div class="gifts">${g.products.map((p) => `<a class="gift" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy"><div><b>${esc(p.title)}</b><span class="price">${esc(money(p.price, p.currency))}</span>${p.merchant ? `<span class="merchant">${esc(p.merchant)}</span>` : ''}</div></a>`).join('')}</div><p class="small">${esc(T('occasion.us'))}${g.snapshot ? ' ' + esc(T('occasion.snapshot', { date: shortDate(Date.parse(g.snapshot + 'T12:00:00Z')) })) : ''}</p></section>`;
  } else if (e.giftQuery) {
    h += `<p class="small extra">${esc(T(g.status === 'no_key' ? 'occasion.gifts.nokey' : g.status === 'error' ? 'occasion.gifts.error' : 'occasion.gifts.none'))}</p>`;
  }
  const pl = extras.place || {};
  if (pl.place) h += `<section class="extra"><p class="kicker">${esc(T('occasion.place'))}</p>${placeHtml(pl)}</section>`;
  else if (e.experienceQuery && pl.status === 'no_area') h += `<p class="small extra">${esc(T('occasion.place.noarea'))}</p>`;
  return `<div class="extras">${h}</div>`;
}

function peopleView() {
  const people = S.people;
  let html = `<main class="app">${topbar()}<h1 class="title" style="margin-top:14px">${esc(T('people.title'))}</h1>${sampleBanner()}`;
  if (!people.length) {
    html += `<div class="empty"><svg class="mark" aria-hidden="true"><use href="#i-people"/></svg><h2>${esc(T('people.empty.t'))}</h2><p>${esc(T('people.empty.d'))}</p></div>`;
  } else {
    const row = (p) => `<li class="has-mono"><a class="row" href="#/people/${encodeURIComponent(p.id)}"><div class="mono sm" aria-hidden="true">${initial(p.name)}</div><span class="body"><span class="t">${esc(p.name)}</span><span class="s">${esc([rel(lang, p.relation), p.notes ? T(p.notes === 1 ? 'people.notes' : 'people.notes.n', { n: p.notes }) : '', p.pending ? T('note.pending') : ''].filter(Boolean).join(' · '))}</span></span>${icon('chev', 'chev')}</a></li>`;
    const conf = people.filter((p) => p.status === 'confirmed');
    const sugg = people.filter((p) => p.status !== 'confirmed');
    if (conf.length) html += `<ul class="list">${conf.map(row).join('')}</ul>`;
    if (sugg.length) html += `<h2 class="section">${esc(T('people.suggested'))}</h2><ul class="list">${sugg.map(row).join('')}</ul>`;
  }
  root.innerHTML = html + `</main>${tabbar('people')}`;
}

async function personView(id) {
  let p;
  try { p = await api('/api/people/' + encodeURIComponent(id)); } catch { p = null; }
  if (!p || p.notFound) { location.replace('#/people'); return; }
  const kinds = ['life', 'wish', 'like', 'date', 'plan', 'promise'];
  const bday = p.birthday ? new Intl.DateTimeFormat(loc(), { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`2000-${p.birthday}T12:00:00Z`)) : '';
  let html = `<main class="app"><div class="topbar"><a class="back" href="#/people">${icon('back')}${esc(T('person.back'))}</a>${langSwitch()}</div>
    <div class="person-head"><div class="mono" aria-hidden="true">${initial(p.name)}</div><div><h1>${esc(p.name)}</h1><p>${esc(rel(lang, p.relation))}</p></div></div>
    <ul class="list">
      <li><label class="row"><span class="body"><span class="t">${esc(T('person.relation'))}</span></span><input type="text" id="p-rel" value="${esc(p.relation || '')}" autocomplete="off" enterkeyhint="done" maxlength="30"></label></li>
      <li><label class="row"><span class="body"><span class="t">${esc(T('person.birthday'))}</span><span class="s">${esc(bday || T('person.birthday.none'))}</span></span><input type="date" id="p-bday" value="${p.birthday ? '2000-' + esc(p.birthday) : ''}" style="font-size:17px;border:0;background:var(--fill);border-radius:10px;min-height:40px;padding:0 8px;color:var(--label)"></label></li>
    </ul>
    <div class="actions" style="justify-content:flex-end;margin-top:8px"><button class="btn" type="button" id="p-save">${esc(T('person.save'))}</button></div>`;
  for (const k of kinds) {
    const notes = p.notes.filter((n) => n.kind === k);
    if (!notes.length) continue;
    html += `<h2 class="section">${esc(T('kind.' + k))}</h2><ul class="list">${notes.map((n) => `<li><div class="note"><div class="top"><span class="note-text">${esc(n.text)}</span><button class="btn plain" type="button" data-forget="${esc(n.id)}" style="min-height:44px">${esc(T('note.forget'))}</button></div>${quote(n)}<p class="small">${esc(n.status === 'pending' ? T('note.pending') : n.inBee ? T('note.inBee') : '')}</p></div></li>`).join('')}</ul>`;
  }
  html += `<div class="actions" style="margin-top:28px"><button class="btn danger wide" type="button" id="p-forget">${esc(T('person.forget', { name: p.name }))}</button></div></main>${tabbar('people')}`;
  root.innerHTML = html;
  document.getElementById('p-save').onclick = (e) => act(e.currentTarget, async () => {
    const v = document.getElementById('p-bday').value;
    await api(`/api/people/${encodeURIComponent(p.id)}`, { relation: document.getElementById('p-rel').value, birthday: v ? v.slice(5) : null });
    toast(T('toast.saved')); await load(); personView(p.id);
  });
  document.getElementById('p-forget').onclick = async (e) => {
    const ok = await confirmAlert({ title: T('person.forget.q', { name: p.name }), detail: T('person.forget.d', { name: p.name }), ok: T('note.forget') });
    if (!ok) return;
    await act(e.currentTarget, async () => { await api(`/api/people/${encodeURIComponent(p.id)}/forget`, {}); toast(T('toast.forgot')); await load(); location.hash = '#/people'; });
  };
  root.querySelectorAll('[data-forget]').forEach((b) => b.onclick = async () => {
    const ok = await confirmAlert({ title: T('note.forget.q'), detail: T('note.forget.d'), ok: T('note.forget') });
    if (!ok) return;
    await act(b, async () => { await api(`/api/items/${encodeURIComponent(b.dataset.forget)}/forget`, {}); toast(T('toast.forgot')); await load(); personView(p.id); });
  });
}

function settingsView() {
  const s = S.settings, c = S.connection;
  const sel = (id, opts, v, label) => `<select id="${id}" aria-label="${esc(label)}">${opts.map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  const keyRow = (label, ok) => `<li><div class="row"><span class="body"><span class="t">${esc(label)}</span></span><span class="d"><span class="status ${ok ? 'ok' : ''}">${esc(T(ok ? 'set.key.ok' : 'set.key.off'))}</span></span></div></li>`;
  const nice = (id = '') => (/nova-2-lite/.test(id) ? 'Amazon Nova 2 Lite' : /haiku-4-5/.test(id) ? 'Claude Haiku 4.5' : id) + ' · Amazon Bedrock';
  const model = c.extractor === 'replay' ? `${nice(c.model)} · ${lang === 'fr' ? 'enregistré le' : 'recorded'} ${c.recordedOn ? shortDate(Date.parse(c.recordedOn + 'T12:00:00Z')) : ''}` : nice(c.model);
  let html = `<main class="app">${topbar()}<h1 class="title" style="margin-top:14px">${esc(T('set.title'))}</h1>${sampleBanner()}
    <ul class="list">
      <li><div class="row"><span class="body"><span class="t">${esc(T('set.mode'))}</span></span>${sel('s-mode', [['live', T('set.mode.live')], ['sample', T('set.mode.sample')]], S.mode, T('set.mode'))}</div></li>
      <li><label class="row"><span class="body"><span class="t">${esc(T('set.ritual'))}</span><span class="s">${esc(T('set.ritual.d'))}</span></span><input type="time" id="s-time" value="${esc(s.ritualTime)}"></label></li>
      <li><div class="row"><span class="body"><span class="t">${esc(T('set.nudges'))}</span></span>${sel('s-nudges', [[0, '0'], [1, '1'], [2, '2']], s.maxNudgesPerDay, T('set.nudges'))}</div></li>
      <li><div class="row"><span class="body"><span class="t">${esc(T('set.quiet'))}</span></span>${sel('s-quiet', [[10, T('set.quiet.v', { n: 10 })], [20, T('set.quiet.v', { n: 20 })], [30, T('set.quiet.v', { n: 30 })], [60, T('set.quiet.v', { n: 60 })]], s.quietMinutes, T('set.quiet'))}</div></li>
      <li><label class="row"><span class="body"><span class="t">${esc(T('set.area'))}</span></span><input type="text" id="s-area" value="${esc(s.homeArea)}" placeholder="${esc(T('set.area.ph'))}" autocomplete="address-level2" enterkeyhint="done" maxlength="60"></label></li>
    </ul><p class="list-foot">${esc(T('set.area.d'))}</p>
    <ul class="list" style="margin-top:24px">
      <li><label class="row"><span class="body"><span class="t">${esc(T('set.pause'))}</span><span class="s">${esc(T('set.pause.d'))}</span></span><input type="checkbox" role="switch" class="switch" id="s-pause" ${s.paused ? 'checked' : ''}></label></li>
      <li><label class="row"><span class="body"><span class="t">${esc(T('set.writeBee'))}</span><span class="s">${esc(T('set.writeBee.d'))}</span></span><input type="checkbox" role="switch" class="switch" id="s-bee" ${s.writeToBee !== false ? 'checked' : ''}></label></li>
    </ul>
    <h2 class="section">${esc(T('set.conn'))}</h2>
    <ul class="list">
      <li><div class="row"><span class="body"><span class="t">${esc(T('set.bee'))}</span><span class="s">${esc(c.lastSyncAt ? T('set.sync.last', { when: timeAgo(c.lastSyncAt) }) : T('set.sync.never'))}</span></span><button class="btn" type="button" data-sync>${esc(T('set.sync'))}</button></div></li>
      <li><div class="row"><span class="body"><span class="t">${esc(T('set.model'))}</span><span class="s">${esc(model)}</span></span><span class="d">${esc(T('set.spend', { v: money(c.spendToday || 0, 'USD'), cap: money(c.spendCap, 'USD') }))}</span></div></li>
      ${c.aws ? `<li><div class="row"><span class="body"><span class="t">${esc(T('set.aws'))}</span><span class="s">${esc(c.aws.profile || '')}</span></span><span class="d"><span class="status ${c.aws.ok ? 'ok' : ''}">${esc(T(c.aws.ok ? 'set.aws.ok' : 'set.aws.off'))}</span></span></div></li>` : ''}
      ${keyRow(T('set.channel3'), c.keys?.channel3)}${keyRow(T('set.places'), c.keys?.places)}
      <li><button class="row" type="button" data-sync="last" style="color:var(--accent-text)">${esc(T('set.reread'))}</button></li>
    </ul>
    <h2 class="section">${esc(T('set.stores'))}</h2>
    <ul class="list"><li><div class="note"><p class="meta" style="color:var(--label)">${esc(T('set.stores.d'))}</p></div></li>
      <li><button class="row" type="button" id="s-erase" style="color:var(--danger);font-weight:500">${esc(T('set.erase'))}</button></li></ul>
    <h2 class="section">${esc(T('set.activity'))}</h2>
    <ul class="list">${S.activity.length ? S.activity.slice(0, 8).map((a) => `<li><div class="row"><span class="body"><span class="t" style="font-weight:400;white-space:normal">${esc(a.message)}</span><span class="s">${esc(timeAgo(a.at))}</span></span></div></li>`).join('') : `<li><div class="row"><span class="body"><span class="s">${esc(T('set.activity.none'))}</span></span></div></li>`}</ul>
  </main>${tabbar('settings')}`;
  root.innerHTML = html;
  const save = async (body) => { try { await api('/api/settings', body); await load(); toast(T('toast.saved')); } catch { toast(T('toast.error')); } };
  document.getElementById('s-time').onchange = (e) => save({ ritualTime: e.target.value });
  document.getElementById('s-nudges').onchange = (e) => save({ maxNudgesPerDay: Number(e.target.value) });
  document.getElementById('s-quiet').onchange = (e) => save({ quietMinutes: Number(e.target.value) });
  document.getElementById('s-area').onchange = (e) => save({ homeArea: e.target.value });
  document.getElementById('s-pause').onchange = (e) => save({ paused: e.target.checked });
  document.getElementById('s-bee').onchange = (e) => save({ writeToBee: e.target.checked });
  document.getElementById('s-mode').onchange = async (e) => {
    try { await api('/api/mode', { mode: e.target.value }); extras = null; extrasFor = null; await load(); if (S.needsOnboarding) return onboarding(); settingsView(); } catch { toast(T('toast.error')); }
  };
  document.getElementById('s-erase').onclick = async (e) => {
    const ok = await confirmAlert({ title: T('set.erase.q'), detail: T('set.erase.d'), ok: T('set.erase.ok') });
    if (!ok) return;
    await act(e.currentTarget, async () => { await api('/api/erase', { alsoBee: true }); toast(T('toast.erased')); extras = null; extrasFor = null; await load(); route(); });
  };
}

// ---------- events ----------
root.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.lang) { setLang(b.dataset.lang); await load().catch(() => {}); return route(); }
  if (b.dataset.sync !== undefined) return act(b, async () => {
    const r = await api('/api/sync', b.dataset.sync === 'last' ? { reprocessLast: 1 } : {});
    await load();
    toast(r.ok ? T('toast.synced', { n: (r.notes || 0) + (r.facts || 0) }) : r.error);
    route();
  });
  if (b.dataset.confirm) return act(b, async () => { const r = await api(`/api/items/${encodeURIComponent(b.dataset.confirm)}/confirm`, {}); toast(r.bee === 'wrote_bee_fact' || r.bee === 'confirmed_bee_fact' ? T('toast.keptBee') : T('toast.kept', { name: r.person || '' })); await load(); route(); });
  if (b.dataset.reject) return act(b, async () => { await api(`/api/items/${encodeURIComponent(b.dataset.reject)}/reject`, {}); toast(T('toast.no')); await load(); route(); });
  if (b.dataset.done) return act(b, async () => { await api(`/api/items/${encodeURIComponent(b.dataset.done)}/done`, {}); await load(); route(); });
  if (b.dataset.remind) return act(b, async () => { const r = await api(`/api/items/${encodeURIComponent(b.dataset.remind)}/remind`, { when: b.dataset.when }); toast(T('promise.planned', { when: shortDate(r.dueAt) })); await load(); route(); });
});

function route() {
  if (!S) return;
  if (S.firstRun || S.needsOnboarding) return onboarding();
  const h = location.hash || '#/tonight';
  if (h.startsWith('#/people/')) return personView(decodeURIComponent(h.slice(9)));
  if (h === '#/people') return peopleView();
  if (h === '#/settings') return settingsView();
  return tonightView();
}
addEventListener('hashchange', () => { window.scrollTo(0, 0); route(); });
// Fresh data when the app comes back to the foreground (no polling in the background).
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S) load().then(() => { if (!document.querySelector('input:focus, select:focus')) route(); }).catch(() => {}); });

// Broken product image: hide it, keep the tile (no inline handlers: the page CSP forbids them).
document.addEventListener('error', (e) => { if (e.target?.tagName === 'IMG') e.target.style.visibility = 'hidden'; }, true);

load().then(route).catch(() => {
  root.innerHTML = `<main class="app"><div class="empty"><svg class="mark" aria-hidden="true"><use href="#i-mark"/></svg><h2>${esc(T('toast.offline'))}</h2><p><code>npm start</code></p><button class="btn" type="button" id="reload">${esc(T('retry'))}</button></div></main>`;
  document.getElementById('reload').onclick = () => location.reload();
});
