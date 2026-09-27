import { $, $$, esc, api, toast, sheet, stream } from './util.js';
import { LANGUAGES, STRINGS, pick, money } from './i18n.js';
import { icon, monogram } from './icons.js';

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
  return t('error');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  try {
    S.data = await api(`/api/public/table/${token}`);
  } catch (e) {
    const lang = (navigator.language || 'en').slice(0, 2);
    S.lang = STRINGS[lang] ? lang : 'en';
    $('#app').innerHTML = `<div class="empty">${icon('qr', 40)}<p>${esc(e.code === 'invalid_table' ? t('invalidTable') : t('error'))}</p></div>`;
    return;
  }
  S.lang = chooseLanguage();
  document.title = S.data.restaurant.name;
  $('#bottom').hidden = false;
  bindChrome();
  renderAll();

  stream(`/api/public/table/${token}/stream`, { state: onState, menu: refreshMenu }, (online) => {
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
    S.cart = S.cart.filter((l) => itemById(l.id));
    saveCart();
    renderAll(true);
  } catch { /* keep current menu */ }
}

function onState(state) {
  const prev = new Map(S.state.orders.map((o) => [o.id, o.status]));
  S.state = state;
  for (const o of state.orders) {
    const before = prev.get(o.id);
    if (before && before !== o.status) {
      if (o.status === 'ready') { toast(t('status_ready'), 'ok'); navigator.vibrate?.(200); }
      else if (o.status === 'accepted' && before === 'pending') toast(`${t('order')} #${o.id} · ${t('status_accepted')}`, 'ok');
      else if (o.status === 'rejected') toast(`${t('order')} #${o.id} · ${t('status_rejected')}`, 'err');
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
  $('#callBtn').addEventListener('click', callWaiter);
  $('#billBtn').addEventListener('click', openBill);
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
  $('#logo').innerHTML = r.logoUrl ? `<img src="${esc(r.logoUrl)}" alt="">` : esc(monogram(r.name));
  $('#rname').textContent = r.name;
  $('#tableBadge').textContent = spot();
  $('#langBtn').innerHTML = `${icon('globe', 16)}<span>${LANGUAGES[S.lang].short}</span>`;
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

function renderBottom() {
  const count = S.cart.reduce((s, l) => s + l.qty, 0);
  const total = S.cart.reduce((s, l) => s + (itemById(l.id)?.price_cents || 0) * l.qty, 0);
  $('#cartBar').hidden = count === 0 || S.tab === 'info';
  $('#cartCount').textContent = count;
  $('#cartTotal').textContent = fmt(total);

  const waiterOpen = S.state.calls.some((c) => c.type === 'waiter');
  const billOpen = S.state.calls.some((c) => c.type === 'bill');
  $('#callBtn').classList.toggle('on', waiterOpen);
  $('#callBtn').innerHTML = `${icon(waiterOpen ? 'check' : 'bell', 16)}<b>${esc(waiterOpen ? t('waiterOnWay') : callLabel())}</b>`;
  $('#billBtn').classList.toggle('on', billOpen);
  $('#billBtn').innerHTML = `${icon(billOpen ? 'check' : 'receipt', 16)}<b>${esc(t('requestBill'))}</b>`;
  $('#orderDot').hidden = !(S.state.orders.length > S.seenOrders && S.tab !== 'order')
    && !S.state.orders.some((o) => o.status === 'ready');
}

function cover(kicker, title, text) {
  const url = S.data.restaurant.coverUrl;
  return `<section class="cover ${url ? 'has-photo' : ''}">
    ${url ? `<img class="cover-img" src="${esc(url)}" alt="">` : ''}
    <div class="cover-inner">
      <div class="kicker">${esc(kicker)}</div>
      <h1>${esc(title)}</h1>
      ${text ? `<p>${esc(text)}</p>` : ''}
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
const FILTERS = ['all', 'vegetarian', 'vegan', 'gluten_free', 'spicy'];
const MARK = { vegetarian: 'V', vegan: 'VG', gluten_free: 'GF' };

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
  const r = S.data.restaurant;
  const items = visibleItems();
  const usedFilters = FILTERS.filter((f) => f === 'all' || S.data.items.some((i) => i.tags.includes(f)));
  const cats = S.data.categories.filter((c) => items.some((i) => i.category_id === c.id));

  $('#app').innerHTML = `
    ${cover(`${t('menu')} · ${spot()}`, r.name, tr(r.description))}
    <div class="search">${icon('search', 18)}
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
    `).join('') : `<div class="empty">${icon('search', 32)}<p>${esc(t('noResults'))}</p></div>`}
    <p class="footnote">${esc(t('dietaryKey'))}<br>${esc(t('allergyNotice'))}<br>${esc(t('pricesVat'))}</p>
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

let spy;
function setupScrollSpy() {
  spy?.disconnect();
  const chips = $$('#catnav .chip');
  if (!chips.length) return;
  const activate = (id) => {
    chips.forEach((c) => c.classList.toggle('active', c.dataset.cat === id));
    const active = chips.find((c) => c.dataset.cat === id);
    if (active) active.parentElement.scrollTo({ left: Math.max(0, active.offsetLeft - active.parentElement.offsetLeft - 24), behavior: 'smooth' });
  };
  activate(chips[0].dataset.cat);
  spy = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible[0]) activate(visible[0].target.id.replace('cat-', ''));
  }, { rootMargin: '-140px 0px -60% 0px' });
  $$('.section-title').forEach((s) => spy.observe(s));
}

function marks(i, withChef = true) {
  const out = [];
  if (withChef && i.tags.includes('popular')) out.push(`<span class="mark chef">${icon('star', 11)} ${esc(t('chefsChoice'))}</span>`);
  if (i.tags.includes('new')) out.push(`<span class="mark chef">${esc(t('new'))}</span>`);
  for (const k of ['vegan', 'vegetarian', 'gluten_free']) {
    if (i.tags.includes(k) && !(k === 'vegetarian' && i.tags.includes('vegan'))) {
      out.push(`<span class="mark diet" title="${esc(t(k))}">${MARK[k]}</span>`);
    }
  }
  if (i.tags.includes('spicy')) out.push(`<span class="mark spicy">${icon('flame', 11)} ${esc(t('spicy'))}</span>`);
  return out.length ? `<div class="marks">${out.join('')}</div>` : '';
}

function dishRow(i) {
  const inCart = S.cart.filter((l) => l.id === i.id).reduce((s, l) => s + l.qty, 0);
  const addBtn = i.available
    ? `<span class="add ${inCart ? 'in-cart' : ''}" role="button" aria-label="${esc(t('add'))}">${inCart ? inCart : icon('plus', 16)}</span>`
    : '';
  return `
    <button class="dish ${i.available ? '' : 'off'} ${i.image_url ? 'with-photo' : ''}" data-id="${i.id}">
      <div class="dish-text">
        <div class="dish-head"><span class="dish-name">${esc(tr(i.name))}</span>
          ${i.image_url ? '' : `<span class="dish-price">${fmt(i.price_cents)}</span>`}</div>
        ${tr(i.description) ? `<div class="dish-desc">${esc(tr(i.description))}</div>` : ''}
        ${marks(i)}
        ${i.image_url ? `<div class="dish-price">${fmt(i.price_cents)}</div>` : ''}
        ${i.available ? '' : `<span class="soldout">${esc(t('unavailable'))}</span>`}
      </div>
      ${i.image_url
        ? `<div class="dish-photo"><img src="${esc(i.image_url)}" alt="" loading="lazy">${addBtn}</div>`
        : addBtn}
    </button>`;
}

function addToCart(id, qty, note = '') {
  const line = S.cart.find((l) => l.id === id && (l.note || '') === note);
  if (line) line.qty = Math.min(50, line.qty + qty);
  else S.cart.push({ id, qty, note });
  saveCart();
  renderBottom();
  if (S.tab === 'menu') { const y = window.scrollY; renderMenu(); window.scrollTo({ top: y }); }
}

function quickAdd(id) {
  const i = itemById(id);
  if (!i?.available) return;
  addToCart(id, 1);
  navigator.vibrate?.(15);
}

function openItem(id) {
  const i = itemById(id);
  if (!i) return;
  let qty = 1;
  const { el, close } = sheet(`
    ${i.image_url ? `<div class="sheet-photo"><img src="${esc(i.image_url)}" alt=""></div>` : ''}
    <div class="sheet-head"><h2>${esc(tr(i.name))}</h2><span class="dish-price">${fmt(i.price_cents)}</span></div>
    ${tr(i.description) ? `<p class="muted" style="margin-top:0">${esc(tr(i.description))}</p>` : ''}
    ${marks(i)}
    ${i.allergens.length ? `<p class="allergens"><span>${esc(t('allergens'))}</span>${i.allergens.map((a) => esc(t(`allergen_${a}`))).join(' · ')}</p>` : ''}
    ${i.available ? `
      <label class="field" style="margin-top:1.1rem"><input class="input" id="inote" maxlength="200" placeholder="${esc(t('itemNote'))}"></label>
      <div class="sheet-actions">
        <div class="qty"><button id="minus" aria-label="-">${icon('minus', 16)}</button><span id="qv">1</span><button id="plus" aria-label="+">${icon('plus', 16)}</button></div>
        <button class="btn" id="addBtn"></button>
      </div>` : `<p class="soldout">${esc(t('unavailable'))}</p>
      <button class="btn secondary block" data-close>${esc(t('close'))}</button>`}
  `);
  if (!i.available) return;
  const upd = () => { $('#qv', el).textContent = qty; $('#addBtn', el).textContent = `${t('addToCart')} · ${fmt(i.price_cents * qty)}`; };
  $('#minus', el).onclick = () => { qty = Math.max(1, qty - 1); upd(); };
  $('#plus', el).onclick = () => { qty = Math.min(50, qty + 1); upd(); };
  $('#addBtn', el).onclick = () => { addToCart(i.id, qty, $('#inote', el).value.trim()); close(); };
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
    const total = S.cart.reduce((s, l) => s + (itemById(l.id)?.price_cents || 0) * l.qty, 0);
    $('#cartBody', el).innerHTML = `
      <div class="sheet-head"><h2>${esc(t('yourCart'))}</h2><button class="icon-btn" data-close aria-label="${esc(t('close'))}">${icon('x')}</button></div>
      <p class="muted small" style="margin:-.4rem 0 .4rem">${esc(S.data.restaurant.name)} · ${esc(spot())}</p>
      ${S.cart.length ? S.cart.map((l, idx) => {
        const i = itemById(l.id);
        return `<div class="cart-line">
          ${i.image_url ? `<img class="cart-thumb" src="${esc(i.image_url)}" alt="">` : ''}
          <div class="grow"><b>${esc(tr(i.name))}</b>${l.note ? `<div class="note">${esc(l.note)}</div>` : ''}
            <div class="muted small">${fmt(i.price_cents * l.qty)}</div></div>
          <div class="qty"><button data-dec="${idx}">${icon('minus', 15)}</button><span>${l.qty}</span><button data-inc="${idx}">${icon('plus', 15)}</button></div>
        </div>`;
      }).join('') : `<div class="empty">${icon('bag', 32)}<p>${esc(t('emptyCart'))}</p></div>`}
      ${S.cart.length ? `
        <label class="field" style="margin-top:1rem"><textarea class="input" id="onote" rows="2" maxlength="300" placeholder="${esc(t('orderNote'))}">${esc(orderNote)}</textarea></label>
        <div class="total-row"><span>${esc(t('total'))}</span><span>${fmt(total)}</span></div>
        <button class="btn block" id="send">${esc(t('sendOrder'))}</button>
        <p class="muted small" style="text-align:center">${esc(t('allergyNotice'))}</p>` : ''}
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
          body: { items: S.cart.map((l) => ({ id: l.id, qty: l.qty, note: l.note })), note: orderNote, lang: S.lang },
        });
        S.cart = [];
        saveCart();
        close();
        toast(S.data.requireApproval === false ? t('orderSent') : t('orderSentApproval'), 'ok');
        switchTab('order');
      } catch (err) {
        toast(errorText(err), 'err');
        e.target.disabled = false;
        if (err.code === 'item_unavailable') refreshMenu();
      }
    });
  };
  render();
}

