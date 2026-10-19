// The website pages of kalimenu.gr (Greek) and kalimenu.com (English), built on the server with one layout: a header
// with the main menu, the page, and a footer. Pages: home, features, pricing, how it works, questions, contact
// (texts in site-content.js) and the pages for searches (/qr-menu…, texts in landing.js). The search engine tags of
// each page are added by seo.js; the look is in public/css/site.css and the behaviour in public/js/site-page.js.
import { PLANS } from './plans.js';
import { LANDING, LANDING_UPDATED } from './landing.js';
import { CONTENT, SITE_UPDATED } from './site-content.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');

// Words of the layout in each language.
const W = {
  gr: {
    lang: 'el', home: 'Αρχική', solutions: 'Λύσεις', login: 'Σύνδεση', trial: 'Δοκιμή δωρεάν', menu: 'Μενού', close: 'Κλείσιμο',
    start: 'Ξεκινήστε δωρεάν', demo: 'Δείτε το demo', allFaq: 'Όλες οι ερωτήσεις', seePrices: 'Δείτε τις τιμές',
    allFeatures: 'Όλες οι λειτουργίες', related: 'Δείτε επίσης', stepsTitle: 'Έτοιμο σε ένα απόγευμα', questions: 'Ερωτήσεις',
    ctaTitle: 'Δοκιμάστε το στο <em>κατάστημά σας.</em>',
    ctaText: '14 ημέρες δωρεάν, χωρίς κάρτα και χωρίς δέσμευση. Αν θέλετε, περνάμε εμείς το μενού σας.',
    tag: 'Ψηφιακό μενού, παραγγελία και πληρωμή από το τραπέζι, για την ελληνική εστίαση.',
    product: 'Προϊόν', help: 'Βοήθεια', legal: 'Νομικά', terms: 'Όροι χρήσης', privacy: 'Απόρρητο', dpa: 'Επεξεργασία δεδομένων',
    cookies: 'Cookies', cookieSettings: 'Ρυθμίσεις cookies', vat: 'ΑΦΜ', gemi: 'ΓΕΜΗ', popular: 'Το πιο συχνό', top: 'Επάνω',
    skip: 'Μετάβαση στο περιεχόμενο',
    priceTitle: 'Πόσο κοστίζει', priceText: '€14,90 τον μήνα για έως 50 θέσεις με QR, ή €29,90 χωρίς όριο. Όλες οι λειτουργίες, χωρίς προμήθεια. Οι τιμές δεν περιλαμβάνουν ΦΠΑ.',
    other: ['https://kalimenu.com', 'en', 'English'], locale: 'el-GR', currency: 'EUR',
    shots: { menu: 'Το μενού του πελάτη στο κινητό', kitchen: 'Η οθόνη της κουζίνας σε tablet', themes: ['Μενού με το θέμα Αιγαίο', 'Μενού με το θέμα Κρεμ ταβέρνα', 'Μενού με σκούρο θέμα'] },
  },
  us: {
    lang: 'en', home: 'Home', solutions: 'Solutions', login: 'Sign in', trial: 'Start free', menu: 'Menu', close: 'Close',
    start: 'Start your free trial', demo: 'See the demo', allFaq: 'All questions', seePrices: 'See pricing',
    allFeatures: 'All features', related: 'Read more', stepsTitle: 'Up and running in an afternoon', questions: 'Questions',
    ctaTitle: 'Try it in your <em>restaurant.</em>',
    ctaText: '14 days free, no credit card and no contract. We can set up your menu for you.',
    tag: 'QR menus and ordering from the table, for restaurants, bars and hotels.',
    product: 'Product', help: 'Help', legal: 'Legal', terms: 'Terms', privacy: 'Privacy', dpa: 'Data processing',
    cookies: 'Cookies', cookieSettings: 'Your privacy choices', popular: 'Most popular', top: 'Back to top',
    skip: 'Skip to content',
    priceTitle: 'What it costs', priceText: '$29/month for up to 50 QR spots, or $59 without a limit. Every feature, no commission.',
    other: ['https://kalimenu.gr', 'el', 'Ελληνικά'], locale: 'en-US', currency: 'USD',
    shots: { menu: 'The guest menu on a phone', kitchen: 'The kitchen display on a tablet', themes: ['Menu in a blue theme', 'Menu in a cream theme', 'Menu in a dark theme'] },
  },
};
// "Enjoy your meal" in the 8 languages of the menu, for the moving line under the first screen.
const BON_APPETIT = [['el', 'Καλή όρεξη'], ['en', 'Enjoy your meal'], ['de', 'Guten Appetit'], ['fr', 'Bon appétit'], ['it', 'Buon appetito'],
  ['es', '¡Buen provecho!'], ['nl', 'Eet smakelijk'], ['pl', 'Smacznego']];

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

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
// Big titles: every word in its own box, so the words can rise into place one after the other (site.css).
// <em> keeps its words, set in italics.
function words(html) {
  let i = 0;
  return String(html).split(/(<\/?em>)/).map((part) => (/^<\/?em>$/.test(part) ? part : part.split(/(\s+)/)
    .map((w) => (!w ? '' : /^\s+$/.test(w) ? ' ' : `<span class="w"><span style="--i:${i++}">${w}</span></span>`)).join(''))).join('');
}

