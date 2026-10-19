// The website pages of kalimenu.gr (Greek) and kalimenu.com (English), built on the server with one layout: a header
// with the main menu, the page, and a footer. Pages: home, features, pricing, how it works, questions, contact
// (texts in site-content.js) and the pages for searches (/qr-menu…, texts in landing.js). The search engine tags of
// each page are added by seo.js.
import { PLANS } from './plans.js';
import { LANDING, LANDING_UPDATED } from './landing.js';
import { CONTENT, SITE_UPDATED } from './site-content.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const noEm = (html) => String(html).replace(/<\/?em>/g, '');

// Words of the layout in each language.
const W = {
  gr: {
    lang: 'el', home: 'Αρχική', solutions: 'Λύσεις', login: 'Σύνδεση', trial: 'Δοκιμή δωρεάν', menu: 'Μενού',
    start: 'Ξεκινήστε δωρεάν', demo: 'Δείτε το demo', allFaq: 'Όλες οι ερωτήσεις', seePrices: 'Δείτε τις τιμές',
    allFeatures: 'Όλες οι λειτουργίες', related: 'Δείτε επίσης', stepsTitle: 'Έτοιμο σε ένα απόγευμα', ctaTitle: 'Δοκιμάστε το στο κατάστημά σας',
    ctaText: '14 ημέρες δωρεάν, χωρίς κάρτα και χωρίς δέσμευση. Αν θέλετε, περνάμε εμείς το μενού σας.',
    tag: 'Ψηφιακό μενού, παραγγελία και πληρωμή από το τραπέζι, για την ελληνική εστίαση.',
    product: 'Προϊόν', help: 'Βοήθεια', legal: 'Νομικά', terms: 'Όροι χρήσης', privacy: 'Απόρρητο', dpa: 'Επεξεργασία δεδομένων',
    cookies: 'Cookies', cookieSettings: 'Ρυθμίσεις cookies', vat: 'ΑΦΜ', gemi: 'ΓΕΜΗ', popular: 'Το πιο συχνό',
    priceTitle: 'Πόσο κοστίζει', priceText: '€14,90 τον μήνα για έως 50 θέσεις με QR, ή €29,90 χωρίς όριο. Όλες οι λειτουργίες, χωρίς προμήθεια. Οι τιμές δεν περιλαμβάνουν ΦΠΑ.',
    other: ['https://kalimenu.com', 'en', 'English'], locale: 'el-GR', currency: 'EUR',
  },
  us: {
    lang: 'en', home: 'Home', solutions: 'Solutions', login: 'Sign in', trial: 'Start free', menu: 'Menu',
    start: 'Start your free trial', demo: 'See the demo', allFaq: 'All questions', seePrices: 'See pricing',
    allFeatures: 'All features', related: 'Read more', stepsTitle: 'Up and running in an afternoon', ctaTitle: 'Try it in your restaurant',
    ctaText: '14 days free, no credit card and no contract. We can set up your menu for you.',
    tag: 'QR menus and ordering from the table, for restaurants, bars and hotels.',
    product: 'Product', help: 'Help', legal: 'Legal', terms: 'Terms', privacy: 'Privacy', dpa: 'Data processing',
    cookies: 'Cookies', cookieSettings: 'Your privacy choices', popular: 'Most popular',
    priceTitle: 'What it costs', priceText: '$29/month for up to 50 QR spots, or $59 without a limit. Every feature, no commission.',
    other: ['https://kalimenu.gr', 'el', 'Ελληνικά'], locale: 'en-US', currency: 'USD',
  },
};

// The main pages of each website, in menu order.
const CORE = ['home', 'features', 'pricing', 'how', 'faq', 'contact'];
const corePage = (market, id) => ({ id, kind: id, ...CONTENT[market].pages[id] });
const pathOf = (market, id) => CONTENT[market].pages[id].path;

/** Every page of a website: the main pages, then the pages for searches. */
export const sitePages = (market) => [...CORE.map((id) => corePage(market, id)), ...(LANDING[market] || []).map((p) => ({ ...p, kind: 'solution' }))];

/** The page at a path of a website, or null. */
export const pageFor = (market, path) => sitePages(market).find((p) => p.path === (path.replace(/\/+$/, '') || '/')) || null;

