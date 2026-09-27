import { $, $$, esc, api, toast, sheet, stream } from './util.js';
import { LANGUAGES, STRINGS, pick, money } from './i18n.js';
import { icon } from './icons.js';

const token = location.pathname.split('/').filter(Boolean)[1];
const CART_KEY = `cart:${token}`;
const LANG_KEY = 'lang';

const S = {
  data: null,
  lang: 'el',
  tab: 'menu',
  filter: 'all',
  query: '',
  cart: load(CART_KEY, []),
  state: { orders: [], calls: [], bill: { total: 0, paid: 0, due: 0 } },
  seenOrders: 0,
  receipt: load(`receipt:${token}`, null),
};

function load(key, fallback) {
  try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveCart() {
  try { sessionStorage.setItem(CART_KEY, JSON.stringify(S.cart)); } catch { /* private mode */ }
}

const t = (key) => STRINGS[S.lang]?.[key] ?? STRINGS.en[key] ?? key;
const tr = (obj) => pick(obj, S.lang, S.data?.defaultLanguage);
const fmt = (c) => money(c, S.lang);
const itemById = (id) => S.data.items.find((i) => i.id === id);
const spot = () => `${t(S.data.table.kind || 'table')} ${S.data.table.label}`;
const callLabel = () => (S.data.table.kind === 'table' ? t('callWaiter') : t('callService'));

function errorText(e) {
  if (e.code === 'too_many_requests') return t('tooMany');
  if (e.code === 'item_unavailable') return t('itemUnavailable');
  if (e.code === 'invalid_table') return t('invalidTable');
  if (e.code === 'option_required' || e.code === 'bad_option') return t('chooseRequired');
  return t('error');
}

// Venue colour: buttons, active tabs and highlights use it; text on it is white or black for contrast.
function applyBrand(hex = '#1f3a5f') {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  document.documentElement.style.setProperty('--brand', hex);
  document.documentElement.style.setProperty('--brand-ink', lum > 0.45 ? '#1a1a1a' : '#ffffff');
}

function setFavicon(url) {
  if (!url) return;
  let link = document.querySelector('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.append(link); }
  link.href = url;
  let apple = document.querySelector('link[rel="apple-touch-icon"]');
  if (!apple) { apple = document.createElement('link'); apple.rel = 'apple-touch-icon'; document.head.append(apple); }
  apple.href = url;
}

// Price of one unit of a cart line: dish price plus the chosen options.
function unitPrice(line) {
  const item = itemById(line.id);
  if (!item) return 0;
  return item.price_cents + (line.options || []).reduce((sum, [g, c]) => sum + (item.options?.[g]?.choices?.[c]?.price_cents || 0), 0);
}
const optionText = (item, picks = []) => picks
  .map(([g, c]) => item.options?.[g]?.choices?.[c])
  .filter(Boolean)
  .map((c) => `${tr(c.name)}${c.price_cents ? ` +${fmt(c.price_cents)}` : ''}`)
  .join(', ');

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  try {
    S.data = await api(`/api/public/table/${token}`);
  } catch (e) {
    const lang = (navigator.language || 'en').slice(0, 2);
    S.lang = STRINGS[lang] ? lang : 'en';
    $('#app').innerHTML = `<div class="empty">${icon('qr', 36)}<p>${esc(e.code === 'invalid_table' ? t('invalidTable') : t('error'))}</p></div>`;
    return;
  }
  S.lang = chooseLanguage();
  document.title = S.data.restaurant.name;
  applyBrand(S.data.restaurant.brandColor);
  setFavicon(S.data.restaurant.logoUrl);
  $('#bottom').hidden = false;
  bindChrome();
  // The venue name appears in the top bar once the big header has scrolled away.
  const syncTop = () => $('.top').classList.toggle('scrolled', S.tab !== 'menu' || window.scrollY > 90);
  window.addEventListener('scroll', syncTop, { passive: true });
  document.addEventListener('click', () => requestAnimationFrame(syncTop));
  syncTop();
  renderAll();

  stream(`/api/public/table/${token}/stream`, { state: onState, menu: refreshMenu, receipt: onReceipt }, (online) => {
    const el = $('#offline');
    el.hidden = online;
    el.textContent = t('offline');
  });
}

function chooseLanguage() {
  const available = S.data.languages;
  let saved;
  try { saved = localStorage.getItem(LANG_KEY); } catch { /* ignore */ }
  if (saved && available.includes(saved)) return saved;
  for (const l of navigator.languages || [navigator.language]) {
    const code = String(l).slice(0, 2).toLowerCase();
    if (available.includes(code)) return code;
  }
  return available.includes('en') ? 'en' : S.data.defaultLanguage;
}

async function refreshMenu() {
  try {
    S.data = await api(`/api/public/table/${token}`);
    if (!S.data.languages.includes(S.lang)) S.lang = chooseLanguage();
    applyBrand(S.data.restaurant.brandColor);
    // Drop cart lines (or option picks) that no longer exist after the owner edited the menu.
    S.cart = S.cart.filter((l) => itemById(l.id)).map((l) => ({
      ...l, options: (l.options || []).filter(([g, c]) => itemById(l.id).options?.[g]?.choices?.[c]),
    }));
    saveCart();
    renderAll(true);
  } catch { /* keep current menu */ }
}

function onReceipt(r) {
  S.receipt = r;
  try { sessionStorage.setItem(`receipt:${token}`, JSON.stringify(r)); } catch { /* ignore */ }
  toast(t('receiptReady'), 'ok');
  switchTab('order');
}

const receiptCard = () => (S.receipt ? `<div class="receipt-card">
    <div><b>${esc(t('receipt'))}</b><span class="muted small">Νο ${esc(S.receipt.number)}</span></div>
    <a class="btn secondary sm" href="${esc(S.receipt.url)}?lang=${S.lang}" target="_blank">${esc(t('viewReceipt'))}</a>
  </div>` : '');

function onState(state) {
  const prev = new Map(S.state.orders.map((o) => [o.id, o.status]));
  S.state = state;
  for (const o of state.orders) {
    const before = prev.get(o.id);
    if (before && before !== o.status) {
      if (o.status === 'ready') { toast(t('status_ready'), 'ok'); navigator.vibrate?.(200); }
      else if (o.status === 'accepted' && before === 'pending') toast(`${t('order')} #${o.id}: ${t('status_accepted')}`, 'ok');
      else if (o.status === 'rejected') toast(`${t('order')} #${o.id}: ${t('status_rejected')}`, 'err');
    }
  }
  renderBottom();
  if (S.tab === 'order') renderOrder();
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------
function bindChrome() {
  $('#langBtn').addEventListener('click', openLanguages);
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#cartBar').addEventListener('click', openCart);
  // Service buttons are re-rendered with each view, so listen on the container.
  $('#app').addEventListener('click', (e) => {
    if (e.target.closest('#callBtn')) callWaiter();
    else if (e.target.closest('#billBtn')) openBill();
  });
}

function switchTab(tab) {
  S.tab = tab;
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'order') S.seenOrders = S.state.orders.length;
  renderMain();
  renderBottom();
  window.scrollTo({ top: 0 });
}

function renderAll(keepScroll = false) {
  const y = window.scrollY;
  const r = S.data.restaurant;
  document.documentElement.lang = S.lang;
  $('#logo').hidden = !r.logoUrl;
  $('#logo').innerHTML = r.logoUrl ? `<img src="${esc(r.logoUrl)}" alt="">` : '';
  $('#rname').textContent = r.name;
  $('#langBtn').innerHTML = `${icon('globe', 15)}${LANGUAGES[S.lang].short}`;
  $$('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  renderMain();
  renderBottom();
  if (keepScroll) window.scrollTo({ top: y });
}

function renderMain() {
  if (S.tab === 'menu') renderMenu();
  else if (S.tab === 'order') renderOrder();
  else renderInfo();
}

function serviceRow() {
  const waiterOpen = S.state.calls.some((c) => c.type === 'waiter');
  const billOpen = S.state.calls.some((c) => c.type === 'bill');
  return `<div class="service">
    <button id="callBtn" class="${waiterOpen ? 'on' : ''}">${icon(waiterOpen ? 'check' : 'bell', 17)}${esc(waiterOpen ? t('waiterOnWay') : callLabel())}</button>
    <button id="billBtn" class="${billOpen ? 'on' : ''}">${icon(billOpen ? 'check' : 'receipt', 17)}${esc(t('requestBill'))}</button>
  </div>`;
}

function renderBottom() {
  const count = S.cart.reduce((s, l) => s + l.qty, 0);
  const total = S.cart.reduce((s, l) => s + unitPrice(l) * l.qty, 0);
  $('#cartBar').hidden = count === 0 || S.tab === 'info';
  $('#cartCount').textContent = count;
  $('#cartTotal').textContent = fmt(total);
  const svc = $('.service');
  if (svc) svc.outerHTML = serviceRow();
  $('#orderDot').hidden = !(S.state.orders.length > S.seenOrders && S.tab !== 'order')
    && !S.state.orders.some((o) => o.status === 'ready');
}

function venueHeader() {
  const r = S.data.restaurant;
  return `
    ${r.coverUrl ? `<div class="cover"><img src="${esc(r.coverUrl)}" alt=""></div>` : ''}
    <section class="venue ${r.coverUrl ? 'on-cover' : ''} ${r.logoUrl ? 'with-logo' : ''}">
      ${r.logoUrl ? `<img class="venue-logo" src="${esc(r.logoUrl)}" alt="${esc(r.name)}">` : ''}
      <div class="venue-text">
        <h1>${esc(r.name)}</h1>
        ${tr(r.description) ? `<p>${esc(tr(r.description))}</p>` : ''}
        <div class="meta"><span><b>${esc(spot())}</b></span>${tr(r.hours) ? `<span>${esc(tr(r.hours))}</span>` : ''}</div>
      </div>
    </section>
    ${serviceRow()}`;
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
const FILTERS = ['all', 'vegetarian', 'vegan', 'gluten_free', 'spicy'];

function visibleItems() {
  const q = S.query.trim().toLowerCase();
  return S.data.items.filter((i) => {
    if (S.filter === 'vegetarian' && !(i.tags.includes('vegetarian') || i.tags.includes('vegan'))) return false;
    if (S.filter !== 'all' && S.filter !== 'vegetarian' && !i.tags.includes(S.filter)) return false;
    if (q) {
      const hay = `${tr(i.name)} ${tr(i.description)} ${i.name.el || ''} ${i.name.en || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderMenu() {
  const items = visibleItems();
  const usedFilters = FILTERS.filter((f) => f === 'all' || S.data.items.some((i) => i.tags.includes(f)));
  const cats = S.data.categories.filter((c) => items.some((i) => i.category_id === c.id));

  $('#app').innerHTML = `
    ${venueHeader()}
    <div class="search">${icon('search', 17)}
      <input class="input" id="q" type="search" placeholder="${esc(t('search'))}" value="${esc(S.query)}"></div>
    <div class="chips" id="filters">
      ${usedFilters.map((f) => `<button class="chip ${S.filter === f ? 'active' : ''}" data-f="${f}">${esc(t(f))}</button>`).join('')}
    </div>
    <div class="catnav" id="catnav"><div class="chips">
      ${cats.map((c) => `<button class="chip" data-cat="${c.id}">${esc(tr(c.name))}</button>`).join('')}
    </div></div>
    ${cats.length ? cats.map((c) => `
      <h2 class="section-title" id="cat-${c.id}">${esc(tr(c.name))}</h2>
      <div class="dish-list">${items.filter((i) => i.category_id === c.id).map(dishRow).join('')}</div>
    `).join('') : `<div class="empty"><p>${esc(t('noResults'))}</p></div>`}
    <p class="footnote">${esc(t('allergyNotice'))} ${esc(t('pricesVat'))}</p>
  `;

  const q = $('#q');
  q.addEventListener('input', () => {
    S.query = q.value;
    const pos = q.selectionStart;
    renderMenu();
    const nq = $('#q'); nq.focus(); nq.setSelectionRange(pos, pos);
  });
  $$('#filters .chip').forEach((b) => b.addEventListener('click', () => { S.filter = b.dataset.f; renderMenu(); }));
  $$('#catnav .chip').forEach((b) => b.addEventListener('click', () => {
    $(`#cat-${b.dataset.cat}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  $$('.dish').forEach((el) => el.addEventListener('click', (e) => {
    const id = Number(el.dataset.id);
    if (e.target.closest('.add')) quickAdd(id); else openItem(id);
  }));
  setupScrollSpy();
}

let spyHandler;
function setupScrollSpy() {
  if (spyHandler) window.removeEventListener('scroll', spyHandler);
  const chips = $$('#catnav .chip');
  const titles = $$('.section-title');
  if (!chips.length) return;
  let current;
  const activate = (id) => {
    if (id === current) return;
    current = id;
    chips.forEach((c) => c.classList.toggle('active', c.dataset.cat === id));
    const active = chips.find((c) => c.dataset.cat === id);
    if (active) active.parentElement.scrollTo({ left: Math.max(0, active.offsetLeft - active.parentElement.offsetLeft - 16), behavior: 'smooth' });
  };
  let ticking = false;
  spyHandler = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      let id = titles[0]?.id;
      for (const el of titles) if (el.getBoundingClientRect().top < 130) id = el.id;
      if (id) activate(id.replace('cat-', ''));
    });
  };
  window.addEventListener('scroll', spyHandler, { passive: true });
  spyHandler();
}

