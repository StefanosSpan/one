import { $, $$, esc, api, toast, beep } from './util.js';
import { icon } from './icons.js';
import { requireLogin, topBar, liveStaff, itemName, optionNames, spotName } from './staff.js';

const me = await requireLogin(['kitchen']);
if (me) start();

const LATE_MIN = 15;

function elapsed(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return { text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, late: s / 60 >= LATE_MIN };
}

function start() {
  const bar = topBar(me, 'kitchen', 'Κουζίνα · Πάσο');
  // Optional automatic printing of each new order on the kitchen printer (hidden frame -> browser print).
  // With Chrome started as --kiosk-printing it prints silently to the default printer.
  const AUTO_KEY = 'kitchenAutoPrint';
  let autoPrint = false;
  try { autoPrint = localStorage.getItem(AUTO_KEY) === '1'; } catch { /* ignore */ }
  const printed = new Set();
  // Station: each prep station (kitchen, bar…) can have its own screen; "all" shows everything.
  const STATION_KEY = 'station';
  let station = 'all';
  try { station = localStorage.getItem(STATION_KEY) || 'all'; } catch { /* ignore */ }
  if (station !== 'all' && !me.stations.some((st) => st.id === station)) station = 'all';
  const stSel = document.createElement('select');
  stSel.className = 'input station-select';
  stSel.innerHTML = `<option value="all">Όλα τα πόστα</option>${me.stations.map((st) => `<option value="${esc(st.id)}">${esc(st.name)}</option>`).join('')}`;
  stSel.value = station;
  stSel.onchange = () => { station = stSel.value; try { localStorage.setItem(STATION_KEY, station); } catch { /* ignore */ } known = null; load(); };
  document.querySelector('#soundBtn').before(stSel);
  const mine = (o) => (station === 'all' ? o.items : o.items.filter((i) => i.station === station));
  const apBtn = document.createElement('button');
  apBtn.title = 'Αυτόματη εκτύπωση νέων παραγγελιών';
  const drawAp = () => { apBtn.innerHTML = `${icon('printer', 16)}<span>Αυτόματη εκτύπωση: ${autoPrint ? 'ναι' : 'όχι'}</span>`; apBtn.classList.toggle('on', autoPrint); };
  apBtn.onclick = () => { autoPrint = !autoPrint; try { localStorage.setItem(AUTO_KEY, autoPrint ? '1' : '0'); } catch { /* ignore */ } drawAp(); };
  drawAp();
  document.querySelector('#soundBtn').before(apBtn);
  const printQueue = [];
  const printNext = () => {
    const id = printQueue[0];
    if (id == null || document.getElementById('printFrame')) return;
    const f = document.createElement('iframe');
    f.id = 'printFrame';
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    f.src = `/staff/print/order/${id}?embed=1${station !== 'all' ? `&station=${encodeURIComponent(station)}` : ''}`;
    let finished = false;
    const done = () => { if (finished) return; finished = true; f.remove(); printQueue.shift(); printNext(); };
    f.onload = () => f.contentWindow.addEventListener('afterprint', () => setTimeout(done, 300));
    document.body.append(f);
    setTimeout(done, 60_000); // safety net if the print dialog never reports back
  };
  let orders = [];
  let waiting = 0; // orders the waiter has not approved yet
  let known = null;

  // A kitchen screen stays on: the tablet must not go to sleep during service.
  let wake = null;
  const keepAwake = async () => { try { if (!wake && document.visibilityState === 'visible') { wake = await navigator.wakeLock?.request('screen'); wake?.addEventListener('release', () => { wake = null; }); } } catch { /* not supported */ } };
  document.addEventListener('visibilitychange', keepAwake);
  keepAwake();

  // Browsers play sound only after a tap: remind the kitchen once, until someone touches the screen.
  const hint = document.createElement('button');
  hint.className = 'sound-hint';
  hint.innerHTML = `${icon('volume', 18)} Πατήστε εδώ για να ακούγεται ήχος σε κάθε νέα παραγγελία`;
  document.querySelector('.bar').after(hint);
  document.addEventListener('pointerdown', () => { hint.remove(); keepAwake(); }, { once: true });

  async function load() {
    try { ({ orders } = await api('/api/staff/overview')); } catch { return; }
    orders = orders.filter((o) => mine(o).length);
    waiting = orders.filter((o) => o.status === 'pending').length;
    const incoming = new Set(orders.filter((o) => o.status === 'accepted').map((o) => o.id));
    if (known && autoPrint) {
      for (const id of incoming) if (!known.has(id) && !printed.has(id)) { printed.add(id); printQueue.push(id); }
      printNext();
    }
    if (known && [...incoming].some((id) => !known.has(id))) {
      if (bar.soundEnabled()) beep(4);
      toast('Νέα παραγγελία στην κουζίνα', 'ok');
    }
    known = incoming;
    render();
  }

  const post = async (path, body) => {
    try { await api(path, { method: 'POST', body }); await load(); } catch (e) { toast(e.message, 'err'); }
  };
  const setStatus = (id, status) => {
    // With a station selected, "ready" means "my part is ready"; the order is ready when every station is.
    if (status === 'ready' && station !== 'all') return post(`/api/staff/orders/${id}/station-ready`, { station });
    return post(`/api/staff/orders/${id}/status`, { status });
  };
  const eta = (o) => {
    if (!o.etaAt || o.status === 'ready') return '';
    const m = Math.round((new Date(o.etaAt) - Date.now()) / 60000);
    return `<span class="eta ${m < 0 ? 'late' : ''}">${m >= 0 ? `~${m}′` : `+${-m}′`}</span>`;
  };

  // Time counts from when the order reached the kitchen (after the waiter's approval).
  const since = (o) => o.acceptedAt || o.createdAt;
  function ticket(o, actions) {
    const e = elapsed(since(o));
    return `<div class="ticket s-${o.status} ${e.late && o.status !== 'ready' ? 'late' : ''}" data-status="${o.status}">
      <div class="ticket-head"><span class="tbl">${o.channel === 'takeaway' ? `Παραλαβή · ${esc(o.customer?.name || '')}` : esc(spotName(o.tableKind, o.tableLabel))}</span>${eta(o)}
        <span class="elapsed" data-since="${esc(since(o))}"><span>${e.text}</span></span></div>
      <div class="ticket-body">
        <div class="meta">#${o.id}${o.takenBy ? ` · ${esc(o.takenBy)}` : ''} · <a class="print-link" href="/staff/print/order/${o.id}${station !== 'all' ? `?station=${encodeURIComponent(station)}` : ''}" target="_blank">Εκτύπωση</a>
          ${o.status !== 'ready' ? ` · <button class="linklike" data-eta="${o.id}">+5′</button>` : ''}</div>
        <div class="items">${mine(o).map((i) => `<div><span class="q">${i.qty}×</span>${esc(itemName(i.name))}
          ${optionNames(i) ? `<span class="iopt">${esc(optionNames(i))}</span>` : ''}${i.note ? `<span class="inote">${esc(i.note)}</span>` : ''}</div>`).join('')}</div>
        ${o.note ? `<div class="onote">${esc(o.note)}</div>` : ''}
        ${o.voids?.length ? `<div class="kvoid">Ακυρώθηκε: ${esc(o.voids.map((v) => `${v.qty}× ${itemName(v.name)}`).join(', '))}</div>` : ''}
        <div class="row">${actions}</div>
      </div>
    </div>`;
  }

  function render() {
    const doneHere = (o) => station !== 'all' && mine(o).every((i) => i.ready);
    const neu = orders.filter((o) => o.status === 'accepted' && !doneHere(o));
    const prep = orders.filter((o) => o.status === 'preparing' && !doneHere(o));
    const ready = orders.filter((o) => o.status === 'ready' || (doneHere(o) && o.status !== 'served'));
    const col = (title, list, fn) => `<section class="kcol"><h2><span>${title}</span><span class="n">${list.length}</span></h2>
      ${list.length ? list.map(fn).join('') : '<p class="kempty">Καμία παραγγελία</p>'}</section>`;
    $('#app').innerHTML = `${waiting ? `<p class="kwaiting">${waiting === 1 ? '1 παραγγελία περιμένει' : `${waiting} παραγγελίες περιμένουν`} έγκριση από τον σερβιτόρο</p>` : ''}<div class="kcols">
      ${col('Νέες', neu, (o) => ticket(o, `
        <button class="btn secondary sm" data-id="${o.id}" data-s="preparing">Έναρξη</button>
        <button class="btn success sm" data-id="${o.id}" data-s="ready">Έτοιμο</button>`))}
      ${col('Ετοιμάζονται', prep, (o) => ticket(o, `
        <button class="btn secondary sm" data-id="${o.id}" data-s="accepted" style="flex:0 0 auto">Πίσω</button>
        <button class="btn success sm" data-id="${o.id}" data-s="ready">Έτοιμο για πάσο</button>`))}
      ${col('Στο πάσο', ready, (o) => ticket(o, o.status === 'ready' ? `
        <button class="btn secondary sm" data-id="${o.id}" data-s="preparing">Επιστροφή στην κουζίνα</button>` : '<span class="muted small">Περιμένει άλλο πόστο</span>'))}
    </div>`;
    $$('[data-s]').forEach((b) => b.onclick = () => setStatus(b.dataset.id, b.dataset.s));
    $$('[data-eta]').forEach((b) => b.onclick = () => post(`/api/staff/orders/${b.dataset.eta}/eta`, { add: 5 }));
  }

  setInterval(() => {
    $$('[data-since]').forEach((el) => {
      const e = elapsed(el.dataset.since);
      el.querySelector('span').textContent = e.text;
      const t = el.closest('.ticket');
      t.classList.toggle('late', e.late && t.dataset.status !== 'ready');
    });
  }, 1000);

  liveStaff(load);
  load();
}