/** The same page on the other website (for the language links), or null. */
export const pairOfPage = (market, page) => sitePages(market === 'us' ? 'gr' : 'us').find((p) => p.id === page.id) || null;

/** When the texts of a page last changed (for the sitemap). */
export const updatedOf = (page) => (page.kind === 'solution' ? LANDING_UPDATED : SITE_UPDATED);

/** All paths of both websites (each route answers for the website it is asked on). */
export const allSitePaths = () => [...new Set(['gr', 'us'].flatMap((m) => sitePages(m).map((p) => p.path)))];

/** The questions shown on the home page (the first group), and all of them for the questions page. */
export const homeFaq = (market) => CONTENT[market].faq[0][1];
export const allFaq = (market) => CONTENT[market].faq.flatMap(([, list]) => list);

// Screenshots of the app: the shared copies, else the ones shipped with the site.
const SHIPPED = ['menu', 'menu-aegean', 'menu-cream', 'menu-lounge', 'pay', 'waiter', 'kitchen'];
const SIZE = { kitchen: [1600, 685], pay: [390, 745] };
function shot(market, key, alt, lazy = true) {
  const local = `/img/shot-${SHIPPED.includes(key) ? key : 'menu'}.jpg`;
  const sources = market === 'us' ? [`/assets/app2-us-${key}.jpg`, `/assets/app2-${key}.jpg`, local] : [`/assets/app2-${key}.jpg`, local];
  const [w, h] = SIZE[key] || [390, 844];
  return `<img src="${sources[0]}" data-fb="${sources.slice(1).join(',')}" onerror="fb(this)" alt="${esc(alt)}" width="${w}" height="${h}"${lazy ? ' loading="lazy"' : ''}>`;
}
const device = (market, key, alt, lazy = true) => `<div class="device ${key === 'kitchen' ? 'tablet' : 'phone'}">${shot(market, key, alt, lazy)}</div>`;
const themes = (market, alts) => `<div class="themes">${['menu-aegean', 'menu-cream', 'menu-lounge'].map((k, i) => device(market, k, alts[i])).join('')}</div>`;