function dietText(i) {
  const out = [];
  if (i.tags.includes('vegan')) out.push(t('vegan'));
  else if (i.tags.includes('vegetarian')) out.push(t('vegetarian'));
  if (i.tags.includes('gluten_free')) out.push(t('gluten_free'));
  return out.join(' · ');
}

function dishMeta(i, withPrice = true) {
  const parts = [];
  if (withPrice) parts.push(`<span class="price">${fmt(i.price_cents)}</span>`);
  if (!i.available) parts.push(`<span class="soldout">${esc(t('unavailable'))}</span>`);
  if (i.tags.includes('popular')) parts.push(`<span class="pop">${esc(t('popular'))}</span>`);
  if (i.tags.includes('new')) parts.push(`<span class="pop">${esc(t('new'))}</span>`);
  if (i.tags.includes('spicy')) parts.push(`<span class="spicy">${esc(t('spicy'))}</span>`);
  const diet = dietText(i);
  if (diet) parts.push(`<span class="diet">${esc(diet)}</span>`);
  return parts.length ? `<div class="dish-meta">${parts.join('')}</div>` : '';
}

function dishRow(i) {
  const inCart = S.cart.filter((l) => l.id === i.id).reduce((s, l) => s + l.qty, 0);
  const add = i.available ? `<span class="add" role="button" aria-label="${esc(t('add'))}">${icon('plus', 16)}</span>` : '';
  return `
    <button class="dish ${i.available ? '' : 'off'}" data-id="${i.id}">
      <div class="dish-text">
        <div class="dish-name">${inCart ? `<span class="incart">${inCart}×</span>` : ''}${esc(tr(i.name))}</div>
        ${tr(i.description) ? `<div class="dish-desc">${esc(tr(i.description))}</div>` : ''}
        ${dishMeta(i)}
      </div>
      <div class="dish-side">
        ${i.image_url ? `<img class="dish-photo" src="${esc(i.image_url)}" alt="" loading="lazy">` : ''}
        ${add}
      </div>
    </button>`;
}

