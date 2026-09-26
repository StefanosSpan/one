import { $, $$, esc, api, toast, sheet, euro } from './util.js';
import { requireLogin, topBar, liveStaff, LANG_FLAGS, itemName } from './staff.js';
import { LANGUAGES, STRINGS, ALLERGEN_ICONS } from './i18n.js';

const me = await requireLogin(['admin']);
if (me) start();

const TAG_LABELS = { vegetarian: '🥦 Χορτοφαγικό', vegan: '🌱 Vegan', gluten_free: '🚫🌾 Χωρίς γλουτένη', spicy: '🌶️ Πικάντικο', popular: '⭐ Δημοφιλές', new: '✨ Νέο' };

let settings = null;
let tab = 'dash';

function start() {
  topBar(me, 'admin', '⚙️ Διαχείριση');
  $$('#tabs button').forEach((b) => b.onclick = () => {
    tab = b.dataset.tab;
    $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    render();
  });
  liveStaff((evt) => { if (tab === 'dash' && evt.startsWith('order')) render(); });
  render();
}

async function render() {
  settings = await api('/api/admin/settings');
  const views = { dash: renderDash, menu: renderMenu, tables: renderTables, store: renderStore, settings: renderSettings };
  await views[tab]();
}

// ---------------------------------------------------------------------------
// Multilingual field editor
// ---------------------------------------------------------------------------
function i18nEditor(defs, values = {}) {
  const langs = settings.languages;
  return `<div class="i18n">
    <div class="lang-tabs">${langs.map((l, i) => `<button type="button" data-lang="${l}" class="${i === 0 ? 'active' : ''}">${LANGUAGES[l].flag} ${l.toUpperCase()}</button>`).join('')}</div>
    ${langs.map((l, i) => `<div data-pane="${l}" ${i ? 'hidden' : ''}>
      ${defs.map((d) => `<label class="field"><span>${esc(d.label)} (${LANGUAGES[l].name})</span>
        ${d.textarea
          ? `<textarea class="input" rows="2" maxlength="${d.max || 400}" data-f="${d.key}" data-l="${l}">${esc(values[d.key]?.[l] || '')}</textarea>`
          : `<input class="input" maxlength="${d.max || 100}" data-f="${d.key}" data-l="${l}" value="${esc(values[d.key]?.[l] || '')}">`}
      </label>`).join('')}
    </div>`).join('')}
    <p class="muted small">Όσες γλώσσες μείνουν κενές εμφανίζονται στα Αγγλικά (ή στα Ελληνικά). Η κόκκινη τελεία σημαίνει κενή μετάφραση.</p>
  </div>`;
}