// Screenshots of the app: the shared copies, else the ones shipped with the site.
const SHIPPED = ['menu', 'menu-aegean', 'menu-cream', 'menu-lounge', 'pay', 'waiter', 'kitchen'];
const SIZE = { kitchen: [1600, 685], pay: [390, 745] };
function shot(market, key, alt, { lazy = true, cls = '' } = {}) {
  const local = `/img/shot-${SHIPPED.includes(key) ? key : 'menu'}.jpg`;
  const sources = market === 'us' ? [`/assets/app2-us-${key}.jpg`, `/assets/app2-${key}.jpg`, local] : [`/assets/app2-${key}.jpg`, local];
  const [w, h] = SIZE[key] || [390, 844];
  return `<img${cls ? ` class="${cls}"` : ''} src="${sources[0]}" data-fb="${sources.slice(1).join(',')}" onerror="fb(this)" alt="${esc(alt)}" width="${w}" height="${h}"${lazy ? ' loading="lazy"' : ''} decoding="async">`;
}
const device = (market, key, alt, opts = {}) => `<div class="device ${key === 'kitchen' ? 'tablet' : 'phone'}">${shot(market, key, alt, opts)}</div>`;
const themes = (market, alts) => `<div class="themes">${['menu-aegean', 'menu-cream', 'menu-lounge'].map((k, i) => device(market, k, alts[i])).join('')}</div>`;