const sameLine = (l, id, note, options) => l.id === id && (l.note || '') === note
  && JSON.stringify(l.options || []) === JSON.stringify(options);

function addToCart(id, qty, note = '', options = []) {
  const line = S.cart.find((l) => sameLine(l, id, note, options));
  if (line) line.qty = Math.min(50, line.qty + qty);
  else S.cart.push({ id, qty, note, options });
  saveCart();
  renderBottom();
  if (S.tab === 'menu') { const y = window.scrollY; renderMenu(); window.scrollTo({ top: y }); }
}

function quickAdd(id) {
  const i = itemById(id);
  if (!i?.available) return;
  // Dishes with required choices open the detail sheet instead.
  if (i.options?.some((g) => g.required)) { openItem(id); return; }
  addToCart(id, 1);
  navigator.vibrate?.(15);
}

function optionGroups(i) {
  return (i.options || []).map((g, gi) => `
    <fieldset class="opt-group" data-g="${gi}">
      <legend><b>${esc(tr(g.name))}</b><span class="${g.required ? 'req' : ''}">${esc(g.required ? t('required') : t('optional'))}</span></legend>
      ${g.choices.map((c, ci) => `
        <label class="opt">
          <input type="${g.multi ? 'checkbox' : 'radio'}" name="g${gi}" value="${ci}">
          <span>${esc(tr(c.name))}</span>
          ${c.price_cents ? `<span class="opt-price">+${fmt(c.price_cents)}</span>` : ''}
        </label>`).join('')}
    </fieldset>`).join('');
}

