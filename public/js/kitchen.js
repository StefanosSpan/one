import { $, $$, esc, api, toast, beep } from './util.js';
import { requireLogin, topBar, liveStaff, itemName } from './staff.js';

const me = await requireLogin(['kitchen']);
if (me) start();

const LATE_MIN = 15;

function elapsed(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return { text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, late: s / 60 >= LATE_MIN };
}

function start() {
  const bar = topBar(me, 'kitchen', '🔥 Κουζίνα – Πάσο');
  let orders = [];
  let known = null;

  async function load() {
    try { ({ orders } = await api('/api/staff/overview')); } catch { return; }
    const incoming = new Set(orders.filter((o) => o.status === 'accepted').map((o) => o.id));
    if (known && [...incoming].some((id) => !known.has(id))) {
      if (bar.soundEnabled()) beep(4);
      toast('🆕 Νέα παραγγελία στην κουζίνα!', 'ok');
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
      <div class="panel-head"><span class="tbl">Τραπέζι ${esc(o.tableLabel)}</span>
        <span class="elapsed ${e.late && o.status !== 'ready' ? 'late' : ''}" data-since="${esc(o.createdAt)}">⏱ ${e.text}</span></div>
      <div class="muted small">#${o.id}</div>
      <div class="items">${o.items.map((i) => `<div><span class="q">${i.qty}×</span>${esc(itemName(i.name))}
        ${i.note ? `<span class="inote">↳ ${esc(i.note)}</span>` : ''}</div>`).join('')}</div>
      ${o.note ? `<div class="onote">💬 ${esc(o.note)}</div>` : ''}
      <div class="row">${actions}</div>
    </div>`;
  }

  function render() {
    const neu = orders.filter((o) => o.status === 'accepted');
    const prep = orders.filter((o) => o.status === 'preparing');
    const ready = orders.filter((o) => o.status === 'ready');
    const col = (title, list, fn, empty) => `<section class="kcol"><h2><span>${title}</span><span>${list.length}</span></h2>
      ${list.length ? list.map(fn).join('') : `<p style="color:#9ca3af">${empty}</p>`}</section>`;
    $('#app').innerHTML = `<div class="kcols">
      ${col('🆕 Νέες', neu, (o) => ticket(o, `
        <button class="btn sm" data-id="${o.id}" data-s="preparing">▶ Ξεκίνα</button>
        <button class="btn success sm" data-id="${o.id}" data-s="ready">✓ Έτοιμο</button>`), 'Καμία νέα παραγγελία')}
      ${col('👨‍🍳 Ετοιμάζονται', prep, (o) => ticket(o, `
        <button class="btn secondary sm" data-id="${o.id}" data-s="accepted">↩</button>
        <button class="btn success sm" data-id="${o.id}" data-s="ready">✓ Έτοιμο για πάσο</button>`), '—')}
      ${col('✅ Στο πάσο (για σερβίρισμα)', ready, (o) => ticket(o, `
        <button class="btn secondary sm" data-id="${o.id}" data-s="preparing">↩ Επιστροφή</button>`), '—')}
    </div>`;
    $$('[data-s]').forEach((b) => b.onclick = () => setStatus(b.dataset.id, b.dataset.s));
  }

  setInterval(() => {
    $$('[data-since]').forEach((el) => {
      const e = elapsed(el.dataset.since);
      el.textContent = `⏱ ${e.text}`;
    });
  }, 1000);

  liveStaff(load);
  load();
}
