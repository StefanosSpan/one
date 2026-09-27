import { $, $$, esc, api, toast, beep } from './util.js';
import { icon } from './icons.js';
import { requireLogin, topBar, liveStaff, itemName, spotName } from './staff.js';

const me = await requireLogin(['kitchen']);
if (me) start();

const LATE_MIN = 15;

function elapsed(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return { text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, late: s / 60 >= LATE_MIN };
}

function start() {
  const bar = topBar(me, 'kitchen', 'Κουζίνα · Πάσο');
  let orders = [];
  let known = null;

  async function load() {
    try { ({ orders } = await api('/api/staff/overview')); } catch { return; }
    const incoming = new Set(orders.filter((o) => o.status === 'accepted').map((o) => o.id));
    if (known && [...incoming].some((id) => !known.has(id))) {
      if (bar.soundEnabled()) beep(4);
      toast('Νέα παραγγελία στην κουζίνα', 'ok');
    }
    known = incoming;
    render();
  }

  const setStatus = async (id, status) => {
    try { await api(`/api/staff/orders/${id}/status`, { method: 'POST', body: { status } }); await load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  function ticket(o, actions) {
    const e = elapsed(o.createdAt);
    return `<div class="ticket ${o.status === 'ready' ? 'ready' : e.late ? 'late' : ''}">
      <div class="panel-head"><span class="tbl">${esc(spotName(o.tableKind, o.tableLabel))}</span>
        <span class="elapsed ${e.late && o.status !== 'ready' ? 'late' : ''}" data-since="${esc(o.createdAt)}">${icon('clock', 16)} <span>${e.text}</span></span></div>
      <div class="meta">Παραγγελία #${o.id}</div>
      <div class="items">${o.items.map((i) => `<div><span class="q">${i.qty}×</span>${esc(itemName(i.name))}
        ${i.note ? `<span class="inote">${esc(i.note)}</span>` : ''}</div>`).join('')}</div>
      ${o.note ? `<div class="onote">${icon('message', 14)} ${esc(o.note)}</div>` : ''}
      <div class="row">${actions}</div>
    </div>`;
  }

  function render() {
    const neu = orders.filter((o) => o.status === 'accepted');
    const prep = orders.filter((o) => o.status === 'preparing');
    const ready = orders.filter((o) => o.status === 'ready');
    const col = (title, list, fn) => `<section class="kcol"><h2><span>${title}</span><span class="n">${list.length}</span></h2>
      ${list.length ? list.map(fn).join('') : '<p class="kempty">Καμία παραγγελία</p>'}</section>`;
    $('#app').innerHTML = `<div class="kcols">
      ${col('Νέες', neu, (o) => ticket(o, `
        <button class="btn sm" data-id="${o.id}" data-s="preparing">${icon('play', 15)} Έναρξη</button>
        <button class="btn success sm" data-id="${o.id}" data-s="ready">${icon('check', 16)} Έτοιμο</button>`))}
      ${col('Ετοιμάζονται', prep, (o) => ticket(o, `
        <button class="btn secondary sm" data-id="${o.id}" data-s="accepted" title="Επιστροφή">${icon('undo', 16)}</button>
        <button class="btn success sm" data-id="${o.id}" data-s="ready">${icon('check', 16)} Έτοιμο για πάσο</button>`))}
      ${col('Στο πάσο', ready, (o) => ticket(o, `
        <button class="btn secondary sm" data-id="${o.id}" data-s="preparing">${icon('undo', 16)} Επιστροφή</button>`))}
    </div>`;
    $$('[data-s]').forEach((b) => b.onclick = () => setStatus(b.dataset.id, b.dataset.s));
  }

  setInterval(() => {
    $$('[data-since]').forEach((el) => {
      const e = elapsed(el.dataset.since);
      el.querySelector('span').textContent = e.text;
    });
  }, 1000);

  liveStaff(load);
  load();
}