function openItem(id) {
  const i = itemById(id);
  if (!i) return;
  let qty = 1;
  const { el, close } = sheet(`
    ${i.image_url ? `<div class="sheet-photo"><img src="${esc(i.image_url)}" alt=""></div>` : ''}
    <div class="sheet-head"><h2>${esc(tr(i.name))}</h2><span class="price-lg">${fmt(i.price_cents)}</span></div>
    ${tr(i.description) ? `<p class="muted" style="margin:0">${esc(tr(i.description))}</p>` : ''}
    ${dishMeta(i, false)}
    ${i.allergens.length ? `<p class="detail-row"><span>${esc(t('allergens'))}:</span> ${i.allergens.map((a) => esc(t(`allergen_${a}`))).join(', ')}</p>` : ''}
    ${i.available ? `
      ${optionGroups(i)}
      <label class="field" style="margin-top:1rem"><input class="input" id="inote" maxlength="200" placeholder="${esc(t('itemNote'))}"></label>
      <div class="sheet-actions">
        <div class="qty"><button id="minus" aria-label="-">${icon('minus', 16)}</button><span id="qv">1</span><button id="plus" aria-label="+">${icon('plus', 16)}</button></div>
        <button class="btn" id="addBtn"></button>
      </div>` : `<button class="btn secondary block" data-close style="margin-top:1rem">${esc(t('close'))}</button>`}
  `);
  if (!i.available) return;
  const picks = () => $$('.opt-group', el).flatMap((fs) =>
    $$('input:checked', fs).map((inp) => [Number(fs.dataset.g), Number(inp.value)]));
  const missing = () => (i.options || []).some((g, gi) => g.required && !picks().some(([pg]) => pg === gi));
  const upd = () => {
    const unit = unitPrice({ id: i.id, options: picks() });
    $('#qv', el).textContent = qty;
    $('#addBtn', el).textContent = `${t('addToCart')} · ${fmt(unit * qty)}`;
    $('#addBtn', el).classList.toggle('dim', missing());
    $$('.opt-group', el).forEach((fs) => fs.classList.remove('invalid'));
  };
  el.addEventListener('change', upd);
  $('#minus', el).onclick = () => { qty = Math.max(1, qty - 1); upd(); };
  $('#plus', el).onclick = () => { qty = Math.min(50, qty + 1); upd(); };
  $('#addBtn', el).onclick = () => {
    if (missing()) {
      (i.options || []).forEach((g, gi) => {
        if (g.required && !picks().some(([pg]) => pg === gi)) $(`.opt-group[data-g="${gi}"]`, el).classList.add('invalid');
      });
      $('.opt-group.invalid', el)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(t('chooseRequired'), 'err');
      return;
    }
    addToCart(i.id, qty, $('#inote', el).value.trim(), picks());
    close();
  };
  upd();
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------
function openCart() {
  const { el, close } = sheet('<div id="cartBody"></div>', {
    onClose: () => { if (S.tab === 'menu') { const y = window.scrollY; renderMenu(); window.scrollTo({ top: y }); } },
  });
  let orderNote = '';
  const render = () => {
    const total = S.cart.reduce((s, l) => s + unitPrice(l) * l.qty, 0);
    $('#cartBody', el).innerHTML = `
      <div class="sheet-head"><h2>${esc(t('yourCart'))}</h2><button class="icon-btn" data-close aria-label="${esc(t('close'))}">${icon('x', 18)}</button></div>
      <p class="muted small" style="margin:-.5rem 0 .3rem">${esc(spot())}</p>
      ${S.cart.length ? S.cart.map((l, idx) => {
        const i = itemById(l.id);
        const opts = optionText(i, l.options);
        return `<div class="cart-line">
          ${i.image_url ? `<img class="cart-thumb" src="${esc(i.image_url)}" alt="">` : ''}
          <div class="grow"><b>${esc(tr(i.name))}</b>${opts ? `<div class="note">${esc(opts)}</div>` : ''}${l.note ? `<div class="note">${esc(l.note)}</div>` : ''}
            <div class="muted small">${fmt(unitPrice(l) * l.qty)}</div></div>
          <div class="qty"><button data-dec="${idx}">${icon('minus', 15)}</button><span>${l.qty}</span><button data-inc="${idx}">${icon('plus', 15)}</button></div>
        </div>`;
      }).join('') : `<div class="empty"><p>${esc(t('emptyCart'))}</p></div>`}
      ${S.cart.length ? `
        <label class="field" style="margin-top:1rem"><textarea class="input" id="onote" rows="2" maxlength="300" placeholder="${esc(t('orderNote'))}">${esc(orderNote)}</textarea></label>
        <div class="total-row"><span>${esc(t('total'))}</span><span>${fmt(total)}</span></div>
        <button class="btn block" id="send">${esc(t('sendOrder'))}</button>
        <p class="muted small" style="text-align:center;margin-bottom:0">${esc(t('allergyNotice'))}</p>` : ''}
    `;
    $('#onote', el)?.addEventListener('input', (e) => { orderNote = e.target.value; });
    $$('[data-dec]', el).forEach((b) => b.onclick = () => {
      const l = S.cart[b.dataset.dec]; l.qty -= 1;
      if (l.qty <= 0) S.cart.splice(b.dataset.dec, 1);
      saveCart(); renderBottom(); render();
    });
    $$('[data-inc]', el).forEach((b) => b.onclick = () => {
      const l = S.cart[b.dataset.inc]; l.qty = Math.min(50, l.qty + 1); saveCart(); renderBottom(); render();
    });
    $('#send', el)?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await api(`/api/public/table/${token}/orders`, {
          method: 'POST',
          body: { items: S.cart.map((l) => ({ id: l.id, qty: l.qty, note: l.note, options: l.options || [] })), note: orderNote, lang: S.lang },
        });
        S.cart = [];
        saveCart();
        close();
        toast(S.data.requireApproval === false ? t('orderSent') : t('orderSentApproval'), 'ok');
        switchTab('order');
      } catch (err) {
        toast(errorText(err), 'err');
        e.target.disabled = false;
        if (err.code === 'item_unavailable' || err.code === 'bad_option' || err.code === 'option_required') refreshMenu();
      }
    });
  };
  render();
}