function bindI18n(root) {
  const box = $('.i18n', root);
  const mark = () => $$('[data-lang]', box).forEach((b) => {
    const empty = $$(`[data-l="${b.dataset.lang}"]`, box).some((inp) => !inp.value.trim() && inp.dataset.f === 'name');
    b.classList.toggle('missing', empty);
  });
  $$('[data-lang]', box).forEach((b) => b.onclick = () => {
    $$('[data-lang]', box).forEach((x) => x.classList.toggle('active', x === b));
    $$('[data-pane]', box).forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.lang; });
  });
  box.addEventListener('input', mark);
  mark();
  return () => {
    const out = {};
    for (const inp of $$('[data-f]', box)) {
      out[inp.dataset.f] ||= {};
      if (inp.value.trim()) out[inp.dataset.f][inp.dataset.l] = inp.value.trim();
    }
    return out;
  };
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function uploadImage(file) {
  if (file.size > 4 * 1024 * 1024) throw new Error('Η εικόνα ξεπερνά τα 4MB');
  const { url } = await api('/api/admin/upload', { method: 'POST', body: { dataUrl: await readImage(file) } });
  return url;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
let statDays = 1;
async function renderDash() {
  const [s, demo] = await Promise.all([api(`/api/admin/stats?days=${statDays}`), api('/api/demo')]);
  const max = Math.max(1, ...s.byDay.map((d) => d.revenue));
  $('#app').innerHTML = `
    <div class="row" style="margin:0 0 1rem;max-width:480px">
      ${[[1, 'Σήμερα'], [7, '7 ημέρες'], [30, '30 ημέρες']].map(([d, l]) => `<button class="btn sm ${statDays === d ? '' : 'secondary'}" data-days="${d}">${l}</button>`).join('')}
    </div>
    <div class="stats">
      <div class="stat"><div class="v">${euro(s.revenue)}</div><div class="l">Τζίρος από QR παραγγελίες</div></div>
      <div class="stat"><div class="v">${s.orders}</div><div class="l">Παραγγελίες</div></div>
      <div class="stat"><div class="v">${euro(s.avg)}</div><div class="l">Μέση παραγγελία</div></div>
      <div class="stat"><div class="v">${s.rejected}</div><div class="l">Απορρίφθηκαν</div></div>
    </div>
    <div class="grid">
      <div class="panel"><h3 style="margin-top:0">🏆 Δημοφιλέστερα πιάτα</h3>
        ${s.top.length ? s.top.map((t, i) => `<div class="oline"><span>${i + 1}. ${esc(itemName(t.name))}</span><span><b>${t.qty}</b> · ${euro(t.revenue)}</span></div>`).join('') : '<p class="muted">Δεν υπάρχουν ακόμη παραγγελίες.</p>'}
      </div>
      <div class="panel"><h3 style="margin-top:0">🌍 Γλώσσες πελατών</h3>
        ${s.langs.length ? s.langs.map((l) => `<div class="oline"><span>${LANG_FLAGS[l.lang] || ''} ${esc(LANGUAGES[l.lang]?.name || l.lang)}</span><b>${l.n}</b></div>`).join('') : '<p class="muted">—</p>'}
      </div>
      ${statDays > 1 ? `<div class="panel"><h3 style="margin-top:0">📈 Τζίρος ανά ημέρα</h3>
        <div class="bars" style="margin-bottom:1.5rem">${s.byDay.map((d) => `<div style="height:${Math.round((d.revenue / max) * 100)}%" title="${d.day}: ${euro(d.revenue)}"><span>${d.day.slice(8)}/${d.day.slice(5, 7)}</span></div>`).join('')}</div>
      </div>` : ''}
      <div class="panel"><h3 style="margin-top:0">🔗 Γρήγορη δοκιμή</h3>
        <p class="muted small">Ανοίξτε το μενού ενός τραπεζιού σε άλλη καρτέλα ή στο κινητό σας και κάντε μια δοκιμαστική παραγγελία.</p>
        ${demo.tables.map((t) => `<a class="btn secondary sm" style="margin:.2rem" href="${esc(t.url)}" target="_blank">📱 Μενού τραπεζιού ${esc(t.label)}</a>`).join('')}
        <a class="btn secondary sm" style="margin:.2rem" href="/staff/waiter" target="_blank">🧑‍🍳 Σερβιτόρος</a>
        <a class="btn secondary sm" style="margin:.2rem" href="/staff/kitchen" target="_blank">🔥 Κουζίνα</a>
      </div>
    </div>`;
  $$('[data-days]').forEach((b) => b.onclick = () => { statDays = Number(b.dataset.days); renderDash(); });
}

// ---------------------------------------------------------------------------
// Menu editor
// ---------------------------------------------------------------------------
let menu = null;
async function renderMenu() {
  menu = await api('/api/admin/menu');
  const { categories, items } = menu;
  $('#app').innerHTML = `
    <div class="row" style="margin:0 0 1rem"><button class="btn" id="addCat" style="flex:0 1 auto">➕ Νέα κατηγορία</button></div>
    ${categories.map((c, ci) => {
      const list = items.filter((i) => i.category_id === c.id);
      return `<div class="cat-block">
        <div class="cat-head">
          <span style="font-size:1.4rem">${esc(c.icon)}</span>
          <h3>${esc(itemName(c.name))} ${c.active ? '' : '<span class="badge gray">Κρυφή</span>'}</h3>
          <button class="mini" data-cmove="${ci}" data-dir="-1" title="Πάνω">↑</button>
          <button class="mini" data-cmove="${ci}" data-dir="1" title="Κάτω">↓</button>
          <button class="mini" data-cedit="${c.id}">✎ Επεξεργασία</button>
          <button class="btn sm" data-iadd="${c.id}">➕ Πιάτο</button>
        </div>
        ${list.map((i, ii) => `<div class="list-item ${i.available ? '' : 'off'}">
          <div class="em">${i.image_url ? `<img src="${esc(i.image_url)}" alt="">` : esc(i.emoji || '🍽️')}</div>
          <div class="grow"><b>${esc(itemName(i.name))}</b>
            <span class="muted small">${esc(i.description?.el || i.description?.en || '')}</span>
            <div class="small">${settings.languages.map((l) => `<span title="${LANGUAGES[l].name}" style="opacity:${i.name[l] ? 1 : .25}">${LANGUAGES[l].flag}</span>`).join(' ')}</div>
          </div>
          <b>${euro(i.price_cents)}</b>
          <label class="small" title="Διαθέσιμο"><input type="checkbox" data-avail="${i.id}" ${i.available ? 'checked' : ''}> Διαθέσιμο</label>
          <button class="mini" data-imove="${c.id}:${ii}" data-dir="-1">↑</button>
          <button class="mini" data-imove="${c.id}:${ii}" data-dir="1">↓</button>
          <button class="mini" data-iedit="${i.id}">✎</button>
        </div>`).join('') || '<div class="list-item muted">Δεν υπάρχουν πιάτα σε αυτή την κατηγορία.</div>'}
      </div>`;
    }).join('')}`;

  $('#addCat').onclick = () => editCategory();
  $$('[data-cedit]').forEach((b) => b.onclick = () => editCategory(categories.find((c) => c.id === Number(b.dataset.cedit))));
  $$('[data-iadd]').forEach((b) => b.onclick = () => editItem(null, Number(b.dataset.iadd)));
  $$('[data-iedit]').forEach((b) => b.onclick = () => editItem(items.find((i) => i.id === Number(b.dataset.iedit))));
  $$('[data-avail]').forEach((c) => c.onchange = async () => {
    await api(`/api/staff/items/${c.dataset.avail}/available`, { method: 'POST', body: { available: c.checked } });
    toast(c.checked ? 'Διαθέσιμο' : 'Εξαντλημένο', 'ok');
    renderMenu();
  });
  $$('[data-cmove]').forEach((b) => b.onclick = () => move('categories', categories.map((c) => c.id), Number(b.dataset.cmove), Number(b.dataset.dir)));
  $$('[data-imove]').forEach((b) => b.onclick = () => {
    const [cid, idx] = b.dataset.imove.split(':').map(Number);
    const ids = items.filter((i) => i.category_id === cid).map((i) => i.id);
    const others = items.filter((i) => i.category_id !== cid).map((i) => i.id);
    move('items', ids, idx, Number(b.dataset.dir), others);
  });
}

async function move(kind, ids, idx, dir, rest = []) {
  const j = idx + dir;
  if (j < 0 || j >= ids.length) return;
  [ids[idx], ids[j]] = [ids[j], ids[idx]];
  await api('/api/admin/reorder', { method: 'POST', body: { kind, ids: [...rest, ...ids] } });
  renderMenu();
}

function editCategory(c) {
  const { el, close } = sheet(`
    <div class="sheet-head"><h2>${c ? 'Επεξεργασία κατηγορίας' : 'Νέα κατηγορία'}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="two">
      <label class="field"><span>Εικονίδιο (emoji)</span><input class="input" id="icon" maxlength="8" value="${esc(c?.icon || '🍽️')}"></label>
      <label class="switch" style="margin-top:1.4rem"><input type="checkbox" id="active" ${c?.active === false ? '' : 'checked'}> Εμφανίζεται στο μενού</label>
    </div>
    ${i18nEditor([{ key: 'name', label: 'Όνομα', max: 80 }], { name: c?.name })}
    <div class="row">
      ${c ? '<button class="btn danger" id="del">🗑 Διαγραφή</button>' : ''}
      <button class="btn" id="save">💾 Αποθήκευση</button>
    </div>`);
  const read = bindI18n(el);
  $('#save', el).onclick = async () => {
    const body = { ...read(), icon: $('#icon', el).value, active: $('#active', el).checked };
    try {
      await api(c ? `/api/admin/categories/${c.id}` : '/api/admin/categories', { method: c ? 'PUT' : 'POST', body });
      close(); toast('Αποθηκεύτηκε', 'ok'); renderMenu();
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#del', el)?.addEventListener('click', async () => {
    if (!confirm('Διαγραφή κατηγορίας ΚΑΙ όλων των πιάτων της;')) return;
    await api(`/api/admin/categories/${c.id}`, { method: 'DELETE' });
    close(); toast('Διαγράφηκε', 'ok'); renderMenu();
  });
}

function editItem(item, categoryId) {
  const i = item || { category_id: categoryId, name: {}, description: {}, allergens: [], tags: [], emoji: '🍽️', image_url: '', price_cents: 0, available: true };
  let imageUrl = i.image_url;
  const { el, close } = sheet(`
    <div class="sheet-head"><h2>${item ? 'Επεξεργασία πιάτου' : 'Νέο πιάτο'}</h2><button class="icon-btn" data-close>✕</button></div>
    ${i18nEditor([{ key: 'name', label: 'Όνομα', max: 100 }, { key: 'description', label: 'Περιγραφή', textarea: true, max: 400 }], i)}
    <div class="two">
      <label class="field"><span>Τιμή (€)</span><input class="input" id="price" type="number" step="0.10" min="0" value="${(i.price_cents / 100).toFixed(2)}"></label>
      <label class="field"><span>Κατηγορία</span><select class="input" id="cat">
        ${menu.categories.map((c) => `<option value="${c.id}" ${c.id === i.category_id ? 'selected' : ''}>${esc(c.icon)} ${esc(itemName(c.name))}</option>`).join('')}
      </select></label>
      <label class="field"><span>Emoji (αν δεν υπάρχει φωτογραφία)</span><input class="input" id="emoji" maxlength="8" value="${esc(i.emoji)}"></label>
      <label class="field"><span>Φωτογραφία</span><input class="input" id="img" type="file" accept="image/*"></label>
    </div>
    <div id="imgPrev">${imageUrl ? `<img src="${esc(imageUrl)}" style="max-height:120px;border-radius:12px"> <button class="btn ghost sm" id="rmImg">Αφαίρεση φωτογραφίας</button>` : ''}</div>
    <label class="field"><span>Ετικέτες</span><div class="checks">
      ${menu.tags.map((tg) => `<label><input type="checkbox" data-tag="${tg}" ${i.tags.includes(tg) ? 'checked' : ''}>${TAG_LABELS[tg] || tg}</label>`).join('')}
    </div></label>
    <label class="field"><span>Αλλεργιογόνα (υποχρεωτική ενημέρωση – Κανονισμός ΕΕ 1169/2011)</span><div class="checks">
      ${menu.allergens.map((a) => `<label><input type="checkbox" data-al="${a}" ${i.allergens.includes(a) ? 'checked' : ''}>${ALLERGEN_ICONS[a] || ''} ${esc(STRINGS.el[`allergen_${a}`])}</label>`).join('')}
    </div></label>
    <label class="switch"><input type="checkbox" id="avail" ${i.available ? 'checked' : ''}> Διαθέσιμο τώρα</label>
    <div class="row">
      ${item ? '<button class="btn danger" id="del">🗑 Διαγραφή</button>' : ''}
      <button class="btn" id="save">💾 Αποθήκευση</button>
    </div>`);
  const read = bindI18n(el);
  const bindRm = () => $('#rmImg', el)?.addEventListener('click', () => { imageUrl = ''; $('#imgPrev', el).innerHTML = ''; });
  bindRm();
  $('#img', el).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      imageUrl = await uploadImage(f);
      $('#imgPrev', el).innerHTML = `<img src="${esc(imageUrl)}" style="max-height:120px;border-radius:12px"> <button class="btn ghost sm" id="rmImg">Αφαίρεση φωτογραφίας</button>`;
      bindRm();
    } catch (err) { toast(err.message, 'err'); }
  };
  $('#save', el).onclick = async () => {
    const body = {
      ...read(),
      price: $('#price', el).value,
      categoryId: Number($('#cat', el).value),
      emoji: $('#emoji', el).value,
      imageUrl,
      tags: $$('[data-tag]', el).filter((c) => c.checked).map((c) => c.dataset.tag),
      allergens: $$('[data-al]', el).filter((c) => c.checked).map((c) => c.dataset.al),
      available: $('#avail', el).checked,
    };
    try {
      await api(item ? `/api/admin/items/${item.id}` : '/api/admin/items', { method: item ? 'PUT' : 'POST', body });
      close(); toast('Αποθηκεύτηκε', 'ok'); renderMenu();
    } catch (err) { toast(err.message, 'err'); }
  };
  $('#del', el)?.addEventListener('click', async () => {
    if (!confirm('Διαγραφή πιάτου;')) return;
    await api(`/api/admin/items/${item.id}`, { method: 'DELETE' });
    close(); toast('Διαγράφηκε', 'ok'); renderMenu();
  });
}

