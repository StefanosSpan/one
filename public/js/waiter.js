import { $, $$, esc, api, toast, sheet, beep, timeAgo, euro } from './util.js';
import { icon } from './icons.js';
import { requireLogin, topBar, liveStaff, LANG_CODES, itemName, optionNames, spotName, KIND } from './staff.js';

const me = await requireLogin(['waiter']);
if (me) start();

const STATUS = {
  pending: ['Προς έγκριση', 'amber'], accepted: ['Στην κουζίνα', ''], preparing: ['Ετοιμάζεται', ''],
  ready: ['Έτοιμη', 'green'], served: ['Σερβιρίστηκε', 'gray'], rejected: ['Απορρίφθηκε', 'red'],
};

function start() {
  const bar = topBar(me, 'waiter', 'Σερβιτόρος');
  let data = null;
  let known = null;
  // A waiter with zones sees only their own tables by default; "all" shows the whole venue.
  const myZones = me.member?.zones || [];
  let onlyMine = myZones.length > 0;
  if (myZones.length) {
    const zb = document.createElement('button');
    zb.className = 'zone-toggle';
    const draw = () => { zb.innerHTML = `<span>${onlyMine ? `Ζώνες: ${esc(myZones.join(', '))}` : 'Όλες οι ζώνες'}</span>`; };
    zb.onclick = () => { onlyMine = !onlyMine; draw(); render(); };
    draw();
    document.querySelector('#soundBtn').before(zb);
  }
  const inZone = (zone) => !onlyMine || myZones.includes(zone || '');

  async function load(evt) {
    try { data = await api('/api/staff/overview'); } catch { return; }
    const alertIds = new Set([
      ...data.calls.map((c) => `c${c.id}${c.paymentMethod}`),
      ...data.orders.filter((o) => o.status === 'pending' || o.status === 'ready').map((o) => `o${o.id}${o.status}`),
    ]);
    if (known && [...alertIds].some((id) => !known.has(id))) {
      if (bar.soundEnabled()) beep(3);
      navigator.vibrate?.([200, 100, 200]);
      if (evt === 'call:new') toast('Νέα κλήση πελάτη', 'err');
      if (evt === 'order:new') toast('Νέα παραγγελία', 'ok');
    }
    if (evt === 'table:paid') toast('Ένας λογαριασμός εξοφλήθηκε online', 'ok');
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
      <div class="panel-head"><span class="tbl">${esc(spotName(o.tableKind, o.tableLabel))}${o.customer ? ` · ${esc(o.customer.name)}` : ''}</span>
        <span class="meta">#${o.id} · <span class="lang">${LANG_CODES[o.lang] || ''}</span> · ${timeAgo(o.createdAt)}</span></div>
      ${o.items.map((i) => `<div class="oline"><span><b>${i.qty}×</b> ${esc(itemName(i.name))}${optionNames(i) ? `<span class="iopt">${esc(optionNames(i))}</span>` : ''}${i.note ? `<span class="inote">${esc(i.note)}</span>` : ''}</span>
        <span class="muted">${euro(i.qty * i.price)}</span></div>`).join('')}
      ${o.note ? `<div class="onote">${esc(o.note)}</div>` : ''}
      ${o.loyaltyReward ? `<div class="loyal-note">Κάρτα πιστότητας: δικαιούται <b>${esc(o.loyaltyReward.el || o.loyaltyReward.en || 'δώρο')}</b>
        <button class="btn secondary sm" data-redeem="${o.id}">Δόθηκε</button></div>` : ''}
      ${o.customer ? `<div class="onote">Παραλαβή${o.customer.pickupAt ? ` στις ${new Date(o.customer.pickupAt).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })}` : ' το συντομότερο'}
        · <a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a></div>` : ''}
      <div class="panel-foot"><span class="badge ${STATUS[o.status][1]}">${STATUS[o.status][0]}</span>
        <span class="foot-right"><a class="print-link" href="/staff/print/order/${o.id}" target="_blank">Εκτύπωση δελτίου</a><b>${euro(o.total)}</b></span></div>
      ${buttons ? `<div class="row">${buttons}</div>` : ''}
    </div>`;
  }

  // Pick-up order handed over: choose how it was paid; it gets its own receipt.
  function handover(id) {
    const { el, close } = sheet(`
      <div class="sheet-head"><h2>Παράδοση παραγγελίας #${id}</h2><button class="icon-btn" data-close>${icon('x')}</button></div>
      <div class="seg">${[['cash', 'Μετρητά'], ['card', 'Κάρτα'], ['online', 'Online']].map(([k, l], i) => `<button type="button" data-m="${k}" class="${i ? '' : 'active'}">${l}</button>`).join('')}</div>
      <label class="field"><span>Αρ. νόμιμης απόδειξης / ΜΑΡΚ (προαιρετικό)</span><input class="input" id="fr"></label>
      <button class="btn block" id="ok">Παραδόθηκε</button>`);
    $$('[data-m]', el).forEach((b) => b.onclick = () => $$('[data-m]', el).forEach((x) => x.classList.toggle('active', x === b)));
    $('#ok', el).onclick = () => act(async () => {
      const r = await api(`/api/staff/orders/${id}/handover`, { method: 'POST', body: { paymentMethod: $('[data-m].active', el).dataset.m, fiscalRef: $('#fr', el).value } });
      close();
      if (r.receipt) window.open(`/staff/print/receipt/${r.receipt.id}`, '_blank');
    }, 'Η παραγγελία παραδόθηκε');
  }

  function render() {
    const calls = data.calls.filter((c) => inZone(c.tableZone));
    const orders = data.orders.filter((o) => o.channel === 'takeaway' || inZone(o.tableZone));
    const tables = data.tables.filter((t) => inZone(t.zone));
    const pending = orders.filter((o) => o.status === 'pending');
    const ready = orders.filter((o) => o.status === 'ready');
    const inKitchen = orders.filter((o) => o.status === 'accepted' || o.status === 'preparing');

    $('#app').innerHTML = `
      <div class="grid">
        <section class="col">
          <h2>Κλήσεις <span class="n">${calls.length}</span></h2>
          ${calls.length ? calls.map((c) => `<div class="panel alert">
            <div class="panel-head"><span class="tbl">${esc(spotName(c.tableKind, c.tableLabel))}</span><span class="meta">${timeAgo(c.createdAt)}</span></div>
            <div class="call-what">${c.type === 'bill'
              ? `Ζητά λογαριασμό${c.paymentMethod ? ` · ${c.paymentMethod === 'card' ? 'Κάρτα' : 'Μετρητά'}` : ''}`
              : 'Ζητά εξυπηρέτηση'}</div>
            <div class="row">
              ${c.type === 'bill' ? `<button class="btn secondary sm" data-table="${c.tableId}">Λογαριασμός</button>` : ''}
              <button class="btn sm" data-call="${c.id}">Εξυπηρετήθηκε</button>
            </div></div>`).join('') : '<div class="nothing">Καμία κλήση</div>'}

          <h2 class="mt">Προς έγκριση <span class="n">${pending.length}</span></h2>
          ${data.requireApproval ? '' : '<div class="nothing">Η έγκριση είναι απενεργοποιημένη. Οι παραγγελίες πηγαίνουν απευθείας στην κουζίνα.</div>'}
          ${pending.length ? pending.map((o) => orderPanel(o, `
            <button class="btn danger sm" data-status="rejected" data-id="${o.id}">Απόρριψη</button>
            <button class="btn success sm" data-status="accepted" data-id="${o.id}">Έγκριση</button>`)).join('')
            : data.requireApproval ? '<div class="nothing">Δεν υπάρχουν νέες παραγγελίες</div>' : ''}
        </section>

        <section class="col">
          <h2>Έτοιμα για σερβίρισμα <span class="n">${ready.length}</span></h2>
          ${ready.length ? ready.map((o) => orderPanel(o, o.channel === 'takeaway'
            ? `<button class="btn success sm" data-handover="${o.id}">Παράδοση και πληρωμή</button>`
            : `<button class="btn success sm" data-status="served" data-id="${o.id}">Σερβιρίστηκε</button>`)).join('')
            : '<div class="nothing">Τίποτα έτοιμο ακόμη</div>'}
          <h2 class="mt">Στην κουζίνα <span class="n">${inKitchen.length}</span></h2>
          ${inKitchen.length ? inKitchen.map((o) => orderPanel(o)).join('') : '<div class="nothing">Καμία παραγγελία στην κουζίνα</div>'}
        </section>

        <section class="col">
          <h2>Θέσεις <button class="btn secondary sm push" id="soldOut">Διαθεσιμότητα πιάτων</button></h2>
          <div class="tables">
            ${tables.filter((t) => t.active).map((t) => `<button class="tcard ${t.calls.length ? 'call' : t.orders ? 'busy' : ''}" data-table="${t.id}">
              <span class="tkind">${esc((KIND[t.kind] || KIND.table).one)}</span>
              <b>${esc(t.label)}</b>
              ${t.orders ? `<div class="small">${euro(t.total)}</div>` : '<div class="small muted">Ελεύθερο</div>'}
              ${t.total && t.paid >= t.total ? '<span class="badge green">Εξοφλήθηκε</span>' : ''}
              ${t.calls.length ? `<span class="tcalls">${t.calls.map((c) => icon(c === 'bill' ? 'receipt' : 'bell', 14)).join('')}</span>` : ''}
            </button>`).join('')}
          </div>
        </section>
      </div>`;

    $$('[data-call]').forEach((b) => b.onclick = () => act(() => api(`/api/staff/calls/${b.dataset.call}/done`, { method: 'POST' })));
    $$('[data-handover]').forEach((b) => b.onclick = () => handover(Number(b.dataset.handover)));
    $$('[data-redeem]').forEach((b) => b.onclick = () => act(() => api(`/api/staff/orders/${b.dataset.redeem}/redeem`, { method: 'POST' }), 'Η επιβράβευση καταγράφηκε'));
    $$('[data-status]').forEach((b) => b.onclick = () => setStatus(b.dataset.id, b.dataset.status));
    $$('[data-table]').forEach((b) => b.onclick = () => openTable(Number(b.dataset.table)));
    $('#soldOut').onclick = openSoldOut;
  }

  function openTable(id) {
    const t = data.tables.find((x) => x.id === id);
    const orders = data.orders.filter((o) => o.tableId === id);
    const billable = orders.filter((o) => o.status !== 'rejected');
    const billCall = data.calls.find((c) => c.tableId === id && c.type === 'bill');
    const { el, close } = sheet(`
      <div class="sheet-head"><h2>${esc(spotName(t.kind, t.label))}</h2><button class="icon-btn" data-close>${icon('x', 18)}</button></div>
      ${orders.length ? orders.map((o) => orderPanel(o)).join('') : '<p class="muted">Δεν υπάρχουν ανοιχτές παραγγελίες.</p>'}
      ${billable.length ? `
        <div class="sum-row"><span>Σύνολο</span><span>${euro(t.total)}</span></div>
        ${t.paid ? `<p class="badge green">Εξοφλήθηκε online: ${euro(t.paid)}</p>` : ''}
        <div class="close-box">
          <div class="field"><span class="lbl">Τρόπος πληρωμής</span>
            <div class="seg" id="pay">
              ${[['cash', 'Μετρητά'], ['card', 'Κάρτα'], ['online', 'Online'], ...(t.kind === 'room' ? [['room', 'Δωμάτιο']] : [])].map(([k, l]) => `<button type="button" data-pay="${k}"
                class="${(t.paid >= t.total ? 'online' : billCall?.paymentMethod || 'cash') === k ? 'active' : ''}">${l}</button>`).join('')}
            </div>
          </div>
          <label class="field"><span>Αρ. απόδειξης ταμειακής / ΜΑΡΚ (προαιρετικό)</span>
            <input class="input" id="fiscal" maxlength="80" placeholder="Από την ταμειακή ή τον πάροχο"></label>
          <label class="switch"><input type="checkbox" id="printR" checked> Εκτύπωση απόδειξης λογαριασμού</label>
          <button class="btn block success" id="closeT">Εξόφληση και κλείσιμο</button>
          <p class="muted small">Η απόδειξη αποθηκεύεται και ο πελάτης λαμβάνει ψηφιακό αντίγραφο στο κινητό του.
            Η νόμιμη απόδειξη εκδίδεται από το ταμείο σας.</p>
        </div>` : ''}
    `);
    $$('[data-pay]', el).forEach((b) => b.onclick = () => $$('[data-pay]', el).forEach((x) => x.classList.toggle('active', x === b)));
    $('#closeT', el)?.addEventListener('click', async () => {
      const paymentMethod = $('[data-pay].active', el)?.dataset.pay || 'cash';
      const fiscalRef = $('#fiscal', el).value.trim();
      // Open the print window now (inside the click) so the browser does not block it.
      const win = $('#printR', el).checked ? window.open('about:blank', '_blank') : null;
      try {
        const { receipt } = await api(`/api/staff/tables/${id}/close`, { method: 'POST', body: { paymentMethod, fiscalRef } });
        close();
        toast(receipt ? `${spotName(t.kind, t.label)}: έκλεισε · Απόδειξη ${receipt.number}` : `${spotName(t.kind, t.label)}: έκλεισε`, 'ok');
        if (win && receipt) win.location = `/staff/print/receipt/${receipt.id}?auto=1`;
        else win?.close();
        await load();
      } catch (e) { win?.close(); toast(e.message, 'err'); }
    });
  }

  async function openSoldOut() {
    const items = await api('/api/staff/items');
    const { el } = sheet(`
      <div class="sheet-head"><h2>Διαθεσιμότητα πιάτων</h2><button class="icon-btn" data-close>${icon('x', 18)}</button></div>
      <p class="muted small">Ό,τι απενεργοποιήσετε εμφανίζεται αμέσως ως «Εξαντλήθηκε» στους πελάτες.</p>
      ${items.map((i) => `<label class="switch"><input type="checkbox" data-item="${i.id}" ${i.available ? 'checked' : ''}>
        <span>${esc(itemName(i.name))}</span></label>`).join('')}
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
  setInterval(() => data && render(), 30_000);
}