const faqList = (list) => `<div class="faq-list">${list.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>`;
const checkList = (items) => `<ul class="checks">${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;

function pageHead(market, page, lead, { crumbs = true } = {}) {
  const t = W[market];
  const trail = page.kind === 'solution' ? [[t.home, '/'], [t.solutions, null], [page.name, null]] : [[t.home, '/'], [page.name, null]];
  return `<section class="page-head"><div class="wrap">
    ${crumbs ? `<nav class="crumbs" aria-label="breadcrumb">${trail.map(([l, href]) => (href ? `<a href="${href}">${esc(l)}</a>` : `<span>${esc(l)}</span>`)).join('<span class="sep">/</span>')}</nav>` : ''}
    <h1>${noEm(page.h1 || page.name)}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}
  </div></section>`;
}

function ctaBand(market) {
  const t = W[market];
  return `<section class="cta"><div class="wrap cta-in">
    <div><h2>${t.ctaTitle}</h2><p>${t.ctaText}</p></div>
    <div class="ctas"><a class="btn light" href="/signup">${t.start}</a><a class="btn outline-light" href="/demo">${t.demo}</a></div>
  </div></section>`;
}

// ---------------------------------------------------------------------------
// The pages
// ---------------------------------------------------------------------------
function home(market) {
  const c = CONTENT[market].home;
  const t = W[market];
  const alts = market === 'us' ? ['Menu in a blue theme', 'Menu in a cream theme', 'Menu in a dark theme'] : ['Μενού με το θέμα Αιγαίο', 'Μενού με το θέμα Κρεμ ταβέρνα', 'Μενού με σκούρο θέμα'];
  return `
  <section class="hero"><div class="wrap hero-grid">
    <div class="hero-text">
      <h1>${c.h1}</h1>
      <p class="lead">${c.lead}</p>
      <div class="ctas"><a class="btn primary" href="/signup">${t.start}</a><a class="btn secondary" href="/demo">${t.demo}</a></div>
      <p class="note">${c.note}</p>
    </div>
    <div class="hero-media">${device(market, 'menu', market === 'us' ? 'The guest menu on a phone' : 'Το μενού του πελάτη στο κινητό', false)}</div>
  </div></section>

  <section class="facts"><div class="wrap facts-row">${c.facts.map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join('')}</div></section>

  <section class="sec"><div class="wrap">
    <h2>${c.whatTitle}</h2>
    <div class="cols3">${c.what.map(([h, p, href, l]) => `<div class="col"><h3>${h}</h3><p>${p}</p><a class="more" href="${href}">${l}</a></div>`).join('')}</div>
  </div></section>

  <section class="sec soft"><div class="wrap split">
    <div class="split-media">${device(market, 'waiter', market === 'us' ? 'The server screen on a phone' : 'Η οθόνη του σερβιτόρου στο κινητό')}</div>
    <div class="split-text"><h2>${c.staffTitle}</h2><p>${c.staffText}</p><a class="more" href="${pathOf(market, 'features')}">${t.allFeatures}</a></div>
  </div></section>

  <section class="sec"><div class="wrap split rev">
    <div class="split-text"><h2>${c.kitchenTitle}</h2><p>${c.kitchenText}</p></div>
    <div class="split-media">${device(market, 'kitchen', market === 'us' ? 'The kitchen display on a tablet' : 'Η οθόνη της κουζίνας σε tablet')}</div>
  </div></section>

  <section class="sec soft"><div class="wrap split">
    <div class="split-media">${themes(market, alts)}</div>
    <div class="split-text"><h2>${c.lookTitle}</h2><p>${c.lookText}</p></div>
  </div></section>

  <section class="sec"><div class="wrap">
    <h2>${c.forTitle}</h2>
    <div class="cols4">${c.for.map(([h, p, href]) => `<a class="card-link" href="${href}"><h3>${h}</h3><p>${p}</p></a>`).join('')}</div>
  </div></section>

  <section class="sec soft"><div class="wrap price-row">
    <div><h2>${c.priceTitle}</h2><p>${c.priceText}</p></div>
    <div class="ctas"><a class="btn primary" href="/signup">${t.start}</a><a class="btn secondary" href="${pathOf(market, 'pricing')}">${t.seePrices}</a></div>
  </div></section>

  <section class="sec"><div class="wrap narrow">
    <h2>${c.faqTitle}</h2>
    ${faqList(homeFaq(market))}
    <p class="after"><a class="more" href="${pathOf(market, 'faq')}">${t.allFaq}</a></p>
  </div></section>
  ${ctaBand(market)}`;
}

function features(market) {
  const c = CONTENT[market].features;
  return `${pageHead(market, { ...corePage(market, 'features'), h1: c.h1 }, c.lead)}
  ${c.groups.map((g, i) => `<section class="sec ${i % 2 ? 'soft' : ''}"><div class="wrap split ${i % 2 ? 'rev' : ''} ${g.wide ? 'wide-media' : ''}">
    <div class="split-text"><h2>${g.title}</h2>
      <dl class="feature-list">${g.items.map(([h, p]) => `<dt>${h}</dt><dd>${p}</dd>`).join('')}</dl></div>
    <div class="split-media">${device(market, g.shot[0], g.shot[1])}</div>
  </div></section>`).join('')}
  ${related(market, null)}
  ${ctaBand(market)}`;
}

function pricing(market) {
  const c = CONTENT[market].pricing;
  const t = W[market];
  const fmt = (cents) => new Intl.NumberFormat(t.locale, { style: 'currency', currency: t.currency, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
  const plan = (key) => {
    const p = PLANS[key];
    const month = p.prices[t.currency];
    const best = key === 'pro';
    return `<div class="plan ${best ? 'best' : ''}">
      ${best ? `<span class="plan-tag">${t.popular}</span>` : ''}
      <h2>${p.name}</h2><p class="for">${c.plans[key].for}</p>
      <div class="price"><span class="m">${fmt(month)}</span><span class="y">${fmt(Math.round(month * 10 / 12))}</span><small>${c.perMonth}</small></div>
      <p class="per"><span class="m">${c.noContract}</span><span class="y">${fmt(month * 10)} ${c.perYear}</span></p>
      ${checkList(c.plans[key].items)}
      <a class="btn ${best ? 'primary' : 'secondary'} block" data-plan="${key}" href="/signup?plan=${key}&amp;interval=month">${c.cta}</a>
    </div>`;
  };
  return `${pageHead(market, { ...corePage(market, 'pricing'), h1: c.h1 }, c.lead)}
  <section class="sec"><div class="wrap">
    <div class="billing" role="group"><button type="button" data-b="month" class="active">${c.month}</button><button type="button" data-b="year">${c.year}</button></div>
    <div class="plans" data-billing="month">${plan('pro')}${plan('plus')}</div>
    <div class="extras"><h3>${c.extrasTitle}</h3>${checkList(c.extras)}</div>
  </div></section>
  <section class="sec soft"><div class="wrap">
    <h2>${c.cmpTitle}</h2>
    <div class="table-scroll"><table class="cmp"><thead><tr>${c.cmpHead.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${c.cmp.map((r, i) => `<tr class="${i ? '' : 'ours'}">${r.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="small muted">${c.cmpNote}</p>
  </div></section>
  <section class="sec"><div class="wrap narrow">
    <h2>${CONTENT[market].faq[2][0]}</h2>${faqList(CONTENT[market].faq[2][1])}
    <p class="after"><a class="more" href="${pathOf(market, 'faq')}">${t.allFaq}</a></p>
  </div></section>
  ${ctaBand(market)}`;
}

function how(market) {
  const c = CONTENT[market].how;
  return `${pageHead(market, { ...corePage(market, 'how'), h1: c.h1 }, c.lead)}
  <section class="sec"><div class="wrap narrow">
    <ol class="steps">${c.steps.map(([h, p]) => `<li><h2>${h}</h2><p>${p}</p></li>`).join('')}</ol>
  </div></section>
  <section class="sec soft"><div class="wrap two-cols">
    <div><h2>${c.needTitle}</h2>${checkList(c.need)}</div>
    <div><h2>${c.fiscalTitle}</h2><p>${c.fiscal}</p></div>
  </div></section>
  ${ctaBand(market)}`;
}

function faq(market) {
  const c = CONTENT[market].faqPage;
  return `${pageHead(market, { ...corePage(market, 'faq'), h1: c.h1 }, c.lead)}
  <section class="sec"><div class="wrap narrow">
    ${CONTENT[market].faq.map(([title, list]) => `<h2 class="faq-group">${title}</h2>${faqList(list)}`).join('')}
  </div></section>
  ${ctaBand(market)}`;
}

function contact(market) {
  const c = CONTENT[market].contact;
  const f = c.form;
  return `${pageHead(market, { ...corePage(market, 'contact'), h1: c.h1 }, c.lead)}
  <section class="sec"><div class="wrap contact-grid">
    <form class="contact-form" id="contactForm" data-sent="${esc(f.sent)}" data-error="${esc(f.error)}">
      <div class="two"><label class="field"><span>${f.name}</span><input class="input" name="name" maxlength="80" required autocomplete="name"></label>
        <label class="field"><span>${f.business}</span><input class="input" name="business" maxlength="120" autocomplete="organization"></label></div>
      <div class="two"><label class="field"><span>${f.email}</span><input class="input" type="email" name="email" maxlength="120" autocomplete="email"></label>
        <label class="field"><span>${f.phone}</span><input class="input" type="tel" name="phone" maxlength="40" autocomplete="tel"></label></div>
      <label class="field"><span>${f.message}</span><textarea class="input" name="message" rows="6" maxlength="3000" required></textarea></label>
      <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      <button class="btn primary">${f.send}</button>
      <p class="form-status" role="status"></p>
    </form>
    <aside class="contact-side">
      <div data-details hidden><h2>${c.detailsTitle}</h2>
        <p class="co" data-if="email"><a data-company-link="email"></a></p>
        <p class="co" data-if="phone"><a data-company-link="phone"></a></p>
        <p class="co muted" data-if="address"><span data-company="address"></span></p></div>
      <div class="note-box"><h2>${c.customersTitle}</h2><p>${c.customers}</p></div>
      <div class="note-box"><h2>${c.setupTitle}</h2><p>${c.setup}</p></div>
    </aside>
  </div></section>`;
}

function solution(market, page) {
  const t = W[market];
  const body = (s) => [(s.p || []).map((x) => `<p>${x}</p>`).join(''), s.ticks ? checkList(s.ticks) : ''].join('');
  // Sections alternate white and grey all the way down.
  let n = 0;
  const cls = () => `sec${n++ % 2 === 1 ? ' soft' : ''}`;
  const sections = page.sections.map((s) => {
    const k = n;
    if (s.shot) {
      const media = s.shot.kind === 'trio' ? `<div class="themes">${s.shot.keys.map(([k, alt]) => device(market, k, alt)).join('')}</div>`
        : device(market, s.shot.key, s.shot.alt);
      return `<section class="${cls()}"><div class="wrap split ${k % 4 === 3 ? 'rev' : ''} ${s.shot.kind === 'tablet' ? 'wide-media' : ''}">
        <div class="split-text"><h2>${s.h2}</h2>${body(s)}</div><div class="split-media">${media}</div></div></section>`;
    }
    return `<section class="${cls()}"><div class="wrap narrow"><h2>${s.h2}</h2>${body(s)}
      ${s.steps ? `<ol class="steps compact">${s.steps.map(([h, p]) => `<li><h3>${h}</h3><p>${p}</p></li>`).join('')}</ol>` : ''}
      ${s.cards ? `<dl class="feature-list two">${s.cards.map(([, h, p]) => `<div><dt>${h}</dt><dd>${p}</dd></div>`).join('')}</dl>` : ''}
      ${s.table ? `<div class="table-scroll"><table class="cmp"><thead><tr>${s.table.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${s.table.rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}
    </div></section>`;
  }).join('\n');
  return `<section class="page-head with-media"><div class="wrap hero-grid">
      <div class="hero-text">
        <nav class="crumbs" aria-label="breadcrumb"><a href="/">${esc(t.home)}</a><span class="sep">/</span><span>${esc(t.solutions)}</span><span class="sep">/</span><span>${esc(page.name)}</span></nav>
        <h1>${noEm(page.h1)}</h1><p class="lead">${page.lead}</p>
        <div class="ctas"><a class="btn primary" href="/signup">${t.start}</a><a class="btn secondary" href="/demo">${t.demo}</a></div>
      </div>
      <div class="hero-media">${device(market, page.hero.key, page.hero.alt, false)}</div>
    </div></section>
    ${sections}
    ${page.steps ? `<section class="${cls()}"><div class="wrap narrow"><h2>${t.stepsTitle}</h2><ol class="steps compact">${page.steps.map(([h, p]) => `<li><h3>${h}</h3><p>${p}</p></li>`).join('')}</ol></div></section>` : ''}
    <section class="${cls()}"><div class="wrap price-row">
      <div><h2>${t.priceTitle}</h2><p>${t.priceText}</p></div>
      <div class="ctas"><a class="btn primary" href="/signup">${t.start}</a><a class="btn secondary" href="${pathOf(market, 'pricing')}">${t.seePrices}</a></div>
    </div></section>
    <section class="${cls()}"><div class="wrap narrow"><h2>${market === 'us' ? 'Questions' : 'Ερωτήσεις'}</h2>${faqList(page.faq)}</div></section>
    ${related(market, page, cls())}
    ${ctaBand(market)}`;
}

function related(market, page, cls = 'sec') {
  const t = W[market];
  const others = (LANDING[market] || []).filter((p) => p !== page && p.id !== page?.id);
  return `<section class="${cls}"><div class="wrap">
    <h2>${page ? t.related : t.solutions}</h2>
    <div class="cols3 links">${others.map((p) => `<a class="card-link" href="${p.path}"><h3>${esc(p.name)}</h3><p>${esc(p.blurb)}</p></a>`).join('')}</div>
  </div></section>`;
}

const BODY = { home, features, pricing, how, faq, contact };

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
function header(market, page) {
  const t = W[market];
  const active = (id) => (page.id === id && page.kind !== 'solution' ? ' class="active" aria-current="page"' : '');
  const link = (id) => `<a href="${pathOf(market, id)}"${active(id)}>${CONTENT[market].pages[id].name}</a>`;
  return `<header class="sh" id="top"><div class="wrap sh-in">
    <a class="sh-logo" href="/"><img src="/brand/logo.svg" alt="Kalimenu" width="136" height="27"></a>
    <button class="sh-burger" type="button" aria-controls="siteNav" aria-expanded="false"><span class="bars" aria-hidden="true"></span><span class="label">${t.menu}</span></button>
    <nav class="sh-nav" id="siteNav">
      ${link('features')}
      <div class="sh-drop${page.kind === 'solution' ? ' active' : ''}">
        <button type="button" class="sh-drop-btn" aria-expanded="false">${t.solutions}</button>
        <div class="sh-menu">${(LANDING[market] || []).map((p) => `<a href="${p.path}"${p.id === page.id && page.kind === 'solution' ? ' aria-current="page"' : ''}><b>${esc(p.name)}</b><span>${esc(p.blurb)}</span></a>`).join('')}</div>
      </div>
      ${link('pricing')}${link('how')}${link('faq')}${link('contact')}
      <span class="sh-end"><a class="sh-login" href="/login">${t.login}</a><a class="btn primary sm" href="/signup">${t.trial}</a></span>
    </nav>
  </div></header>`;
}

function footer(market) {
  const t = W[market];
  const [otherUrl, otherLang, otherName] = t.other;
  const nav = (ids) => ids.map((id) => `<a href="${pathOf(market, id)}">${CONTENT[market].pages[id].name}</a>`).join('');
  return `<footer class="sf"><div class="wrap sf-grid">
    <div class="sf-brand"><img src="/brand/logo-white.svg" alt="Kalimenu" width="133" height="26"><p>${t.tag}</p></div>
    <nav><b>${t.product}</b>${nav(['features', 'pricing', 'how'])}<a href="/demo">Demo</a></nav>
    <nav><b>${t.solutions}</b>${(LANDING[market] || []).map((p) => `<a href="${p.path}">${esc(p.name)}</a>`).join('')}</nav>
    <nav><b>${t.help}</b>${nav(['faq', 'contact'])}<a href="/login">${t.login}</a><a href="/signup">${t.trial}</a></nav>
    <nav><b>${t.legal}</b><a href="/terms">${t.terms}</a><a href="/privacy">${t.privacy}</a>${market === 'us' ? '' : `<a href="/dpa">${t.dpa}</a>`}<a href="/cookies">${t.cookies}</a><a href="#" data-cookie-settings>${t.cookieSettings}</a></nav>
  </div>
  <div class="wrap sf-bottom">
    <span>© <span id="year"></span> Kalimenu<span data-if="name"> · <span data-company="name"></span></span>${market === 'us' ? '' : `<span data-if="vat"> · ${t.vat} <span data-company="vat"></span></span><span data-if="gemi"> · ${t.gemi} <span data-company="gemi"></span></span>`}</span>
    <span><a href="${otherUrl}" hreflang="${otherLang}" translate="no">${otherName}</a> · <a class="walkup" href="https://walkupdigital.com" target="_blank" rel="noopener"><img src="/brand/walkup-mark.png" alt="" width="22" height="15">Designed by walkupdigital.com</a></span>
  </div></footer>`;
}

/** The whole HTML of a website page; `head` are the search engine tags added by seo.js. */
export function renderPage(market, page, head) {
  const t = W[market];
  const main = page.kind === 'solution' ? solution(market, page) : BODY[page.kind](market);
  return `<!doctype html>
<html lang="${t.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.description)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#ffffff">
  ${head}
  <link rel="preload" href="/fonts/manrope-${market === 'us' ? 'latin' : 'greek'}-700-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/css/app.css">
  <link rel="stylesheet" href="/css/site.css">
  <script>
    // Screenshots: the shared copies, else the ones shipped with the site.
    function fb(img) { const next = (img.dataset.fb || '').split(',').filter(Boolean); if (!next.length) { img.onerror = null; return; } img.src = next.shift(); img.dataset.fb = next.join(','); }
  </script>
</head>
<body class="site page-${page.kind}">
  ${header(market, page)}
  <main>${main}</main>
  ${footer(market)}
  <script type="module" src="/js/site-page.js"></script>
</body>
</html>
`;
}