const faqList = (list) => `<div class="faq-list">${list.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>`;
const checkList = (items) => `<ul class="checks">${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
const arrow = '<svg class="arr" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const button = (cls, href, label) => `<a class="btn ${cls}" href="${href}"><span>${label}</span>${arrow}</a>`;
// The heading of a section: its number and title.
const head = (n, title, extra = '') => `<header class="sec-head rise"><span class="idx">(${pad(n)})</span><h2>${title}</h2>${extra}</header>`;

function pageHead(market, page, lead) {
  const t = W[market];
  const trail = [[t.home, '/'], [page.name, null]];
  return `<section class="page-head"><div class="wrap">
    <nav class="crumbs" aria-label="breadcrumb">${trail.map(([l, href]) => (href ? `<a href="${href}">${esc(l)}</a>` : `<span>${esc(l)}</span>`)).join('<span class="sep">/</span>')}</nav>
    <h1 class="display">${words(page.h1 || page.name)}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}
  </div></section>`;
}

function finale(market) {
  const t = W[market];
  return `<section class="finale"><div class="wrap">
    <h2 class="display rise">${t.ctaTitle}</h2>
    <div class="finale-row rise"><p>${t.ctaText}</p>
      <div class="ctas">${button('light', '/signup', t.start)}${button('outline-light', '/demo', t.demo)}</div></div>
  </div></section>`;
}

// ---------------------------------------------------------------------------
// The pages
// ---------------------------------------------------------------------------
const money = (market, cents) => {
  const t = W[market];
  return new Intl.NumberFormat(t.locale, { style: 'currency', currency: t.currency, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
};

function home(market) {
  const c = CONTENT[market].home;
  const t = W[market];
  const steps = c.story.steps;
  const loop = BON_APPETIT.map(([lang, text]) => `<span lang="${lang}">${text}</span><i aria-hidden="true"></i>`).join('');
  return `
  <section class="hero"><div class="wrap">
    <h1 class="display">${words(c.h1)}</h1>
    <div class="hero-grid">
      <div class="hero-copy">
        <p class="lead">${c.lead}</p>
        <div class="ctas">${button('primary', '/signup', t.start)}${button('secondary', '/demo', t.demo)}</div>
        <p class="note">${c.note}</p>
      </div>
      <aside class="scan">
        <img src="/demo-qr.svg" width="112" height="112" alt="${esc(c.scan.alt)}">
        <div><b>${c.scan.title}</b><p>${c.scan.text}</p></div>
      </aside>
      <div class="hero-phone">${device(market, 'menu', t.shots.menu, { lazy: false })}</div>
    </div>
  </div></section>

  <section class="marquee" aria-label="${esc(c.marqueeLabel)}"><div class="marquee-track"><div>${loop}</div><div aria-hidden="true">${loop}</div></div></section>

  <section class="sec story"><div class="wrap">
    ${head(1, c.story.title)}
    <div class="story-grid">
      <div class="story-stage" aria-hidden="true">
        <div class="device phone stage">${steps.map(([key, , , alt], i) => shot(market, key, alt, { lazy: i > 0, cls: `screen${i ? '' : ' on'}` })).join('')}</div>
        <ol class="story-dots">${steps.map((s, i) => `<li class="${i ? '' : 'on'}"></li>`).join('')}</ol>
      </div>
      <ol class="story-steps">${steps.map(([key, h, p, alt], i) => `<li data-step="${i}" class="${i ? '' : 'on'}">
        <span class="n">${pad(i + 1)}</span><h3>${h}</h3><p>${p}</p>
        <div class="device phone inline">${shot(market, key, alt)}</div></li>`).join('')}</ol>
    </div>
  </div></section>

  <section class="sec dark kitchen"><div class="wrap">
    ${head(2, c.kitchenTitle)}
    <div class="kitchen-row rise"><p class="lead">${c.kitchenText}</p><a class="more" href="${pathOf(market, 'features')}">${t.allFeatures}</a></div>
    <div class="kitchen-shot rise">${device(market, 'kitchen', t.shots.kitchen)}</div>
  </div></section>

  <section class="sec looks"><div class="wrap looks-grid">
    <div>${head(3, c.lookTitle)}<p class="lead rise">${c.lookText}</p></div>
    ${themes(market, t.shots.themes)}
  </div></section>

  <section class="sec soft"><div class="wrap">
    ${head(4, c.card.title)}
    <div class="menu-card rise">
      <p class="mc-title">${c.card.heading}</p>
      ${c.card.groups.map(([g, items]) => `<h3>${g}</h3><ul>${items.map((x) => `<li><span>${x}</span><i aria-hidden="true"></i><b>${c.card.value}</b></li>`).join('')}</ul>`).join('')}
      <p class="mc-total"><span>${c.card.total}</span><i aria-hidden="true"></i><b>${money(market, PLANS.pro.prices[t.currency])}<small>${CONTENT[market].pricing.perMonth}</small></b></p>
      <p class="mc-note">${c.card.note}</p>
      <div class="ctas">${button('primary', '/signup', t.start)}${button('secondary', pathOf(market, 'pricing'), t.seePrices)}</div>
    </div>
  </div></section>

  <section class="sec"><div class="wrap">
    ${head(5, c.forTitle)}
    <ul class="rows">${c.for.map(([h, p, href], i) => `<li class="rise"><a href="${href}"><span class="r-n">${pad(i + 1)}</span><span class="r-h">${h}</span><span class="r-p">${p}</span>${arrow}</a></li>`).join('')}</ul>
  </div></section>

  <section class="facts"><div class="wrap facts-row">${c.facts.map(([n, l]) => `<div class="rise"><b>${n}</b><span>${l}</span></div>`).join('')}</div></section>

  <section class="sec"><div class="wrap faq-grid">
    ${head(6, c.faqTitle, `<a class="more" href="${pathOf(market, 'faq')}">${t.allFaq}</a>`)}
    ${faqList(homeFaq(market))}
  </div></section>
  ${finale(market)}`;
}

function features(market) {
  const c = CONTENT[market].features;
  return `${pageHead(market, { ...corePage(market, 'features'), h1: c.h1 }, c.lead)}
  ${c.groups.map((g, i) => `<section class="sec ${i % 2 ? 'soft' : ''}"><div class="wrap">
    ${head(i + 1, g.title)}
    <div class="split ${i % 2 ? 'rev' : ''} ${g.wide ? 'wide-media' : ''}">
      <dl class="feature-list rise">${g.items.map(([h, p]) => `<div><dt>${h}</dt><dd>${p}</dd></div>`).join('')}</dl>
      <div class="split-media rise">${device(market, g.shot[0], g.shot[1])}</div>
    </div>
  </div></section>`).join('')}
  ${related(market, null)}
  ${finale(market)}`;
}

function pricing(market) {
  const c = CONTENT[market].pricing;
  const t = W[market];
  const plan = (key) => {
    const p = PLANS[key];
    const month = p.prices[t.currency];
    const best = key === 'pro';
    return `<div class="plan ${best ? 'best' : ''} rise">
      <div class="plan-top"><h2>${p.name}</h2>${best ? `<span class="plan-tag">${t.popular}</span>` : ''}</div>
      <p class="for">${c.plans[key].for}</p>
      <div class="price"><span class="m">${money(market, month)}</span><span class="y">${money(market, Math.round(month * 10 / 12))}</span><small>${c.perMonth}</small></div>
      <p class="per"><span class="m">${c.noContract}</span><span class="y">${money(market, month * 10)} ${c.perYear}</span></p>
      ${checkList(c.plans[key].items)}
      <a class="btn ${best ? 'light' : 'primary'} block" data-plan="${key}" href="/signup?plan=${key}&amp;interval=month"><span>${c.cta}</span>${arrow}</a>
    </div>`;
  };
  return `${pageHead(market, { ...corePage(market, 'pricing'), h1: c.h1 }, c.lead)}
  <section class="sec"><div class="wrap">
    <div class="billing" role="group"><button type="button" data-b="month" class="active" aria-pressed="true">${c.month}</button><button type="button" data-b="year" aria-pressed="false">${c.year}</button></div>
    <div class="plans" data-billing="month">${plan('pro')}${plan('plus')}</div>
    <div class="extras rise"><h3>${c.extrasTitle}</h3>${checkList(c.extras)}</div>
  </div></section>
  <section class="sec soft"><div class="wrap">
    ${head(1, c.cmpTitle)}
    <div class="table-scroll rise"><table class="cmp"><thead><tr>${c.cmpHead.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${c.cmp.map((r, i) => `<tr class="${i ? '' : 'ours'}">${r.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="small muted">${c.cmpNote}</p>
  </div></section>
  <section class="sec"><div class="wrap faq-grid">
    ${head(2, CONTENT[market].faq[2][0], `<a class="more" href="${pathOf(market, 'faq')}">${t.allFaq}</a>`)}
    ${faqList(CONTENT[market].faq[2][1])}
  </div></section>
  ${finale(market)}`;
}

function how(market) {
  const c = CONTENT[market].how;
  return `${pageHead(market, { ...corePage(market, 'how'), h1: c.h1 }, c.lead)}
  <section class="sec"><div class="wrap">
    <ol class="steps">${c.steps.map(([h, p], i) => `<li class="rise"><span class="n">${pad(i + 1)}</span><h2>${h}</h2><p>${p}</p></li>`).join('')}</ol>
  </div></section>
  <section class="sec dark"><div class="wrap two-cols">
    <div class="rise"><h2>${c.needTitle}</h2>${checkList(c.need)}</div>
    <div class="rise"><h2>${c.fiscalTitle}</h2><p>${c.fiscal}</p></div>
  </div></section>
  ${finale(market)}`;
}

function faq(market) {
  const c = CONTENT[market].faqPage;
  return `${pageHead(market, { ...corePage(market, 'faq'), h1: c.h1 }, c.lead)}
  ${CONTENT[market].faq.map(([title, list], i) => `<section class="sec ${i % 2 ? 'soft' : ''}"><div class="wrap faq-grid">
    ${head(i + 1, title)}${faqList(list)}
  </div></section>`).join('')}
  ${finale(market)}`;
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
      <label class="field"><span>${f.message}</span><textarea class="input" name="message" rows="5" maxlength="3000" required></textarea></label>
      <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      <button class="btn primary"><span>${f.send}</span>${arrow}</button>
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
  const stepList = (list) => `<ol class="steps compact">${list.map(([h, p], i) => `<li><span class="n">${pad(i + 1)}</span><h3>${h}</h3><p>${p}</p></li>`).join('')}</ol>`;
  // Sections are numbered and alternate white and grey all the way down.
  let n = 0;
  const section = (title, inner, wrapCls = '') => {
    const k = n++;
    return `<section class="sec${k % 2 ? ' soft' : ''}"><div class="wrap ${wrapCls}">${head(k + 1, title)}${inner}</div></section>`;
  };
  const sections = page.sections.map((s) => {
    if (s.shot) {
      const media = s.shot.kind === 'trio' ? `<div class="themes">${s.shot.keys.map(([key, alt]) => device(market, key, alt)).join('')}</div>`
        : device(market, s.shot.key, s.shot.alt);
      return section(s.h2, `<div class="split ${n % 4 === 3 ? 'rev' : ''} ${s.shot.kind === 'tablet' ? 'wide-media' : ''}">
        <div class="split-text rise">${body(s)}</div><div class="split-media rise">${media}</div></div>`);
    }
    return section(s.h2, `<div class="narrow rise">${body(s)}
      ${s.steps ? stepList(s.steps) : ''}
      ${s.cards ? `<dl class="feature-list two">${s.cards.map(([, h, p]) => `<div><dt>${h}</dt><dd>${p}</dd></div>`).join('')}</dl>` : ''}
      ${s.table ? `<div class="table-scroll"><table class="cmp"><thead><tr>${s.table.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${s.table.rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}
    </div>`);
  });
  if (page.steps) sections.push(section(t.stepsTitle, `<div class="narrow rise">${stepList(page.steps)}</div>`));
  sections.push(section(t.priceTitle, `<div class="price-row rise"><p>${t.priceText}</p>
    <div class="ctas">${button('primary', '/signup', t.start)}${button('secondary', pathOf(market, 'pricing'), t.seePrices)}</div></div>`));
  sections.push(section(t.questions, faqList(page.faq), 'faq-grid'));
  return `<section class="page-head with-media"><div class="wrap hero-grid">
      <div class="hero-text">
        <nav class="crumbs" aria-label="breadcrumb"><a href="/">${esc(t.home)}</a><span class="sep">/</span><span>${esc(t.solutions)}</span><span class="sep">/</span><span>${esc(page.name)}</span></nav>
        <h1 class="display">${words(page.h1)}</h1><p class="lead">${page.lead}</p>
        <div class="ctas">${button('primary', '/signup', t.start)}${button('secondary', '/demo', t.demo)}</div>
      </div>
      <div class="hero-phone">${device(market, page.hero.key, page.hero.alt, { lazy: false })}</div>
    </div></section>
    ${sections.join('\n')}
    ${related(market, page)}
    ${finale(market)}`;
}

function related(market, page) {
  const t = W[market];
  const others = (LANDING[market] || []).filter((p) => p.id !== page?.id);
  return `<section class="sec related"><div class="wrap">
    <h2 class="rise">${page ? t.related : t.solutions}</h2>
    <ul class="rows small-rows">${others.map((p, i) => `<li class="rise"><a href="${p.path}"><span class="r-n">${pad(i + 1)}</span><span class="r-h">${esc(p.name)}</span><span class="r-p">${esc(p.blurb)}</span>${arrow}</a></li>`).join('')}</ul>
  </div></section>`;
}

const BODY = { home, features, pricing, how, faq, contact };

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
/**
 * The header of every page of the websites: the main pages here, and sign-up, login, demo and the legal pages, where
 * seo.js puts it in place of their own short bar (with no page of the menu marked).
 */
export function siteHeader(market, page = { id: '', kind: 'page' }) {
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
      <span class="sh-end"><a class="sh-login" href="/login">${t.login}</a>${button('primary sm', '/signup', t.trial)}</span>
    </nav>
  </div></header>`;
}

const globe = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2.8 12h18.4M12 2.8c2.6 2.6 3.9 5.6 3.9 9.2s-1.3 6.6-3.9 9.2c-2.6-2.6-3.9-5.6-3.9-9.2s1.3-6.6 3.9-9.2z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

/**
 * The footer of every page of the websites: the main pages here, and sign-up, login, demo and the legal pages, where
 * seo.js puts it in place of their own short line. The company details come from /api/site (legal.js).
 */
export function siteFooter(market) {
  const t = W[market];
  const [otherUrl, otherLang, otherName] = t.other;
  const nav = (ids) => ids.map((id) => `<a href="${pathOf(market, id)}">${CONTENT[market].pages[id].name}</a>`).join('');
  return `<footer class="sf"><div class="sf-in">
    <div class="sf-top">
      <div class="sf-brand">
        <a class="sf-logo" href="/"><img src="/brand/logo-white.svg" alt="Kalimenu" width="140" height="27" loading="lazy"></a>
        <p>${t.tag}</p>
        <p class="sf-contact" data-if="email"><a data-company-link="email"></a></p>
        <p class="sf-contact" data-if="phone"><a data-company-link="phone"></a></p>
        <a class="sf-lang" href="${otherUrl}" hreflang="${otherLang}" translate="no">${globe}${otherName}</a>
      </div>
      <nav><b>${t.product}</b>${nav(['features', 'pricing', 'how'])}<a href="/demo">Demo</a></nav>
      <nav><b>${t.solutions}</b>${(LANDING[market] || []).map((p) => `<a href="${p.path}">${esc(p.name)}</a>`).join('')}</nav>
      <nav><b>${t.help}</b>${nav(['faq', 'contact'])}<a href="/login">${t.login}</a><a href="/signup">${t.trial}</a></nav>
      <nav><b>${t.legal}</b><a href="/terms">${t.terms}</a><a href="/privacy">${t.privacy}</a>${market === 'us' ? '' : `<a href="/dpa">${t.dpa}</a>`}<a href="/cookies">${t.cookies}</a><a href="#" data-cookie-settings>${t.cookieSettings}</a></nav>
    </div>
    <div class="sf-bottom">
      <span>© <span id="year">${new Date().getFullYear()}</span> Kalimenu<span data-if="name"> · <span data-company="name"></span></span>${market === 'us' ? '' : `<span data-if="vat"> · ${t.vat} <span data-company="vat"></span></span><span data-if="gemi"> · ${t.gemi} <span data-company="gemi"></span></span>`}<span data-if="address"> · <span data-company="address"></span></span></span>
      <span class="sf-credits"><a class="walkup" href="https://walkupdigital.com" target="_blank" rel="noopener"><img src="/brand/walkup-mark.png" alt="" width="22" height="15">Designed by walkupdigital.com</a><a class="sf-up" href="#">${t.top} ↑</a></span>
    </div>
  </div></footer>`;
}

/** The whole HTML of a website page; `head` are the search engine tags added by seo.js. */
export function renderPage(market, page, head) {
  const t = W[market];
  const main = page.kind === 'solution' ? solution(market, page) : BODY[page.kind](market);
  const script = market === 'us' ? 'latin' : 'greek';
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
  <link rel="preload" href="/fonts/ysabeau-${script}-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/css/app.css">
  <link rel="stylesheet" href="/css/site.css">
  <link rel="stylesheet" href="/css/header.css">
  <link rel="stylesheet" href="/css/footer.css">
  <script>
    document.documentElement.classList.add('js');
    // Screenshots: the shared copies, else the ones shipped with the site.
    function fb(img) { const next = (img.dataset.fb || '').split(',').filter(Boolean); if (!next.length) { img.onerror = null; return; } img.src = next.shift(); img.dataset.fb = next.join(','); }
  </script>
</head>
<body class="site page-${page.kind}">
  <a class="skip" href="#main">${t.skip}</a>
  ${siteHeader(market, page)}
  <main id="main">${main}</main>
  ${siteFooter(market)}
  <script type="module" src="/js/site-page.js"></script>
</body>
</html>
`;
}