// ---------------------------------------------------------------------------
// Orders & bill
// ---------------------------------------------------------------------------
const STEPS = ['pending', 'accepted', 'preparing', 'ready', 'served'];
const clock = (iso) => new Date(iso).toLocaleTimeString(S.lang, { hour: '2-digit', minute: '2-digit' });

function renderOrder() {
  const { orders, bill } = S.state;
  const head = `<h1 class="page-title">${esc(t('myOrder'))}</h1><p class="muted small" style="margin:0">${esc(S.data.restaurant.name)} · ${esc(spot())}</p>${serviceRow()}`;
  if (!orders.length) {
    $('#app').innerHTML = `${head}${receiptCard()}<div class="empty"><p>${esc(t('noOrders'))}</p>
      <button class="btn" id="goMenu">${esc(t('menu'))}</button></div>`;
    $('#goMenu').onclick = () => switchTab('menu');
    return;
  }
  $('#app').innerHTML = `
    ${head}
    ${[...orders].reverse().map((o) => {
      const step = STEPS.indexOf(o.status);
      return `<div class="order-block">
        <div class="order-head"><b>${esc(t('order'))} #${o.id} <span class="muted small" style="font-weight:400">· ${clock(o.createdAt)}</span></b>
          <span class="status s-${o.status}">${esc(t(`status_${o.status}`))}</span></div>
        ${o.status !== 'rejected' ? `<div class="progress">${STEPS.map((_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>` : ''}
        ${o.items.map((i) => `<div class="line"><span>${i.qty} × ${esc(tr(i.name))}${(i.options || []).length ? `<br><span class="muted small">${esc(i.options.map((x) => tr(x.choice)).join(', '))}</span>` : ''}${i.note ? `<br><span class="muted small">${esc(i.note)}</span>` : ''}</span>
          <span>${fmt(i.price * i.qty)}</span></div>`).join('')}
        ${o.note ? `<p class="muted small" style="margin:.4rem 0 0">${esc(o.note)}</p>` : ''}
      </div>`;
    }).join('')}
    <div class="bill">
      <div class="total-row" style="margin:0"><span>${esc(t('total'))}</span><span>${fmt(bill.total)}</span></div>
      ${bill.paid ? `<div class="line"><span>${esc(t('paidLabel'))}</span><span>− ${fmt(bill.paid)}</span></div>
        <div class="line"><b>${esc(t('due'))}</b><b>${fmt(bill.due)}</b></div>` : ''}
      ${bill.total > 0 && bill.due === 0 ? `<p class="paid-note">${icon('check', 16)} ${esc(t('paid'))}</p>` : ''}
      <div class="bill-actions">
        <button class="btn secondary" id="more">${esc(t('orderMore'))}</button>
        ${bill.due > 0 ? `<button class="btn" id="payBtn">${esc(t('requestBill'))}</button>` : ''}
      </div>
    </div>`;
  $('#more').onclick = () => switchTab('menu');
  $('#payBtn')?.addEventListener('click', openBill);
}