// ---------------------------------------------------------------------------
// Tables & QR
// ---------------------------------------------------------------------------
async function renderTables() {
  const tables = await api('/api/admin/tables');
  $('#app').innerHTML = `
    <div class="panel">
      <div class="row" style="margin:0;align-items:center">
        <input class="input" id="newLabel" placeholder="Όνομα τραπεζιού (π.χ. 13, Βεράντα 2, Μπαρ)" style="flex:2">
        <button class="btn" id="addOne" style="flex:0 1 auto">➕ Προσθήκη</button>
        <button class="btn secondary" id="addMany" style="flex:0 1 auto">➕ Πολλά μαζί…</button>
        <a class="btn success" href="/staff/qr" target="_blank" style="flex:0 1 auto">🖨️ Εκτύπωση όλων των QR</a>
      </div>
      ${location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? `<div class="note-box" style="margin-bottom:0">
        ⚠️ Ανοίξατε τη διαχείριση από <b>localhost</b>: τα QR θα δείχνουν σε localhost και δεν θα ανοίγουν από κινητό.
        Ορίστε τη «Δημόσια διεύθυνση» στις Ρυθμίσεις ή ανοίξτε τη σελίδα με τη διεύθυνση IP του υπολογιστή.</div>` : ''}
    </div>
    <div class="cat-block">
      ${tables.map((t) => `<div class="list-item ${t.active ? '' : 'off'}">
        <img class="qr-img" src="/api/admin/tables/${t.id}/qr.svg?v=${esc(t.token)}" alt="QR">
        <div class="grow"><b>Τραπέζι ${esc(t.label)}</b>
          <a class="small" href="${esc(t.url)}" target="_blank" style="word-break:break-all">${esc(t.url)}</a></div>
        <label class="small"><input type="checkbox" data-active="${t.id}" data-label="${esc(t.label)}" ${t.active ? 'checked' : ''}> Ενεργό</label>
        <button class="mini" data-rename="${t.id}" data-label="${esc(t.label)}" data-act="${t.active}">✎</button>
        <button class="mini" data-regen="${t.id}" title="Νέο QR (το παλιό σταματά να λειτουργεί)">🔄</button>
        <button class="mini" data-del="${t.id}">🗑</button>
      </div>`).join('') || '<div class="list-item muted">Δεν υπάρχουν τραπέζια.</div>'}
    </div>`;
  const reload = () => renderTables();
  $('#addOne').onclick = async () => {
    const label = $('#newLabel').value.trim();
    if (!label) return toast('Γράψτε όνομα τραπεζιού', 'err');
    await api('/api/admin/tables', { method: 'POST', body: { label } }); reload();
  };
  $('#addMany').onclick = async () => {
    const n = Number(prompt('Πόσα τραπέζια να προστεθούν; (αριθμούνται αυτόματα)', '5'));
    if (n > 0) { await api('/api/admin/tables', { method: 'POST', body: { count: n } }); reload(); }
  };
  $$('[data-active]').forEach((c) => c.onchange = async () => {
    await api(`/api/admin/tables/${c.dataset.active}`, { method: 'PUT', body: { label: c.dataset.label, active: c.checked } }); reload();
  });
  $$('[data-rename]').forEach((b) => b.onclick = async () => {
    const label = prompt('Νέο όνομα τραπεζιού', b.dataset.label);
    if (label) { await api(`/api/admin/tables/${b.dataset.rename}`, { method: 'PUT', body: { label, active: b.dataset.act === 'true' } }); reload(); }
  });
  $$('[data-regen]').forEach((b) => b.onclick = async () => {
    if (!confirm('Δημιουργία νέου QR; Το παλιό αυτοκόλλητο θα σταματήσει να λειτουργεί.')) return;
    await api(`/api/admin/tables/${b.dataset.regen}/regenerate`, { method: 'POST' }); reload();
  });
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Διαγραφή τραπεζιού και του ιστορικού του;')) return;
    await api(`/api/admin/tables/${b.dataset.del}`, { method: 'DELETE' }); reload();
  });
}

