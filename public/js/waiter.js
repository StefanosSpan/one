import { $, $$, esc, api, toast, sheet, beep, timeAgo, euro } from './util.js';
import { requireLogin, topBar, liveStaff, LANG_FLAGS, itemName } from './staff.js';

const me = await requireLogin(['waiter']);
if (me) start();

const STATUS = {
  pending: ['Προς έγκριση', 'amber'], accepted: ['Στην κουζίνα', ''], preparing: ['Ετοιμάζεται', ''],
  ready: ['Έτοιμη', 'green'], served: ['Σερβιρίστηκε', 'gray'], rejected: ['Απορρίφθηκε', 'red'],
};

function start() {
  const bar = topBar(me, 'waiter', '🧑‍🍳 Σερβιτόρος');
  let data = null;
  let known = null; // ids we've already alerted about

  async function load(evt) {
    try { data = await api('/api/staff/overview'); } catch { return; }
    const alertIds = new Set([
      ...data.calls.map((c) => `c${c.id}${c.paymentMethod}`),
      ...data.orders.filter((o) => o.status === 'pending' || o.status === 'ready').map((o) => `o${o.id}${o.status}`),
    ]);
    if (known && [...alertIds].some((id) => !known.has(id))) {
      if (bar.soundEnabled()) beep(3);
      navigator.vibrate?.([200, 100, 200]);
      if (evt === 'call:new') toast('🔔 Νέα κλήση από τραπέζι', 'err');
      if (evt === 'order:new') toast('🧾 Νέα παραγγελία', 'ok');
    }
    if (evt === 'table:paid') toast('💳 Ένα τραπέζι πλήρωσε online', 'ok');
    known = alertIds;
    render();
  }

  const act = async (fn, okMsg) => {
    try { await fn(); if (okMsg) toast(okMsg, 'ok'); await load(); } catch (e) { toast(e.message, 'err'); }
  };
  const setStatus = (id, status) => act(() => api(`/api/staff/orders/${id}/status`, { method: 'POST', body: { status } }));

  function orderPanel(o, buttons) {
    const cls = o.status === 'pending' ? 'warn' : o.status === 'ready' ? 'good' : '';
    return `<div class="panel ${cls}">
      <div class="panel-head"><span class="tbl">Τρ. ${esc(o.tableLabel)}</span>
        <span class="muted small">#${o.id} · ${LANG_FLAGS[o.lang] || ''} · ${timeAgo(o.createdAt)}</span></div>
      ${o.items.map((i) => `<div class="oline"><span><b>${i.qty}×</b> ${esc(itemName(i.name))}${i.note ? `<span class="inote">↳ ${esc(i.note)}</span>` : ''}</span>
        <span class="muted">${euro(i.qty * i.price)}</span></div>`).join('')}
      ${o.note ? `<div class="onote">💬 ${esc(o.note)}</div>` : ''}
      <div class="panel-head" style="margin:.5rem 0 0"><span class="badge ${STATUS[o.status][1]}">${STATUS[o.status][0]}</span><b>${euro(o.total)}</b></div>
      ${buttons ? `<div class="row">${buttons}</div>` : ''}
    </div>`;
  }

  function render() {
    const { calls, orders, tables } = data;
    const pending = orders.filter((o) => o.status === 'pending');
    const ready = orders.filter((o) => o.status === 'ready');
    const inKitchen = orders.filter((o) => o.status === 'accepted' || o.status === 'preparing');

    $('#app').innerHTML = `
      <div class="grid">
        <section class="col">
          <h2>🔔 Κλήσεις <span class="n">${calls.length}</span></h2>
          ${calls.length ? calls.map((c) => `<div class="panel alert">
            <div class="panel-head"><span class="tbl">Τρ. ${esc(c.tableLabel)}</span><span class="muted small">${timeAgo(c.createdAt)}</span></div>
            <div>${c.type === 'bill'
              ? `🧾 <b>Ζητά λογαριασμό</b>${c.paymentMethod ? ` · ${c.paymentMethod === 'card' ? '💳 Κάρτα' : '💶 Μετρητά'}` : ''}`
              : '🙋 <b>Καλεί σερβιτόρο</b>'}</div>
            <div class="row">
              ${c.type === 'bill' ? `<button class="btn secondary sm" data-table="${c.tableId}">Λογαριασμός</button>` : ''}
              <button class="btn sm" data-call="${c.id}">✓ Εξυπηρετήθηκε</button>
            </div></div>`).join('') : '<div class="nothing">Καμία κλήση</div>'}

          <h2 style="margin-top:1.2rem">🧾 Προς έγκριση <span class="n">${pending.length}</span></h2>
          ${data.requireApproval ? '' : '<div class="nothing">Η έγκριση είναι απενεργοποιημένη – οι παραγγελίες πάνε κατευθείαν στην κουζίνα.</div>'}
          ${pending.length ? pending.map((o) => orderPanel(o, `
            <button class="btn danger sm" data-status="rejected" data-id="${o.id}">✕ Απόρριψη</button>
            <button class="btn success sm" data-status="accepted" data-id="${o.id}">✓ Έγκριση → Κουζίνα</button>`)).join('')
            : data.requireApproval ? '<div class="nothing">Δεν υπάρχουν νέες παραγγελίες</div>' : ''}
        </section>

        <section class="col">
          <h2>✅ Έτοιμα για σερβίρισμα <span class="n">${ready.length}</span></h2>
          ${ready.length ? ready.map((o) => orderPanel(o, `<button class="btn success sm" data-status="served" data-id="${o.id}">🍽️ Σερβιρίστηκε</button>`)).join('')
            : '<div class="nothing">Τίποτα έτοιμο ακόμη</div>'}
          <h2 style="margin-top:1.2rem">🔥 Στην κουζίνα <span class="n">${inKitchen.length}</span></h2>
          ${inKitchen.length ? inKitchen.map((o) => orderPanel(o)).join('') : '<div class="nothing">Καμία παραγγελία στην κουζίνα</div>'}
        </section>

        <section class="col">
          <h2>🪑 Τραπέζια <button class="btn secondary sm" id="soldOut" style="margin-left:auto">🚫 Εξαντλημένα</button></h2>
          <div class="tables">
            ${tables.filter((t) => t.active).map((t) => `<button class="tcard ${t.calls.length ? 'call' : t.orders ? 'busy' : ''}" data-table="${t.id}">
              <b>${esc(t.label)}</b>
              ${t.orders ? `<div class="small">${euro(t.total)}</div>` : '<div class="small muted">Ελεύθερο</div>'}
              ${t.total && t.paid >= t.total ? '<span class="badge green">Πληρώθηκε</span>' : ''}
              ${t.calls.map((c) => (c === 'bill' ? '🧾' : '🙋')).join(' ')}
            </button>`).join('')}
          </div>
        </section>
      </div>`;

    $$('[data-call]').forEach((b) => b.onclick = () => act(() => api(`/api/staff/calls/${b.dataset.call}/done`, { method: 'POST' })));
    $$('[data-status]').forEach((b) => b.onclick = () => setStatus(b.dataset.id, b.dataset.status));
    $$('[data-table]').forEach((b) => b.onclick = () => openTable(Number(b.dataset.table)));
    $('#soldOut').onclick = openSoldOut;
  }

  function openTable(id) {
    const t = data.tables.find((x) => x.id === id);
    const orders = data.orders.filter((o) => o.tableId === id);
    const billable = orders.filter((o) => o.status !== 'rejected');
    const { el, close } = sheet(`
      <div class="sheet-head"><h2>🪑 Τραπέζι ${esc(t.label)}</h2><button class="icon-btn" data-close>✕</button></div>
      ${orders.length ? orders.map((o) => orderPanel(o)).join('') : '<p class="muted">Δεν υπάρχουν ανοιχτές παραγγελίες.</p>'}
      ${billable.length ? `
        <div class="total-row" style="display:flex;justify-content:space-between;font-weight:800;font-size:1.2rem;margin:1rem 0">
          <span>Σύνολο</span><span>${euro(t.total)}</span></div>
        ${t.paid ? `<p class="badge green">Πληρωμένο online: ${euro(t.paid)}</p>` : ''}
        <button class="btn block success" id="closeT">✓ Εξόφληση & κλείσιμο τραπεζιού</button>
        <p class="muted small">Το τραπέζι αδειάζει για τους επόμενους πελάτες. Βεβαιωθείτε ότι έχει εκδοθεί απόδειξη από το ταμείο.</p>` : ''}
    `);
    $('#closeT', el)?.addEventListener('click', () => {
      if (!confirm(`Κλείσιμο τραπεζιού ${t.label};`)) return;
      close();
      act(() => api(`/api/staff/tables/${id}/close`, { method: 'POST' }), `Το τραπέζι ${t.label} έκλεισε`);
    });
  }

  async function openSoldOut() {
    const items = await api('/api/staff/items');
    const { el } = sheet(`
      <div class="sheet-head"><h2>🚫 Διαθεσιμότητα πιάτων</h2><button class="icon-btn" data-close>✕</button></div>
      <p class="muted small">Ό,τι ξετσεκάρετε εμφανίζεται «Εξαντλήθηκε» στους πελάτες αμέσως.</p>
      ${items.map((i) => `<label class="switch"><input type="checkbox" data-item="${i.id}" ${i.available ? 'checked' : ''}>
        <span>${esc(i.emoji)} ${esc(itemName(i.name))}</span></label>`).join('')}
    `);
    $$('[data-item]', el).forEach((c) => c.onchange = async () => {
      try {
        await api(`/api/staff/items/${c.dataset.item}/available`, { method: 'POST', body: { available: c.checked } });
        toast(c.checked ? 'Διαθέσιμο ξανά' : 'Σημειώθηκε ως εξαντλημένο', 'ok');
      } catch (e) { toast(e.message, 'err'); c.checked = !c.checked; }
    });
  }

  liveStaff(load);
  load();
  setInterval(() => data && render(), 30_000); // refresh "time ago"
}
