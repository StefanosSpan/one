// English staff screens for venues in the United States. The screens are written in Greek; for a United States
// venue every Greek text on the page (text, placeholders, titles, dialogs, page title) is shown in English from the
// dictionary in en.js, also for everything drawn later. Money and dates follow the venue (dollars, en-US).
import { translate, GREEK } from './lang-core.js';
import { EN } from './en.js';
import { L10N } from './util.js';

// Greek words without an English entry (checked by the tests; also handy in the browser console).
export const missing = new Set();
window.__untranslated = missing;
const tr = (s) => translate(s, EN, (w) => missing.add(w));
export const en = (s) => (L10N.market === 'us' ? tr(s) : s);

const REJECT = 'script,style,textarea,[translate="no"]';
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

function fixText(n) {
  const v = n.nodeValue;
  if (v && GREEK.test(v)) { const t = tr(v); if (t !== v) n.nodeValue = t; }
}
function fixAttrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v && GREEK.test(v)) el.setAttribute(a, tr(v));
  }
  if (el.tagName === 'INPUT' && ['button', 'submit'].includes(el.type) && GREEK.test(el.value)) el.value = tr(el.value);
}
function walk(root) {
  if (root.nodeType === 3) { if (!root.parentElement?.closest(REJECT)) fixText(root); return; }
  if (root.nodeType !== 1 || root.closest(REJECT)) return;
  fixAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    { acceptNode: (n) => (n.nodeType === 1 && n.matches(REJECT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) fixText(n); else fixAttrs(n); }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  document.documentElement.lang = 'en';
  document.title = tr(document.title);
  const title = document.querySelector('title');
  if (title) new MutationObserver(() => { const t = tr(document.title); if (t !== document.title) document.title = t; }).observe(title, { childList: true, characterData: true, subtree: true });
  walk(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(walk);
      else if (m.type === 'characterData') { if (!m.target.parentElement?.closest(REJECT)) fixText(m.target); }
      else if (m.type === 'attributes') fixAttrs(m.target);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  for (const name of ['alert', 'confirm']) { const f = window[name].bind(window); window[name] = (msg) => f(tr(String(msg ?? ''))); }
  const ask = window.prompt.bind(window);
  window.prompt = (msg, value) => ask(tr(String(msg ?? '')), value);
}

/** Sets the market of the page: 'us' shows English, dollars and US dates; 'gr' keeps Greek and euros. */
export function setMarket(market) {
  const us = market === 'us';
  Object.assign(L10N, us ? { market: 'us', locale: 'en-US', currency: 'USD' } : { market: 'gr', locale: 'el-GR', currency: 'EUR' });
  document.documentElement.dataset.market = L10N.market;
  if (us) start();
}

/** For pages opened before any venue is known (PIN login, printing): the venue of the login or of the address. */
export async function marketFromServer() {
  for (const url of ['/api/staff/me', '/api/site']) {
    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) continue;
      const d = await r.json();
      const market = d.venue?.market || d.market;
      if (market) { setMarket(market); return market; }
    } catch { /* offline */ }
  }
  return 'gr';
}