// ---------------------------------------------------------------------------
// Store info
// ---------------------------------------------------------------------------
function renderStore() {
  const r = settings.restaurant;
  let logoUrl = r.logoUrl || '';
  $('#app').innerHTML = `<div class="panel" style="max-width:820px">
    <label class="field"><span>Όνομα καταστήματος</span><input class="input" id="name" maxlength="80" value="${esc(r.name)}"></label>
    ${i18nEditor([{ key: 'description', label: 'Σύντομη περιγραφή', textarea: true, max: 400 }, { key: 'hours', label: 'Ωράριο', max: 200 }], r)}
    <div class="two">
      <label class="field"><span>Διεύθυνση</span><input class="input" id="address" value="${esc(r.address)}"></label>
      <label class="field"><span>Σύνδεσμος Google Maps</span><input class="input" id="mapsUrl" value="${esc(r.mapsUrl)}"></label>
      <label class="field"><span>Τηλέφωνο</span><input class="input" id="phone" value="${esc(r.phone)}"></label>
      <label class="field"><span>Email</span><input class="input" id="email" value="${esc(r.email)}"></label>
      <label class="field"><span>Wi-Fi – όνομα δικτύου</span><input class="input" id="wifiName" value="${esc(r.wifiName)}"></label>
      <label class="field"><span>Wi-Fi – κωδικός</span><input class="input" id="wifiPassword" value="${esc(r.wifiPassword)}"></label>
      <label class="field"><span>Instagram (URL)</span><input class="input" id="instagram" value="${esc(r.instagram)}"></label>
      <label class="field"><span>Σύνδεσμος για κριτικές (Google/TripAdvisor)</span><input class="input" id="reviewUrl" value="${esc(r.reviewUrl)}"></label>
    </div>
    <label class="field"><span>Λογότυπο</span><input class="input" type="file" id="logo" accept="image/*"></label>
    <div id="logoPrev">${logoUrl ? `<img src="${esc(logoUrl)}" style="height:60px;border-radius:12px">` : ''}</div>
    <button class="btn" id="save" style="margin-top:1rem">💾 Αποθήκευση</button>
  </div>`;
  const read = bindI18n($('#app'));
  $('#logo').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { logoUrl = await uploadImage(f); $('#logoPrev').innerHTML = `<img src="${esc(logoUrl)}" style="height:60px;border-radius:12px">`; }
    catch (err) { toast(err.message, 'err'); }
  };
  $('#save').onclick = async () => {
    const fields = ['name', 'address', 'mapsUrl', 'phone', 'email', 'wifiName', 'wifiPassword', 'instagram', 'reviewUrl'];
    const restaurant = { ...Object.fromEntries(fields.map((f) => [f, $(`#${f}`).value])), ...read(), logoUrl };
    try { await api('/api/admin/settings', { method: 'PUT', body: { restaurant } }); toast('Αποθηκεύτηκε', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function renderSettings() {
  const s = settings;
  $('#app').innerHTML = `<div class="panel" style="max-width:820px">
    <h3 style="margin-top:0">🧾 Ροή παραγγελιών</h3>
    <label class="switch"><input type="checkbox" id="approval" ${s.requireApproval ? 'checked' : ''}>
      <span><b>Έγκριση από σερβιτόρο πριν την κουζίνα</b><br><span class="muted small">Ο σερβιτόρος βλέπει την παραγγελία, την περνάει στο ταμείο/POS και την εγκρίνει.</span></span></label>
    <div class="note-box">⚖️ <b>Σημαντικό για myDATA:</b> στην εστίαση με σερβίρισμα κάθε παραγγελία πρέπει να καταγράφεται ως
      «Δελτίο Παραγγελίας Εστίασης» από πιστοποιημένη ταμειακή/πάροχο. Με την έγκριση ενεργή, ο σερβιτόρος καταχωρεί την παραγγελία
      στο ταμείο σας. Συμβουλευτείτε τον λογιστή σας πριν την απενεργοποιήσετε.</div>

    <h3>💳 Online πληρωμές</h3>
    <select class="input" id="payments" style="max-width:360px">
      <option value="off" ${s.onlinePayments === 'off' ? 'selected' : ''}>Απενεργοποιημένες (μόνο μετρητά/κάρτα στο τραπέζι)</option>
      <option value="demo" ${s.onlinePayments === 'demo' ? 'selected' : ''}>Δοκιμαστική λειτουργία (demo)</option>
    </select>
    <p class="muted small">Η πραγματική σύνδεση με Viva Wallet / Stripe θα προστεθεί σε επόμενη έκδοση.</p>

    <h3>🌍 Γλώσσες μενού</h3>
    <div class="checks">${s.allLanguages.map((l) => `<label><input type="checkbox" data-lang-on="${l}" ${s.languages.includes(l) ? 'checked' : ''}>${LANGUAGES[l].flag} ${LANGUAGES[l].name}</label>`).join('')}</div>
    <label class="field" style="margin-top:.8rem;max-width:360px"><span>Προεπιλεγμένη γλώσσα</span><select class="input" id="defLang">
      ${s.allLanguages.map((l) => `<option value="${l}" ${s.defaultLanguage === l ? 'selected' : ''}>${LANGUAGES[l].flag} ${LANGUAGES[l].name}</option>`).join('')}
    </select></label>
    <p class="muted small">Ο πελάτης βλέπει αυτόματα τη γλώσσα του κινητού του, αν είναι διαθέσιμη.</p>

    <h3>🔐 PIN προσωπικού</h3>
    <div class="two">
      <label class="field"><span>Admin (τρέχον: ${esc(s.pins.admin)})</span><input class="input" id="pinAdmin" inputmode="numeric" placeholder="νέο PIN (4-8 ψηφία)"></label>
      <label class="field"><span>Σερβιτόρος (τρέχον: ${esc(s.pins.waiter)})</span><input class="input" id="pinWaiter" inputmode="numeric" placeholder="νέο PIN"></label>
      <label class="field"><span>Κουζίνα (τρέχον: ${esc(s.pins.kitchen)})</span><input class="input" id="pinKitchen" inputmode="numeric" placeholder="νέο PIN"></label>
    </div>

    <h3>🌐 Δημόσια διεύθυνση</h3>
    <label class="field"><span>Η διεύθυνση που θα ανοίγουν τα QR (π.χ. https://menu.taverna-nikos.gr ή http://192.168.1.20:3000)</span>
      <input class="input" id="baseUrl" value="${esc(s.publicBaseUrl)}" placeholder="${esc(location.origin)}"></label>

    <button class="btn" id="save">💾 Αποθήκευση ρυθμίσεων</button>
  </div>`;
  $('#save').onclick = async () => {
    const body = {
      requireApproval: $('#approval').checked,
      onlinePayments: $('#payments').value,
      languages: $$('[data-lang-on]').filter((c) => c.checked).map((c) => c.dataset.langOn),
      defaultLanguage: $('#defLang').value,
      pins: { admin: $('#pinAdmin').value.trim(), waiter: $('#pinWaiter').value.trim(), kitchen: $('#pinKitchen').value.trim() },
      publicBaseUrl: $('#baseUrl').value.trim(),
    };
    try { await api('/api/admin/settings', { method: 'PUT', body }); toast('Οι ρυθμίσεις αποθηκεύτηκαν', 'ok'); render(); }
    catch (err) { toast(err.message, 'err'); }
  };
}