// ---------------------------------------------------------------------------
// Orders & bill
// ---------------------------------------------------------------------------
const STEPS = ['pending', 'accepted', 'preparing', 'ready', 'served'];

function renderOrder() {
  const { orders, bill } = S.state;
  if (!orders.length) {
    $('#app').innerHTML = `<h1 class="page-title">${esc(t('myOrder'))}</h1>
      <div class="empty">${icon('receipt', 36)}<p>${esc(t('noOrders'))}</p>
      <button class="btn" id="goMenu">${esc(t('menu'))}</button></div>`;
    $('#goMenu').onclick = () => switchTab('menu');
    return;
  }
  $('#app').innerHTML = `
    <h1 class="page-title">${esc(t('myOrder'))}</h1>
    <p class="muted small" style="margin:0 0 .5rem">${esc(spot())}</p>
    ${[...orders].reverse().map((o) => {
      const step = STEPS.indexOf(o.status);
      return `<div class="card order-card">
        <div class="order-head"><b>${esc(t('order'))} #${o.id}</b>
          <span class="status s-${o.status}">${esc(t(`status_${o.status}`))}</span></div>
        ${o.status !== 'rejected' ? `<div class="progress">${STEPS.map((_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>` : ''}
        ${o.items.map((i) => `<div class="line"><span>${i.qty} × ${esc(tr(i.name))}${i.note ? `<br><span class="muted small">${esc(i.note)}</span>` : ''}</span>
          <span>${fmt(i.price * i.qty)}</span></div>`).join('')}
        ${o.note ? `<p class="muted small">${icon('message', 13)} ${esc(o.note)}</p>` : ''}
      </div>`;
    }).join('')}
    <div class="card bill">
      <div class="total-row" style="margin-top:0"><span>${esc(t('total'))}</span><span>${fmt(bill.total)}</span></div>
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
    <div class="sheet-head"><h2>${esc(t('yourBill'))}</h2><button class="icon-btn" data-close>${icon('x')}</button></div>
    ${bill.total ? `<div class="total-row" style="margin-top:0"><span>${esc(t('due'))}</span><span>${fmt(bill.due)}</span></div>` : ''}
    <p class="muted">${esc(t('howPay'))}</p>
    <div class="pay-options">
      <button class="pay-option" data-m="cash"><span>${icon('cash', 22)}</span>${esc(t('payCash'))}</button>
      <button class="pay-option" data-m="card"><span>${icon('card', 22)}</span>${esc(t('payCard'))}</button>
      ${online ? `<button class="pay-option" data-m="online"><span>${icon('phonePay', 22)}</span>${esc(t('payOnline'))}</button>` : ''}
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
    <div class="sheet-head"><h2>${esc(t('payOnline'))}</h2><button class="icon-btn" data-close>${icon('x')}</button></div>
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
  const row = (ic, title, body) => `<div class="info-row"><div class="info-ic">${icon(ic, 20)}</div><div><h3>${esc(title)}</h3>${body}</div></div>`;
  $('#app').innerHTML = `
    ${cover(t('info'), r.name, tr(r.description))}
    <div class="card info-card">
      ${tr(r.hours) ? row('clock', t('hours'), `<p>${esc(tr(r.hours))}</p>`) : ''}
      ${r.wifiName ? row('wifi', t('wifi'), `<p>${esc(t('network'))}: <b>${esc(r.wifiName)}</b></p>
        ${r.wifiPassword ? `<p>${esc(t('password'))}: <span class="wifi-pass">${esc(r.wifiPassword)}</span>
        <button class="link-btn" id="copyWifi">${icon('copy', 14)} ${esc(t('copy'))}</button></p>` : ''}`) : ''}
      ${r.address ? row('pin', t('address'), `<p>${esc(r.address)}</p>${r.mapsUrl ? `<a href="${esc(r.mapsUrl)}" target="_blank" rel="noopener">${esc(t('openMaps'))}</a>` : ''}`) : ''}
      ${r.phone ? row('phone', t('phone'), `<p><a href="tel:${esc(r.phone.replace(/\s/g, ''))}">${esc(r.phone)}</a></p>`) : ''}
      ${r.instagram ? row('instagram', 'Instagram', `<p><a href="${esc(r.instagram)}" target="_blank" rel="noopener">${esc(r.instagram.replace(/^https?:\/\/(www\.)?/, ''))}</a></p>`) : ''}
      ${r.reviewUrl ? row('star', t('leaveReview'), `<p><a href="${esc(r.reviewUrl)}" target="_blank" rel="noopener">Google · TripAdvisor</a></p>`) : ''}
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
    <div class="sheet-head"><h2>${esc(t('language'))}</h2><button class="icon-btn" data-close>${icon('x')}</button></div>
    <div class="langs">${S.data.languages.map((l) => `
      <button class="lang-opt ${l === S.lang ? 'active' : ''}" data-l="${l}"><span class="code">${LANGUAGES[l].short}</span>${esc(LANGUAGES[l].name)}</button>`).join('')}
    </div>`);
  $$('.lang-opt', el).forEach((b) => b.onclick = () => {
    S.lang = b.dataset.l;
    try { localStorage.setItem(LANG_KEY, S.lang); } catch { /* ignore */ }
    close();
    renderAll(true);
  });
}

boot();