async function callWaiter() {
  if (S.state.calls.some((c) => c.type === 'waiter')) { toast(t('waiterCalled')); return; }
  try {
    await api(`/api/public/table/${token}/calls`, { method: 'POST', body: { type: 'waiter' } });
    toast(t('waiterCalled'), 'ok');
  } catch (e) { toast(errorText(e), 'err'); }
}

function openBill() {
  const { bill } = S.state;
  const online = S.data.onlinePayments === 'demo' && bill.due > 0;
  const { el, close } = sheet(`
    <div class="sheet-head"><h2>${esc(t('yourBill'))}</h2><button class="icon-btn" data-close>${icon('x', 18)}</button></div>
    ${bill.total ? `<div class="total-row" style="margin-top:0"><span>${esc(t('due'))}</span><span>${fmt(bill.due)}</span></div>` : ''}
    <p class="muted" style="margin-top:0">${esc(t('howPay'))}</p>
    <div class="pay-options">
      <button class="pay-option" data-m="cash">${icon('cash', 20)}${esc(t('payCash'))}</button>
      <button class="pay-option" data-m="card">${icon('card', 20)}${esc(t('payCard'))}</button>
      ${online ? `<button class="pay-option" data-m="online">${icon('phonePay', 20)}${esc(t('payOnline'))}</button>` : ''}
    </div>
  `);
  $$('.pay-option', el).forEach((b) => b.onclick = async () => {
    const m = b.dataset.m;
    if (m === 'online') { close(); openOnlinePay(); return; }
    try {
      await api(`/api/public/table/${token}/calls`, { method: 'POST', body: { type: 'bill', paymentMethod: m } });
      close();
      toast(t('billRequested'), 'ok');
    } catch (e) { toast(errorText(e), 'err'); }
  });
}

function openOnlinePay() {
  const { bill } = S.state;
  const { el, close } = sheet(`
    <div class="sheet-head"><h2>${esc(t('payOnline'))}</h2><button class="icon-btn" data-close>${icon('x', 18)}</button></div>
    <div class="total-row"><span>${esc(t('due'))}</span><span>${fmt(bill.due)}</span></div>
    <p class="demo-note">${esc(t('paymentDemoNote'))}</p>
    <button class="btn block" id="doPay" style="margin-top:1rem">${esc(t('confirmPay'))} ${fmt(bill.due)}</button>
  `);
  $('#doPay', el).onclick = async (e) => {
    e.target.disabled = true;
    try {
      await api(`/api/public/table/${token}/pay`, { method: 'POST', body: {} });
      close();
      toast(t('paid'), 'ok');
    } catch (err) { toast(errorText(err), 'err'); e.target.disabled = false; }
  };
}

// ---------------------------------------------------------------------------
// Info
// ---------------------------------------------------------------------------
function renderInfo() {
  const r = S.data.restaurant;
  const row = (ic, title, body) => `<div class="info-row">${icon(ic, 20)}<div><h3>${esc(title)}</h3>${body}</div></div>`;
  $('#app').innerHTML = `
    ${venueHeader()}
    <div class="info-list">
      ${tr(r.hours) ? row('clock', t('hours'), `<p>${esc(tr(r.hours))}</p>`) : ''}
      ${r.wifiName ? row('wifi', t('wifi'), `<p>${esc(t('network'))}: <b>${esc(r.wifiName)}</b></p>
        ${r.wifiPassword ? `<p>${esc(t('password'))}: <span class="wifi-pass">${esc(r.wifiPassword)}</span>
        <button class="link-btn" id="copyWifi">${esc(t('copy'))}</button></p>` : ''}`) : ''}
      ${r.address ? row('pin', t('address'), `<p>${esc(r.address)}</p>${r.mapsUrl ? `<a href="${esc(r.mapsUrl)}" target="_blank" rel="noopener">${esc(t('openMaps'))}</a>` : ''}`) : ''}
      ${r.phone ? row('phone', t('phone'), `<p><a href="tel:${esc(r.phone.replace(/\s/g, ''))}">${esc(r.phone)}</a></p>`) : ''}
      ${r.instagram ? row('instagram', 'Instagram', `<p><a href="${esc(r.instagram)}" target="_blank" rel="noopener">${esc(r.instagram.replace(/^https?:\/\/(www\.)?/, ''))}</a></p>`) : ''}
      ${r.reviewUrl ? row('star', t('leaveReview'), `<p><a href="${esc(r.reviewUrl)}" target="_blank" rel="noopener">Google / TripAdvisor</a></p>`) : ''}
      ${row('alert', t('allergens'), `<p class="muted">${esc(t('allergyNotice'))}</p>`)}
    </div>
  `;
  $('#copyWifi')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(r.wifiPassword); toast(t('copied'), 'ok'); } catch { /* ignore */ }
  });
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------
function openLanguages() {
  const { el, close } = sheet(`
    <div class="sheet-head"><h2>${esc(t('language'))}</h2><button class="icon-btn" data-close>${icon('x', 18)}</button></div>
    <div class="langs">${S.data.languages.map((l) => `
      <button class="lang-opt ${l === S.lang ? 'active' : ''}" data-l="${l}">${esc(LANGUAGES[l].name)}<span class="code">${LANGUAGES[l].short}</span></button>`).join('')}
    </div>`);
  $$('.lang-opt', el).forEach((b) => b.onclick = () => {
    S.lang = b.dataset.l;
    try { localStorage.setItem(LANG_KEY, S.lang); } catch { /* ignore */ }
    close();
    renderAll(true);
  });
}

boot();
