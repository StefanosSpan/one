import { $, $$, esc, api, toast, sheet, euro } from './util.js';
import { icon } from './icons.js';
import { requireLogin, topBar, liveStaff, itemName, optionNames, KIND } from './staff.js';
import { LANGUAGES, STRINGS } from './i18n.js';
import { applyTheme, THEME_PRESETS } from './theme.js';

let settings = null;
const TAB_KEYS = ['dash', 'history', 'receipts', 'menu', 'tables', 'look', 'store', 'settings', 'billing'];
let tab = TAB_KEYS.includes(new URLSearchParams(location.search).get('tab')) ? new URLSearchParams(location.search).get('tab') : 'dash';

const me = await requireLogin(['admin']);
if (me) start();

const TAG_LABELS = { popular: 'Δημοφιλές', new: 'Νέο', vegetarian: 'Χορτοφαγικό', vegan: 'Vegan', gluten_free: 'Χωρίς γλουτένη', spicy: 'Πικάντικο',
  suggest: 'Προτείνεται στο καλάθι' };
const DAY_SHORT = ['Δε', 'Τρ', 'Τε', 'Πε', 'Πα', 'Σα', 'Κυ'];

// Days + hours editor, e.g. breakfast Mon–Sun 07:00–11:00 or happy hour 18:00–20:00.
function windowEditor(id, win) {
  const w = win || { days: [], from: '', to: '' };
  return `<div class="win" id="${id}">
    <div class="days">${DAY_SHORT.map((d, i) => `<label><input type="checkbox" value="${i + 1}" ${(w.days || []).includes(i + 1) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>
    <div class="times"><label>από <input class="input" type="time" data-w="from" value="${esc(w.from || '')}"></label>
      <label>έως <input class="input" type="time" data-w="to" value="${esc(w.to || '')}"></label></div>
    <p class="muted small">Χωρίς ημέρες = κάθε μέρα. Χωρίς ώρες = όλη μέρα. Μπορεί να περνά τα μεσάνυχτα (π.χ. 22:00–02:00).</p>
  </div>`;
}
const readWindow = (root) => ({
  days: $$('.days input:checked', root).map((c) => Number(c.value)),
  from: $('[data-w=from]', root).value, to: $('[data-w=to]', root).value,
});
const describeWindow = (w) => {
  if (!w) return '';
  const days = (w.days || []).length && w.days.length < 7 ? w.days.map((d) => DAY_SHORT[d - 1]).join(' ') : 'Κάθε μέρα';
  return `${days}${w.from && w.to ? ` ${w.from}–${w.to}` : ''}`;
};


function start() {
  topBar(me, 'admin', 'Διαχείριση');
  const tabs = [['dash', 'Επισκόπηση'], ['history', 'Ιστορικό παραγγελιών'], ['receipts', 'Αποδείξεις'], ['menu', 'Μενού'], ['tables', 'Θέσεις & QR'], ['look', 'Εμφάνιση'], ['store', 'Κατάστημα'], ['settings', 'Ρυθμίσεις'], ['billing', 'Συνδρομή']];
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('');
  $$('#tabs button').forEach((b) => b.onclick = () => go(b.dataset.tab));
  liveStaff((evt) => { if ((tab === 'dash' || tab === 'history') && evt.startsWith('order')) render(); });
  render();
}

function go(next) {
  tab = next;
  $$('#tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
  history.replaceState(null, '', tab === 'dash' ? location.pathname : `?tab=${tab}`);
  render();
}

async function render() {
  settings = await api('/api/admin/settings');
  const views = { dash: renderDash, history: renderHistory, receipts: renderReceipts, menu: renderMenu, tables: renderTables, look: renderLook, store: renderStore, settings: renderSettings, billing: renderBilling };
  await views[tab]();
  $$('[data-go]').forEach((b) => b.onclick = (e) => { e.preventDefault(); go(b.dataset.go); });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function i18nEditor(defs, values = {}) {
  const langs = settings.languages;
  return `<div class="i18n">
    <div class="lang-tabs">${langs.map((l, i) => `<button type="button" data-lang="${l}" class="${i === 0 ? 'active' : ''}">${LANGUAGES[l].short}</button>`).join('')}</div>
    ${langs.map((l, i) => `<div data-pane="${l}" ${i ? 'hidden' : ''}>
      ${defs.map((d) => `<label class="field"><span>${esc(d.label)} · ${LANGUAGES[l].name}</span>
        ${d.textarea
          ? `<textarea class="input" rows="2" maxlength="${d.max || 400}" data-f="${d.key}" data-l="${l}">${esc(values[d.key]?.[l] || '')}</textarea>`
          : `<input class="input" maxlength="${d.max || 100}" data-f="${d.key}" data-l="${l}" value="${esc(values[d.key]?.[l] || '')}">`}
      </label>`).join('')}
    </div>`).join('')}
    <p class="muted small">Όσες γλώσσες μείνουν κενές εμφανίζονται στα Αγγλικά ή στα Ελληνικά. Η κόκκινη ένδειξη σημαίνει ότι λείπει μετάφραση.</p>
  </div>`;
}

function bindI18n(root) {
  const box = $('.i18n', root);
  const mark = () => $$('[data-lang]', box).forEach((b) => {
    const first = $$(`[data-l="${b.dataset.lang}"]`, box)[0];
    b.classList.toggle('missing', !!first && !first.value.trim());
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

const readImage = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(file);
});

async function uploadImage(file) {
  if (file.size > 4 * 1024 * 1024) throw new Error('Η εικόνα ξεπερνά τα 4MB');
  const { url } = await api('/api/admin/upload', { method: 'POST', body: { dataUrl: await readImage(file) } });
  return url;
}

// Photo picker with preview. Returns a getter for the current URL.
function photoField(root, sel, initial, { wide = false, contain = false, onChange } = {}) {
  let url = initial || '';
  const box = $(sel, root);
  const draw = () => {
    onChange?.(url);
    box.innerHTML = `<div class="photo-drop ${wide ? 'wide' : ''} ${contain ? 'contain' : ''} ${url ? 'has' : ''}">
      ${url ? `<img src="${esc(url)}" alt="">` : `<div class="ph">${icon('image', 26)}<span>Ανέβασμα φωτογραφίας</span><small>JPG, PNG, WEBP · έως 4MB</small></div>`}
      <input type="file" accept="image/*">
    </div>
    ${url ? `<button type="button" class="btn ghost sm rm">${icon('trash', 14)} Αφαίρεση φωτογραφίας</button>` : ''}`;
    $('input', box).onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { url = await uploadImage(f); draw(); } catch (err) { toast(err.message, 'err'); }
    };
    $('.rm', box)?.addEventListener('click', () => { url = ''; draw(); });
  };
  draw();
  return () => url;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
let statDays = 1;
async function renderDash() {
  const [s, spots, menu] = await Promise.all([api(`/api/admin/stats?days=${statDays}`), api('/api/admin/tables'), api('/api/admin/menu')]);
  const max = Math.max(1, ...s.byDay.map((d) => d.revenue));
  $('#app').innerHTML = `
    ${planBanner()}
    ${setupChecklist(spots, menu, s)}
    <div class="seg">
      ${[[1, 'Σήμερα'], [7, '7 ημέρες'], [30, '30 ημέρες']].map(([d, l]) => `<button class="${statDays === d ? 'active' : ''}" data-days="${d}">${l}</button>`).join('')}
    </div>
    <div class="stats">
      <div class="stat"><div class="l">Τζίρος παραγγελιών QR</div><div class="v">${euro(s.revenue)}</div></div>
      <div class="stat"><div class="l">Παραγγελίες</div><div class="v">${s.orders}</div></div>
      <div class="stat"><div class="l">Μέση παραγγελία</div><div class="v">${euro(s.avg)}</div></div>
      <div class="stat"><div class="l">Απορρίφθηκαν</div><div class="v">${s.rejected}</div></div>
    </div>
    <div class="grid">
      <div class="panel"><h3>Δημοφιλέστερα πιάτα</h3>
        ${s.top.length ? s.top.map((t, i) => `<div class="oline"><span><span class="rank">${i + 1}</span>${esc(itemName(t.name))}</span><span><b>${t.qty}</b> · ${euro(t.revenue)}</span></div>`).join('') : '<p class="muted">Δεν υπάρχουν ακόμη παραγγελίες.</p>'}
      </div>
      <div class="panel"><h3>Γλώσσες πελατών</h3>
        ${s.langs.length ? s.langs.map((l) => `<div class="oline"><span><span class="rank">${LANGUAGES[l.lang]?.short || l.lang}</span>${esc(LANGUAGES[l.lang]?.name || l.lang)}</span><b>${l.n}</b></div>`).join('') : '<p class="muted">—</p>'}
      </div>
      ${statDays > 1 ? `<div class="panel"><h3>Τζίρος ανά ημέρα</h3>
        <div class="bars" style="margin-bottom:1.5rem">${s.byDay.map((d) => `<div style="height:${Math.round((d.revenue / max) * 100)}%" title="${d.day}: ${euro(d.revenue)}"><span>${d.day.slice(8)}/${d.day.slice(5, 7)}</span></div>`).join('')}</div>
      </div>` : ''}
      <div class="panel"><h3>Γρήγορη δοκιμή</h3>
        <p class="muted small">Ανοίξτε το μενού μιας θέσης σε άλλη καρτέλα ή στο κινητό σας και κάντε μια δοκιμαστική παραγγελία.</p>
        <div class="links">
          ${spots.filter((t) => t.active).slice(0, 3).map((t) => `<a class="btn secondary sm" href="${esc(t.url)}" target="_blank">Μενού · ${esc((KIND[t.kind] || KIND.table).one)} ${esc(t.label)}</a>`).join('')}
          <a class="btn secondary sm" href="/staff/waiter" target="_blank">Σερβιτόρος</a>
          <a class="btn secondary sm" href="/staff/kitchen" target="_blank">Κουζίνα</a>
        </div>
      </div>
    </div>`;
  $$('[data-days]').forEach((b) => b.onclick = () => { statDays = Number(b.dataset.days); render(); });
  $('#hideSetup')?.addEventListener('click', () => {
    try { localStorage.setItem(`setupDone:${settings.venue.slug}`, '1'); } catch { /* private mode */ }
    $('#setup').remove();
  });
}

// ---------------------------------------------------------------------------
// Subscription state and first steps after sign-up
// ---------------------------------------------------------------------------
const daysLeft = (iso) => Math.max(0, Math.ceil((new Date(iso) - Date.now()) / 86400_000));

function planBanner() {
  const v = settings.venue;
  if (v.isDemo) return '';
  const name = v.features.name;
  if (v.status === 'trialing' && v.effectivePlan) {
    const d = daysLeft(v.trialEndsAt);
    return `<div class="plan-banner"><span>Δωρεάν δοκιμή του πλάνου <b>${esc(name)}</b>: απομένουν <b>${d} ${d === 1 ? 'ημέρα' : 'ημέρες'}</b>. Δεν χρειάζεται κάρτα μέχρι τότε.</span>
      <a class="btn sm" href="?tab=billing" data-go="billing">Επιλογή πλάνου</a></div>`;
  }
  if (v.status === 'past_due') {
    return `<div class="plan-banner warn"><span>Η τελευταία πληρωμή της συνδρομής απέτυχε. Ενημερώστε την κάρτα σας για να μη διακοπούν οι παραγγελίες.</span>
      <a class="btn sm" href="?tab=billing" data-go="billing">Συνδρομή</a></div>`;
  }
  if (!v.effectivePlan) {
    const why = v.status === 'paused' ? 'Η συνδρομή είναι σε πάγωμα.' : v.status === 'trialing' ? 'Η δωρεάν δοκιμή έληξε.' : 'Δεν υπάρχει ενεργή συνδρομή.';
    return `<div class="plan-banner warn"><span>${why} Οι πελάτες δεν βλέπουν το μενού όταν σκανάρουν τα QR. Όλα τα δεδομένα σας είναι αποθηκευμένα και τα QR ξαναδουλεύουν μόλις ενεργοποιήσετε συνδρομή.</span>
      <a class="btn sm" href="?tab=billing" data-go="billing">${v.status === 'paused' ? 'Επανενεργοποίηση' : 'Επιλογή πλάνου'}</a></div>`;
  }
  return '';
}

function setupChecklist(spots, menu, stats) {
  const v = settings.venue;
  let hidden = false;
  try { hidden = localStorage.getItem(`setupDone:${v.slug}`) === '1'; } catch { /* private mode */ }
  if (v.isDemo || hidden) return '';
  const r = settings.restaurant || {};
  const steps = [
    [!!(r.phone || r.address || r.logoUrl), 'Στοιχεία και λογότυπο', 'Διεύθυνση, τηλέφωνο, ωράριο, Wi-Fi και λογότυπο.', 'store'],
    [menu.items.length > 0, 'Το μενού σας', menu.items.length ? `${menu.items.length} πιάτα. Αν ξεκινήσατε με το δείγμα, αλλάξτε ή διαγράψτε ό,τι δεν ισχύει.` : 'Προσθέστε κατηγορίες και πιάτα.', 'menu'],
    [spots.length > 0, 'Θέσεις και QR', `${spots.length} θέσεις. Τυπώστε τα QR σε αυτοκόλλητα ή επιτραπέζιες κάρτες.`, 'tables'],
    [false, 'Το προσωπικό σας', 'Στείλτε στους σερβιτόρους τον σύνδεσμο σύνδεσης και το PIN τους.', 'settings'],
    [stats.orders > 0, 'Δοκιμαστική παραγγελία', 'Σκανάρετε ένα QR με το κινητό σας και στείλτε μια παραγγελία.', 'dash'],
  ];
  return `<div class="panel setup" id="setup">
    <div class="setup-head"><h3>Πρώτα βήματα</h3><button class="btn ghost sm" id="hideSetup">Απόκρυψη</button></div>
    <ol>${steps.map(([done, title, text, target]) => `<li class="${done ? 'done' : ''}">
      <span class="tick">${done ? icon('check', 14) : ''}</span>
      <div><b>${title}</b><p class="muted small">${text}</p></div>
      ${target !== 'dash' ? `<a class="btn secondary sm" href="?tab=${target}" data-go="${target}">Άνοιγμα</a>` : ''}
    </li>`).join('')}</ol>
  </div>`;
}

const PLAN_ORDER = ['pro', 'plus'];
const STATUS_TEXT = { trialing: 'Δωρεάν δοκιμή', active: 'Ενεργή', past_due: 'Εκκρεμεί πληρωμή', paused: 'Σε πάγωμα', canceled: 'Ακυρώθηκε' };

async function renderBilling() {
  let acc;
  try { acc = await api('/api/account'); } catch (e) {
    $('#app').innerHTML = `<div class="panel narrow"><h3>Συνδρομή</h3><p>${esc(e.message)}</p>
      <a class="btn" href="/login">Σύνδεση ιδιοκτήτη</a></div>`;
    return;
  }
  const v = acc.venue;
  const params = new URLSearchParams(location.search);
  if (params.get('checkout') === 'success') toast('Ευχαριστούμε! Η συνδρομή ενεργοποιείται σε λίγα δευτερόλεπτα.', 'ok');
  let interval = v.interval || 'month';
  const limits = (p) => [p.maxSpots ? `Έως ${p.maxSpots} θέσεις με QR` : 'Πάνω από 50 θέσεις με QR, χωρίς όριο',
    'Όλες οι δυνατότητες: παραγγελία, πληρωμή από το κινητό, πόστα, happy hour', 'Τραπέζια, δωμάτια και ξαπλώστρες', 'Μενού σε 8 γλώσσες, δική σας εμφάνιση'];
  const paidNow = ['active', 'past_due'].includes(v.status);

  const draw = () => {
    $('#app').innerHTML = `${planBanner()}
    <div class="panel">
      <h3>Η συνδρομή σας</h3>
      <div class="kv"><span>Πλάνο</span><b>${esc(acc.plans[v.plan]?.name || 'Kalimenu')}${v.effectivePlan ? '' : ' <span class="muted">(ανενεργό)</span>'}</b></div>
      <div class="kv"><span>Κατάσταση</span><b>${STATUS_TEXT[v.status] || v.status}${v.status === 'trialing' ? ` · λήγει ${new Date(v.trialEndsAt).toLocaleDateString('el-GR')}` : ''}</b></div>
      ${paidNow ? `<div class="kv"><span>Χρέωση</span><b>${v.interval === 'year' ? 'Ετήσια' : 'Μηνιαία'}</b></div>` : ''}
      <div class="kv"><span>Χρήση</span><b>${acc.usage.items} πιάτα · ${acc.usage.spots} θέσεις</b></div>
      <div class="kv"><span>Λογαριασμός</span><b>${esc(acc.email)}</b></div>
      <div class="links" style="margin-top:1rem">
        ${acc.billing.customer ? '<button class="btn secondary sm" id="portal">Κάρτα, τιμολόγια, ακύρωση</button>' : ''}
        ${paidNow ? '<button class="btn secondary sm" id="pause">Πάγωμα για τη χειμερινή περίοδο</button>' : ''}
        ${v.status === 'paused' ? '<button class="btn sm" id="resume">Επανενεργοποίηση</button>' : ''}
      </div>
      ${acc.billing.demo ? '<p class="muted small">Δοκιμαστική λειτουργία: δεν έχουν οριστεί κλειδιά Stripe, οπότε η επιλογή πλάνου ενεργοποιείται χωρίς πληρωμή.</p>' : ''}
    </div>
    <div class="seg" style="margin-top:1rem">
      <button data-int="month" class="${interval === 'month' ? 'active' : ''}">Μηνιαία</button>
      <button data-int="year" class="${interval === 'year' ? 'active' : ''}">Ετήσια (2 μήνες δώρο)</button>
    </div>
    <div class="plan-cards">${PLAN_ORDER.map((k) => {
      const p = acc.plans[k];
      const price = interval === 'year' ? `${euro(p.month * 10)}<small>/έτος</small>` : `${euro(p.month)}<small>/μήνα</small>`;
      const current = paidNow && v.plan === k && v.interval === interval;
      return `<div class="plan-card ${current ? 'current' : ''}">
        <h4>${esc(p.name)}</h4><div class="price">${price}</div><p class="muted small">+ ΦΠΑ 24%</p>
        <ul>${limits(p).map((l) => `<li>${l}</li>`).join('')}</ul>
        ${current ? '<span class="badge">Τρέχον πλάνο</span>'
          : `<button class="btn sm block" data-plan="${k}">${paidNow ? 'Αλλαγή σε αυτό' : v.status === 'trialing' && v.effectivePlan ? 'Επιλογή (χρέωση μετά τη δοκιμή)' : 'Επιλογή και πληρωμή'}</button>`}
      </div>`;
    }).join('')}</div>
    <p class="muted small">Η πληρωμή γίνεται με κάρτα μέσω Stripe. Μπορείτε να ακυρώσετε ή να παγώσετε όποτε θέλετε.</p>
    <div class="panel" style="margin-top:1rem">
      <h3>Τα δεδομένα σας</h3>
      <p class="muted small" style="margin-top:0">Κατεβάστε όλα τα δεδομένα του καταστήματος (μενού, θέσεις, παραγγελίες, αποδείξεις) σε αρχείο JSON,
        ή διαγράψτε οριστικά τον λογαριασμό. <a href="/terms" target="_blank">Όροι</a> · <a href="/privacy" target="_blank">Απόρρητο</a> ·
        <a href="/dpa" target="_blank">Επεξεργασία δεδομένων</a></p>
      <div class="links">
        <a class="btn secondary sm" href="/api/account/export">Λήψη δεδομένων</a>
        <button class="btn danger sm" id="deleteAccount">Διαγραφή λογαριασμού</button>
      </div>
    </div>`;

    $$('[data-int]').forEach((b) => b.onclick = () => { interval = b.dataset.int; draw(); });
    $$('[data-plan]').forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api('/api/account/checkout', { method: 'POST', body: { plan: b.dataset.plan, interval } });
        if (r.url) { location.href = r.url; return; }
        toast(r.updated ? 'Το πλάνο άλλαξε' : 'Το πλάνο ενεργοποιήθηκε', 'ok');
        render();
      } catch (e) { toast(e.message, 'err'); b.disabled = false; }
    });
    $('#portal')?.addEventListener('click', async () => {
      try { location.href = (await api('/api/account/portal', { method: 'POST' })).url; } catch (e) { toast(e.message, 'err'); }
    });
    const pause = (paused) => async () => {
      if (paused && !confirm('Κατά το πάγωμα δεν χρεώνεστε και οι πελάτες δεν βλέπουν το μενού. Μενού, QR και ιστορικό μένουν αποθηκευμένα για την επόμενη σεζόν. Συνέχεια;')) return;
      try { await api('/api/account/pause', { method: 'POST', body: { paused } }); toast(paused ? 'Η συνδρομή πάγωσε' : 'Η συνδρομή ενεργοποιήθηκε', 'ok'); render(); }
      catch (e) { toast(e.message, 'err'); }
    };
    $('#deleteAccount').onclick = async () => {
      if (!confirm('Θα διαγραφούν οριστικά το μενού, οι θέσεις, οι παραγγελίες και οι αποδείξεις, και θα ακυρωθεί η συνδρομή. Τα QR θα σταματήσουν να λειτουργούν. Συνέχεια;')) return;
      const password = prompt('Για επιβεβαίωση γράψτε τον κωδικό σας:');
      if (!password) return;
      try {
        await api('/api/account', { method: 'DELETE', body: { password } });
        alert('Ο λογαριασμός διαγράφηκε.');
        location.href = '/';
      } catch (e) { toast(e.message, 'err'); }
    };
    $('#pause')?.addEventListener('click', pause(true));
    $('#resume')?.addEventListener('click', pause(false));
  };
  draw();
}

// ---------------------------------------------------------------------------
// Order history (stored in the database) + CSV export
// ---------------------------------------------------------------------------
const STATUS_LABEL = { pending: 'Αναμονή έγκρισης', accepted: 'Εγκρίθηκε', preparing: 'Ετοιμάζεται', ready: 'Έτοιμη',
  served: 'Σερβιρίστηκε', rejected: 'Απορρίφθηκε' };
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hist = { from: isoDay(new Date(Date.now() - 6 * 86400_000)), to: isoDay(new Date()), status: '' };

async function renderHistory() {
  const qs = new URLSearchParams({ from: hist.from, to: hist.to, ...(hist.status ? { status: hist.status } : {}) });
  const { orders, summary } = await api(`/api/admin/orders?${qs}`);
  const when = (iso) => new Date(iso).toLocaleString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('#app').innerHTML = `
    <div class="filters">
      <label>Από<input class="input" type="date" id="hFrom" value="${hist.from}"></label>
      <label>Έως<input class="input" type="date" id="hTo" value="${hist.to}"></label>
      <label>Κατάσταση<select class="input" id="hStatus">
        <option value="">Όλες</option>
        ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${hist.status === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select></label>
      <a class="btn secondary sm" id="csv" href="/api/admin/orders.csv?${qs}">Εξαγωγή σε Excel (CSV)</a>
    </div>
    <div class="stats">
      <div class="stat"><div class="l">Παραγγελίες</div><div class="v">${summary.count}</div></div>
      <div class="stat"><div class="l">Σύνολο</div><div class="v">${euro(summary.revenue)}</div></div>
      <div class="stat"><div class="l">Μέση παραγγελία</div><div class="v">${euro(summary.count ? Math.round(summary.revenue / summary.count) : 0)}</div></div>
      <div class="stat"><div class="l">Απορρίφθηκαν</div><div class="v">${summary.rejected}</div></div>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>#</th><th>Ημερομηνία</th><th>Θέση</th><th>Πιάτα</th><th>Γλώσσα</th><th>Κατάσταση</th><th class="num">Σύνολο</th></tr></thead>
        <tbody>
          ${orders.length ? orders.map((o) => `<tr>
            <td>${o.id}</td>
            <td style="white-space:nowrap">${when(o.createdAt)}</td>
            <td style="white-space:nowrap">${esc((KIND[o.tableKind] || KIND.table).one)} ${esc(o.tableLabel)}</td>
            <td class="items">${o.items.map((i) => `${i.qty}× ${esc(itemName(i.name))}${optionNames(i) ? ` (${esc(optionNames(i))})` : ''}`).join(', ')}${o.note ? `<br><i>${esc(o.note)}</i>` : ''}</td>
            <td>${esc(o.lang.toUpperCase())}</td>
            <td><span class="badge ${o.status === 'rejected' ? 'red' : o.status === 'served' ? 'green' : 'gray'}">${STATUS_LABEL[o.status]}</span>${o.paid ? ' <span class="badge green">Εξοφλήθηκε</span>' : ''}</td>
            <td class="num">${euro(o.total)}</td>
          </tr>`).join('') : '<tr><td colspan="7" class="muted" style="text-align:center;padding:2rem">Δεν υπάρχουν παραγγελίες σε αυτό το διάστημα.</td></tr>'}
        </tbody>
      </table>
    </div>
    <p class="muted small">Όλες οι παραγγελίες αποθηκεύονται μόνιμα στη βάση δεδομένων. Εμφανίζονται έως 2.000 ανά αναζήτηση.</p>`;
  const apply = () => { hist.from = $('#hFrom').value; hist.to = $('#hTo').value; hist.status = $('#hStatus').value; renderHistory(); };
  ['#hFrom', '#hTo', '#hStatus'].forEach((sel) => $(sel).addEventListener('change', apply));
}

// ---------------------------------------------------------------------------
// Receipts (stored bills) – reprint, guest copy, link to the legal receipt number
// ---------------------------------------------------------------------------
const PAY_LABEL = { cash: 'Μετρητά', card: 'Κάρτα', online: 'Online' };
const rec = { from: isoDay(new Date(Date.now() - 6 * 86400_000)), to: isoDay(new Date()) };

async function renderReceipts() {
  const qs = new URLSearchParams(rec);
  const { receipts, summary } = await api(`/api/admin/receipts?${qs}`);
  const when = (iso) => new Date(iso).toLocaleString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('#app').innerHTML = `
    <div class="filters">
      <label>Από<input class="input" type="date" id="rFrom" value="${rec.from}"></label>
      <label>Έως<input class="input" type="date" id="rTo" value="${rec.to}"></label>
      <a class="btn secondary sm" href="/api/admin/receipts.csv?${qs}">Εξαγωγή σε Excel (CSV)</a>
    </div>
    <div class="stats">
      <div class="stat"><div class="l">Αποδείξεις</div><div class="v">${summary.count}</div></div>
      <div class="stat"><div class="l">Σύνολο</div><div class="v">${euro(summary.total)}</div></div>
      <div class="stat"><div class="l">Μετρητά</div><div class="v">${euro(summary.byPayment.cash)}</div></div>
      <div class="stat"><div class="l">Κάρτα / Online</div><div class="v">${euro(summary.byPayment.card + summary.byPayment.online)}</div></div>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Αριθμός</th><th>Ημερομηνία</th><th>Θέση</th><th>Πληρωμή</th><th>Αρ. απόδειξης ταμειακής / ΜΑΡΚ</th><th class="num">Σύνολο</th><th></th></tr></thead>
        <tbody>
          ${receipts.length ? receipts.map((r) => `<tr>
            <td><b>${esc(r.number)}</b></td>
            <td style="white-space:nowrap">${when(r.createdAt)}</td>
            <td style="white-space:nowrap">${esc((KIND[r.tableKind] || KIND.table).one)} ${esc(r.tableLabel)}</td>
            <td>${PAY_LABEL[r.payment] || esc(r.payment)}</td>
            <td><input class="input fiscal" data-rid="${r.id}" value="${esc(r.fiscalRef)}" placeholder="—" maxlength="80"></td>
            <td class="num">${euro(r.total)}</td>
            <td style="white-space:nowrap"><a class="btn secondary sm" href="/staff/print/receipt/${r.id}" target="_blank">Εκτύπωση</a>
              <a class="btn ghost sm" href="/r/${esc(r.token)}" target="_blank">Αντίγραφο πελάτη</a></td>
          </tr>`).join('') : '<tr><td colspan="7" class="muted" style="text-align:center;padding:2rem">Δεν υπάρχουν αποδείξεις σε αυτό το διάστημα.</td></tr>'}
        </tbody>
      </table>
    </div>
    <p class="muted small">Οι αποδείξεις δημιουργούνται όταν ο σερβιτόρος κάνει «Εξόφληση και κλείσιμο» και αποθηκεύονται μόνιμα.
      Δεν αποτελούν φορολογικά στοιχεία· συμπληρώστε τον αριθμό ή το ΜΑΡΚ της νόμιμης απόδειξης από το ταμείο σας για αντιστοίχιση.</p>`;
  const apply = () => { rec.from = $('#rFrom').value; rec.to = $('#rTo').value; renderReceipts(); };
  ['#rFrom', '#rTo'].forEach((sel) => $(sel).addEventListener('change', apply));
  $$('.fiscal').forEach((inp) => inp.addEventListener('change', async () => {
    try { await api(`/api/staff/receipts/${inp.dataset.rid}`, { method: 'PUT', body: { fiscalRef: inp.value } }); toast('Αποθηκεύτηκε', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  }));
}

// ---------------------------------------------------------------------------
// Menu editor
// ---------------------------------------------------------------------------
let menu = null;
async function renderMenu() {
  menu = await api('/api/admin/menu');
  const { categories, items } = menu;
  const noPhoto = items.filter((i) => !i.image_url).length;
  $('#app').innerHTML = `
    <div class="panel offers">
      <div><b>Πιάτο ημέρας / ανακοίνωση</b><span class="muted small">${settings.announcement?.active ? esc(settings.announcement.text?.el || 'Ενεργό') : 'Ανενεργό'}</span></div>
      <div><b>Happy hour</b><span class="muted small">${settings.happyHour?.enabled ? esc(describeWindow(settings.happyHour)) : 'Ανενεργό'}</span></div>
      <button class="btn secondary sm" id="offers">Ρύθμιση προσφορών</button>
    </div>
    <div class="toolbar">
      <button class="btn" id="addCat">Νέα κατηγορία</button>
      ${noPhoto ? `<span class="muted small">${noPhoto} από ${items.length} πιάτα δεν έχουν φωτογραφία. Οι φωτογραφίες αυξάνουν σημαντικά τις παραγγελίες.</span>` : ''}
    </div>
    ${categories.map((c, ci) => {
      const list = items.filter((i) => i.category_id === c.id);
      return `<div class="cat-block">
        <div class="cat-head">
          <h3>${esc(itemName(c.name))} ${c.active ? '' : '<span class="badge gray">Κρυφή</span>'}<span class="muted small"> · ${list.length} πιάτα
            · ${esc(menu.stations.find((st) => st.id === c.station)?.name || 'Κουζίνα')}${c.schedule ? ` · ${esc(describeWindow(c.schedule))}` : ''}${c.zones?.length ? ` · ${esc(c.zones.join(', '))}` : ''}</span></h3>
          <button class="mini" data-cmove="${ci}" data-dir="-1" title="Πάνω">${icon('up', 15)}</button>
          <button class="mini" data-cmove="${ci}" data-dir="1" title="Κάτω">${icon('down', 15)}</button>
          <button class="mini" data-cedit="${c.id}" title="Επεξεργασία">${icon('edit', 15)}</button>
          <button class="btn sm" data-iadd="${c.id}">Πιάτο</button>
        </div>
        ${list.map((i, ii) => `<div class="list-item ${i.available ? '' : 'off'}">
          <div class="thumb-sm">${i.image_url ? `<img src="${esc(i.image_url)}" alt="">` : icon('image', 18)}</div>
          <div class="grow"><b>${esc(itemName(i.name))}</b>
            <span class="muted small">${esc(i.description?.el || i.description?.en || '')}</span>
            <div class="langs-mini">${settings.languages.map((l) => `<span class="${i.name[l] ? 'ok' : ''}" title="${LANGUAGES[l].name}">${LANGUAGES[l].short}</span>`).join('')}</div>
          </div>
          <b class="price">${euro(i.price_cents)}${i.happy_price_cents != null ? `<small class="muted"> HH ${euro(i.happy_price_cents)}</small>` : ''}
            ${i.stock != null ? `<small class="badge ${i.stock ? 'gray' : 'red'}">${i.stock} μερ.</small>` : ''}</b>
          <label class="toggle" title="Διαθέσιμο"><input type="checkbox" data-avail="${i.id}" ${i.available ? 'checked' : ''}><span></span></label>
          <button class="mini" data-imove="${c.id}:${ii}" data-dir="-1">${icon('up', 15)}</button>
          <button class="mini" data-imove="${c.id}:${ii}" data-dir="1">${icon('down', 15)}</button>
          <button class="mini" data-iedit="${i.id}">${icon('edit', 15)}</button>
        </div>`).join('') || '<div class="list-item muted">Δεν υπάρχουν πιάτα σε αυτή την κατηγορία.</div>'}
      </div>`;
    }).join('')}`;

  $('#addCat').onclick = () => editCategory();
  $('#offers').onclick = editOffers;
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

function editOffers() {
  const a = settings.announcement || {};
  const h = settings.happyHour || {};
  const { el, close } = sheet(`
    <div class="sheet-head"><h2>Προσφορές</h2><button class="icon-btn" data-close>${icon('x')}</button></div>
    <h3>Πιάτο ημέρας / ανακοίνωση</h3>
    <p class="muted small" style="margin-top:0">Εμφανίζεται στην κορυφή του μενού. Αν διαλέξετε πιάτο, ο πελάτης το ανοίγει με ένα πάτημα.</p>
    <label class="switch"><input type="checkbox" id="aOn" ${a.active ? 'checked' : ''}> Ενεργό</label>
    ${i18nEditor([{ key: 'text', label: 'Κείμενο', max: 200 }], { text: a.text || {} })}
    <label class="field"><span>Πιάτο (προαιρετικό)</span><select class="input" id="aItem"><option value="">—</option>
      ${menu.items.map((i) => `<option value="${i.id}" ${a.itemId === i.id ? 'selected' : ''}>${esc(itemName(i.name))}</option>`).join('')}</select></label>
    <h3>Happy hour</h3>
    <p class="muted small" style="margin-top:0">Στις ώρες αυτές ισχύει η «Τιμή happy hour» των πιάτων που την έχουν, με διαγραμμένη την κανονική τιμή.</p>
    <label class="switch"><input type="checkbox" id="hOn" ${h.enabled ? 'checked' : ''}> Ενεργό</label>
    ${windowEditor('hh', h)}
    <button class="btn block" id="save">Αποθήκευση</button>`);
  const readA = bindI18n(el);
  $('#save', el).onclick = async () => {
    try {
      await api('/api/admin/settings', { method: 'PUT', body: {
        announcement: { active: $('#aOn', el).checked, text: readA().text || {}, itemId: Number($('#aItem', el).value) || null },
        happyHour: { enabled: $('#hOn', el).checked, ...readWindow($('#hh', el)) },
      } });
      close(); toast('Αποθηκεύτηκε', 'ok'); render();
    } catch (e) { toast(e.message, 'err'); }
  };
}

function editCategory(c) {
  const { el, close } = sheet(`
    <div class="sheet-head"><h2>${c ? 'Επεξεργασία κατηγορίας' : 'Νέα κατηγορία'}</h2><button class="icon-btn" data-close>${icon('x')}</button></div>
    ${i18nEditor([{ key: 'name', label: 'Όνομα', max: 80 }], { name: c?.name })}
    <label class="switch"><input type="checkbox" id="active" ${c?.active === false ? '' : 'checked'}> Εμφανίζεται στο μενού</label>
    <label class="field"><span>Πόστο που ετοιμάζει αυτά τα πιάτα</span><select class="input" id="station">
      ${menu.stations.map((st) => `<option value="${esc(st.id)}" ${(c?.station || 'kitchen') === st.id ? 'selected' : ''}>${esc(st.name)}</option>`).join('')}
    </select></label>
    <div class="field"><span class="lbl">Ώρες που εμφανίζεται</span>
      <p class="muted small" style="margin:0 0 .4rem">Π.χ. «Πρωινό» 07:00–11:00, «Room service» 12:00–23:00. Κενό = πάντα.</p>
      ${windowEditor('sched', c?.schedule)}</div>
    ${menu.zones.length ? `<div class="field"><span class="lbl">Εμφανίζεται μόνο στις ζώνες</span>
      <div class="checks">${menu.zones.map((z) => `<label><input type="checkbox" data-zone="${esc(z)}" ${(c?.zones || []).includes(z) ? 'checked' : ''}>${esc(z)}</label>`).join('')}</div>
      <p class="muted small">Καμία επιλογή = σε όλες. Π.χ. το μενού «Pool bar» μόνο στη ζώνη «Πισίνα».</p></div>` : ''}
    <div class="row">
      ${c ? `<button class="btn danger" id="del">Διαγραφή</button>` : ''}
      <button class="btn" id="save">Αποθήκευση</button>
    </div>`);
  const read = bindI18n(el);
  $('#save', el).onclick = async () => {
    const body = { ...read(), icon: c?.icon || '', active: $('#active', el).checked, station: $('#station', el).value,
      schedule: readWindow($('#sched', el)), zones: $$('[data-zone]', el).filter((x) => x.checked).map((x) => x.dataset.zone) };
    try {
      await api(c ? `/api/admin/categories/${c.id}` : '/api/admin/categories', { method: c ? 'PUT' : 'POST', body });
      close(); toast('Αποθηκεύτηκε', 'ok'); renderMenu();
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#del', el)?.addEventListener('click', async () => {
    if (!confirm('Διαγραφή κατηγορίας και όλων των πιάτων της;')) return;
    await api(`/api/admin/categories/${c.id}`, { method: 'DELETE' });
    close(); toast('Διαγράφηκε', 'ok'); renderMenu();
  });
}

function editItem(item, categoryId) {
  const i = item || { category_id: categoryId, name: {}, description: {}, allergens: [], tags: [], emoji: '', image_url: '', price_cents: 0, available: true };
  const { el, close } = sheet(`
    <div class="sheet-head"><h2>${item ? 'Επεξεργασία πιάτου' : 'Νέο πιάτο'}</h2><button class="icon-btn" data-close>${icon('x')}</button></div>
    <div id="photo"></div>
    ${i18nEditor([{ key: 'name', label: 'Όνομα', max: 100 }, { key: 'description', label: 'Περιγραφή', textarea: true, max: 400 }], i)}
    <div class="two">
      <label class="field"><span>Τιμή (€)</span><input class="input" id="price" type="number" step="0.10" min="0" value="${(i.price_cents / 100).toFixed(2)}"></label>
      <label class="field"><span>Κατηγορία</span><select class="input" id="cat">
        ${menu.categories.map((c) => `<option value="${c.id}" ${c.id === i.category_id ? 'selected' : ''}>${esc(itemName(c.name))}</option>`).join('')}
      </select></label>
    </div>
    <div class="two">
      <label class="field"><span>Τιμή happy hour (€)</span><input class="input" id="happy" type="number" step="0.10" min="0" placeholder="—"
        value="${i.happy_price_cents != null ? (i.happy_price_cents / 100).toFixed(2) : ''}"></label>
      <label class="field"><span>Απόθεμα (μερίδες)</span><input class="input" id="stock" type="number" min="0" step="1" placeholder="Χωρίς όριο"
        value="${i.stock != null ? i.stock : ''}"></label>
      <label class="field"><span>Χρόνος προετοιμασίας (λεπτά)</span><input class="input" id="prep" type="number" min="0" max="240" value="${i.prep_minutes || ''}" placeholder="π.χ. 15"></label>
      <label class="switch" style="align-self:end"><input type="checkbox" id="premium" ${i.premium ? 'checked' : ''}> Χρεώνεται και στο all-inclusive</label>
    </div>
    <p class="muted small" style="margin-top:-.3rem">Το απόθεμα μειώνεται με κάθε παραγγελία· στο 0 το πιάτο γίνεται αυτόματα «εξαντλημένο».</p>
    <div class="field"><span class="lbl">Επιλογές και έξτρα</span>
      <p class="muted small" style="margin:0 0 .5rem">Π.χ. «Ψήσιμο: Μέτριο / Καλοψημένο» (υποχρεωτική, μία επιλογή) ή «Έξτρα: Φέτα +1,50 €» (προαιρετική, πολλές).
        Συμπληρώστε ελληνικά και αγγλικά· οι υπόλοιπες γλώσσες δείχνουν τα αγγλικά.</p>
      <div id="optGroups"></div>
      <button type="button" class="btn secondary sm" id="addGroup">Προσθήκη ομάδας επιλογών</button>
    </div>
    <label class="field"><span>Χαρακτηρισμοί</span><div class="checks">
      ${menu.tags.map((tg) => `<label><input type="checkbox" data-tag="${tg}" ${i.tags.includes(tg) ? 'checked' : ''}>${TAG_LABELS[tg] || tg}</label>`).join('')}
    </div></label>
    <label class="field"><span>Αλλεργιογόνα · υποχρεωτική ενημέρωση (Κανονισμός ΕΕ 1169/2011)</span><div class="checks">
      ${menu.allergens.map((a) => `<label><input type="checkbox" data-al="${a}" ${i.allergens.includes(a) ? 'checked' : ''}>${esc(STRINGS.el[`allergen_${a}`])}</label>`).join('')}
    </div></label>
    <label class="switch"><input type="checkbox" id="avail" ${i.available ? 'checked' : ''}> Διαθέσιμο τώρα</label>
    <div class="row">
      ${item ? `<button class="btn danger" id="del">Διαγραφή</button>` : ''}
      <button class="btn" id="save">Αποθήκευση</button>
    </div>`);
  const read = bindI18n(el);
  const photo = photoField(el, '#photo', i.image_url, { wide: true });
  const readOptions = optionsEditor($('#optGroups', el), $('#addGroup', el), i.options || []);
  $('#save', el).onclick = async () => {
    const body = {
      ...read(),
      options: readOptions(),
      price: $('#price', el).value,
      categoryId: Number($('#cat', el).value),
      emoji: i.emoji || '',
      imageUrl: photo(),
      tags: $$('[data-tag]', el).filter((c) => c.checked).map((c) => c.dataset.tag),
      allergens: $$('[data-al]', el).filter((c) => c.checked).map((c) => c.dataset.al),
      available: $('#avail', el).checked,
      happyPrice: $('#happy', el).value, stock: $('#stock', el).value, prepMinutes: $('#prep', el).value, premium: $('#premium', el).checked,
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

// Editor for option groups. Greek + English are edited here; other translations are kept as they were.
function optionsEditor(box, addBtn, initial) {
  const groups = initial.map((g) => ({ ...g, choices: g.choices.map((c) => ({ ...c })) }));
  const nameInputs = (obj, cls) => `
    <input class="input ${cls}" data-l="el" placeholder="Ελληνικά" value="${esc(obj?.el || '')}">
    <input class="input ${cls}" data-l="en" placeholder="English" value="${esc(obj?.en || '')}">`;
  const collect = () => {
    $$('.og', box).forEach((gEl, gi) => {
      const g = groups[gi];
      g.name = { ...g.name, el: $('.gname[data-l="el"]', gEl).value.trim(), en: $('.gname[data-l="en"]', gEl).value.trim() };
      g.required = $('.greq', gEl).checked;
      g.multi = $('.gmulti', gEl).checked;
      $$('.oc', gEl).forEach((cEl, ci) => {
        const c = g.choices[ci];
        c.name = { ...c.name, el: $('.cname[data-l="el"]', cEl).value.trim(), en: $('.cname[data-l="en"]', cEl).value.trim() };
        c.price_cents = Math.round(Number($('.cprice', cEl).value || 0) * 100);
      });
    });
  };
  const draw = () => {
    box.innerHTML = groups.map((g, gi) => `
      <div class="og" data-g="${gi}">
        <div class="og-head">${nameInputs(g.name, 'gname')}
          <button type="button" class="mini" data-rmg="${gi}" title="Διαγραφή ομάδας">${icon('trash', 15)}</button></div>
        <div class="og-flags">
          <label><input type="checkbox" class="greq" ${g.required ? 'checked' : ''}> Υποχρεωτική</label>
          <label><input type="checkbox" class="gmulti" ${g.multi ? 'checked' : ''}> Πολλές επιλογές</label>
        </div>
        ${g.choices.map((c, ci) => `<div class="oc">${nameInputs(c.name, 'cname')}
          <input class="input cprice" type="number" step="0.10" min="0" placeholder="+€" value="${c.price_cents ? (c.price_cents / 100).toFixed(2) : ''}">
          <button type="button" class="mini" data-rmc="${gi}:${ci}" title="Διαγραφή">${icon('x', 14)}</button></div>`).join('')}
        <button type="button" class="btn ghost sm" data-addc="${gi}">+ Επιλογή</button>
      </div>`).join('');
    $$('[data-rmg]', box).forEach((b) => b.onclick = () => { collect(); groups.splice(Number(b.dataset.rmg), 1); draw(); });
    $$('[data-rmc]', box).forEach((b) => b.onclick = () => {
      collect(); const [gi, ci] = b.dataset.rmc.split(':').map(Number); groups[gi].choices.splice(ci, 1); draw();
    });
    $$('[data-addc]', box).forEach((b) => b.onclick = () => {
      collect(); groups[Number(b.dataset.addc)].choices.push({ name: {}, price_cents: 0 }); draw();
    });
  };
  addBtn.onclick = () => { collect(); groups.push({ name: {}, required: false, multi: false, choices: [{ name: {}, price_cents: 0 }, { name: {}, price_cents: 0 }] }); draw(); };
  draw();
  return () => {
    collect();
    return groups.map((g) => ({ ...g, choices: g.choices.map((c) => ({ name: c.name, price: c.price_cents / 100 })) }));
  };
}

// ---------------------------------------------------------------------------
// Spots (tables / rooms / sunbeds) & QR
// ---------------------------------------------------------------------------
const kindOptions = (sel) => Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v.one}</option>`).join('');

async function renderTables() {
  const tables = await api('/api/admin/tables');
  $('#app').innerHTML = `
    <div class="panel">
      <h3>Νέες θέσεις</h3>
      <p class="muted small" style="margin-top:0">Κάθε θέση έχει δικό της QR. Χρησιμοποιήστε «Δωμάτιο» για room service ξενοδοχείου και «Ξαπλώστρα» για πισίνα ή παραλία.</p>
      <div class="toolbar">
        <select class="input" id="newKind" style="max-width:170px">${kindOptions('table')}</select>
        <input class="input" id="newLabel" placeholder="Όνομα ή αριθμός (π.χ. 13, 204, Βεράντα 2)" style="flex:2;min-width:200px">
        <button class="btn" id="addOne">Προσθήκη</button>
        <button class="btn secondary" id="addMany">Πολλές μαζί</button>
        <a class="btn success" href="/staff/qr" target="_blank">Εκτύπωση όλων των QR</a>
      </div>
      ${location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? `<div class="note-box">
        Η διαχείριση είναι ανοιχτή από <b>localhost</b>, οπότε τα QR δείχνουν σε localhost και δεν ανοίγουν από κινητό.
        Ορίστε «Δημόσια διεύθυνση» στις Ρυθμίσεις ή ανοίξτε τη σελίδα με τη διεύθυνση IP του υπολογιστή.</div>` : ''}
    </div>
    <div class="toolbar bulk">
      <label class="check-all"><input type="checkbox" id="all"> Επιλογή όλων</label>
      <span class="muted small" id="selCount"></span>
      <button class="btn secondary sm" id="bulkZone">Ζώνη…</button>
      <button class="btn secondary sm" id="bulkAi">All-inclusive…</button>
    </div>
    <div class="cat-block">
      ${tables.map((t) => `<div class="list-item ${t.active ? '' : 'off'}">
        <input type="checkbox" class="sel" value="${t.id}">
        <img class="qr-img" src="/api/admin/tables/${t.id}/qr.svg?v=${esc(t.token)}" alt="QR">
        <div class="grow"><b>${esc((KIND[t.kind] || KIND.table).one)} ${esc(t.label)}</b>
          ${t.zone ? `<span class="badge gray">${esc(t.zone)}</span>` : ''}${t.all_inclusive ? '<span class="badge amber">All-inclusive</span>' : ''}
          <a class="small" href="${esc(t.url)}" target="_blank" style="word-break:break-all">${esc(t.url)}</a></div>
        <label class="toggle" title="Ενεργή"><input type="checkbox" data-active="${t.id}" ${t.active ? 'checked' : ''}><span></span></label>
        <a class="btn secondary sm" href="/staff/qr?ids=${t.id}" target="_blank" title="Εκτύπωση μόνο αυτού του QR">Εκτύπωση</a>
        <a class="btn secondary sm" href="/api/admin/tables/${t.id}/qr.png?ecl=H" download title="Λήψη εικόνας PNG για τυπογραφείο">PNG</a>
        <button class="mini" data-rename="${t.id}" title="Επεξεργασία">${icon('edit', 15)}</button>
        <button class="mini" data-regen="${t.id}" title="Νέο QR (το παλιό σταματά να λειτουργεί)">${icon('refresh', 15)}</button>
        <button class="mini" data-del="${t.id}" title="Διαγραφή">${icon('trash', 15)}</button>
      </div>`).join('') || '<div class="list-item muted">Δεν υπάρχουν θέσεις.</div>'}
    </div>`;
  const byId = (id) => tables.find((t) => t.id === Number(id));
  const reload = () => renderTables();
  $('#addOne').onclick = async () => {
    const label = $('#newLabel').value.trim();
    if (!label) return toast('Γράψτε όνομα ή αριθμό', 'err');
    await api('/api/admin/tables', { method: 'POST', body: { label, kind: $('#newKind').value } }); reload();
  };
  $('#addMany').onclick = async () => {
    const n = Number(prompt('Πόσες θέσεις να προστεθούν; Αριθμούνται αυτόματα.', '5'));
    if (n > 0) { await api('/api/admin/tables', { method: 'POST', body: { count: n, kind: $('#newKind').value } }); reload(); }
  };
  $$('[data-active]').forEach((c) => c.onchange = async () => {
    const t = byId(c.dataset.active);
    await api(`/api/admin/tables/${t.id}`, { method: 'PUT', body: { label: t.label, kind: t.kind, active: c.checked, zone: t.zone, allInclusive: t.all_inclusive } }); reload();
  });
  $$('[data-rename]').forEach((b) => b.onclick = () => {
    const t = byId(b.dataset.rename);
    const { el, close } = sheet(`
      <div class="sheet-head"><h2>Επεξεργασία θέσης</h2><button class="icon-btn" data-close>${icon('x')}</button></div>
      <div class="two">
        <label class="field"><span>Τύπος</span><select class="input" id="k">${kindOptions(t.kind)}</select></label>
        <label class="field"><span>Όνομα ή αριθμός</span><input class="input" id="l" maxlength="20" value="${esc(t.label)}"></label>
        <label class="field"><span>Ζώνη (π.χ. Βεράντα, Πισίνα, Παραλία)</span><input class="input" id="z" maxlength="30" list="zonesList" value="${esc(t.zone)}"></label>
        <label class="switch" style="align-self:end"><input type="checkbox" id="ai" ${t.all_inclusive ? 'checked' : ''}> All-inclusive</label>
      </div>
      <datalist id="zonesList">${[...new Set(tables.map((x) => x.zone).filter(Boolean))].map((z) => `<option value="${esc(z)}">`).join('')}</datalist>
      <button class="btn block" id="s">Αποθήκευση</button>`);
    $('#s', el).onclick = async () => {
      try {
        await api(`/api/admin/tables/${t.id}`, { method: 'PUT', body: { label: $('#l', el).value, kind: $('#k', el).value, active: t.active,
          zone: $('#z', el).value, allInclusive: $('#ai', el).checked } });
        close(); reload();
      } catch (e) { toast(e.message, 'err'); }
    };
  });
  const selected = () => $$('.sel').filter((c) => c.checked).map((c) => Number(c.value));
  const count = () => { const n = selected().length; $('#selCount').textContent = n ? `${n} επιλεγμένες` : ''; };
  $$('.sel').forEach((c) => c.onchange = count);
  $('#all').onchange = (e) => { $$('.sel').forEach((c) => { c.checked = e.target.checked; }); count(); };
  const bulk = async (body) => {
    const ids = selected();
    if (!ids.length) return toast('Επιλέξτε θέσεις', 'err');
    await api('/api/admin/tables/bulk', { method: 'POST', body: { ids, ...body } }); reload();
  };
  $('#bulkZone').onclick = () => { const z = prompt('Ζώνη για τις επιλεγμένες θέσεις (κενό = καμία):', ''); if (z !== null) bulk({ zone: z }); };
  $('#bulkAi').onclick = () => { const yes = confirm('All-inclusive για τις επιλεγμένες θέσεις; (Άκυρο = απενεργοποίηση)'); bulk({ allInclusive: yes }); };
  $$('[data-regen]').forEach((b) => b.onclick = async () => {
    if (!confirm('Δημιουργία νέου QR; Το παλιό αυτοκόλλητο θα σταματήσει να λειτουργεί.')) return;
    await api(`/api/admin/tables/${b.dataset.regen}/regenerate`, { method: 'POST' }); reload();
  });
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Διαγραφή θέσης και του ιστορικού της;')) return;
    await api(`/api/admin/tables/${b.dataset.del}`, { method: 'DELETE' }); reload();
  });
}

// ---------------------------------------------------------------------------
// Venue
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Look of the guest menu: logo, cover, colours, fonts, with a live preview
// ---------------------------------------------------------------------------
const FONT_LABELS = { modern: 'Σύγχρονη', classic: 'Κλασική (τίτλοι serif)', elegant: 'Κομψή', rounded: 'Στρογγυλή', traditional: 'Παραδοσιακή' };
const CORNER_LABELS = { square: 'Ίσιες', soft: 'Απαλές', round: 'Στρογγυλές' };
const BRAND_SWATCHES = ['#1f3a5f', '#1a1a1a', '#0f5e4a', '#7a2e2e', '#8a5a14', '#2b4c8c', '#5b3a73', '#b0452d'];

function renderLook() {
  const r = settings.restaurant;
  const theme = { background: '#ffffff', text: '', category: '', font: 'modern', corners: 'soft', ...(settings.theme || {}) };
  let brand = settings.brandColor || '#1f3a5f';
  const colorField = (id, label, value, hint) => `<label class="field color-field"><span>${label}</span>
    <div class="color-row"><input type="color" id="${id}" value="${esc(value || '#000000')}">
      ${hint ? `<button type="button" class="btn ghost sm" data-clear="${id}">${hint}</button>` : ''}</div></label>`;
  $('#app').innerHTML = `<div class="look">
    <div class="panel">
      <h3>Έτοιμα θέματα</h3>
      <div class="presets">${THEME_PRESETS.map((p, i) => `<button type="button" class="preset" data-preset="${i}" style="background:${p.background};color:${p.text}">
        <span class="sw" style="background:${p.category || p.text}"></span>${esc(p.name)}</button>`).join('')}</div>

      <h3>Χρώματα</h3>
      <div class="two">
        <label class="field color-field"><span>Κύριο χρώμα (κουμπιά, καλάθι)</span>
          <div class="color-row"><input type="color" id="brand" value="${esc(brand)}">
          <div class="swatches">${BRAND_SWATCHES.map((c) => `<button type="button" data-sw="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div></div></label>
        ${colorField('bg', 'Φόντο', theme.background)}
        ${colorField('text', 'Κείμενο', theme.text || '#1a1a1a', 'Αυτόματο')}
        ${colorField('cat', 'Τίτλοι κατηγοριών', theme.category || theme.text || '#1a1a1a', 'Ίδιο με το κείμενο')}
      </div>

      <h3>Γραμματοσειρά</h3>
      <div class="font-pick">${Object.entries(FONT_LABELS).map(([k, l]) => `<label class="font-opt"><input type="radio" name="font" value="${k}" ${theme.font === k ? 'checked' : ''}>
        <span class="f-${k}">Μουσακάς</span><small>${l}</small></label>`).join('')}</div>

      <h3>Γωνίες</h3>
      <div class="seg">${Object.entries(CORNER_LABELS).map(([k, l]) => `<button type="button" data-corners="${k}" class="${theme.corners === k ? 'active' : ''}">${l}</button>`).join('')}</div>

      <h3>Λογότυπο</h3>
      <p class="muted small" style="margin-top:0">Στην κορυφή του μενού, στις κάρτες QR και στην καρτέλα του browser. Ιδανικά τετράγωνο PNG με διάφανο φόντο.</p>
      <div id="logo"></div>
      <h3>Φωτογραφία εξωφύλλου</h3>
      <p class="muted small" style="margin-top:0">Οριζόντια φωτογραφία του χώρου, της θέας ή ενός πιάτου.</p>
      <div id="cover"></div>
      <div style="margin-top:1.2rem"><button class="btn" id="save">Αποθήκευση εμφάνισης</button></div>
    </div>
    <div class="look-preview"><div class="pv-label">Έτσι το βλέπουν οι πελάτες</div><div class="phone-pv" id="pv"></div></div>
  </div>`;

  const logo = photoField($('#app'), '#logo', r.logoUrl, { contain: true, onChange: () => setTimeout(draw) });
  const cover = photoField($('#app'), '#cover', r.coverUrl, { wide: true, onChange: () => setTimeout(draw) });
  const cleared = { text: !theme.text, cat: !theme.category };

  function current() {
    return {
      background: $('#bg').value, text: cleared.text ? '' : $('#text').value, category: cleared.cat ? '' : $('#cat').value,
      font: $('[name=font]:checked')?.value || 'modern', corners: $('.seg [data-corners].active')?.dataset.corners || 'soft',
    };
  }
  function draw() {
    const pv = $('#pv');
    if (!pv) return;
    const t = current();
    const logoUrl = logo?.() ?? r.logoUrl;
    const coverUrl = cover?.() ?? r.coverUrl;
    pv.innerHTML = `
      ${coverUrl ? `<div class="pv-cover"><img src="${esc(coverUrl)}" alt=""></div>` : ''}
      <div class="pv-head">${logoUrl ? `<img class="pv-logo" src="${esc(logoUrl)}" alt="">` : ''}
        <div><h1>${esc(r.name)}</h1><p>Τραπέζι 4 · ${esc(r.hours?.el || 'Κάθε μέρα 12:00 – 00:00')}</p></div></div>
      <div class="pv-service"><span>Σερβιτόρος</span><span>Λογαριασμός</span></div>
      <div class="pv-tabs"><b>Ορεκτικά</b><span>Κυρίως</span><span>Γλυκά</span></div>
      <h2>Ορεκτικά</h2>
      <div class="pv-dish"><div><b>Τζατζίκι</b><p>Στραγγιστό γιαούρτι, αγγούρι, σκόρδο</p><em>4,50 €</em></div><span class="pv-add">+</span></div>
      <div class="pv-dish"><div><b>Φάβα Σαντορίνης</b><p>Με κάπαρη και κρεμμύδι</p><em>5,50 €</em></div><span class="pv-add">+</span></div>
      <div class="pv-cart"><span>2</span>Καλάθι<span>10,00 €</span></div>`;
    applyTheme(t, pv);
    const n = parseInt(brand.slice(1), 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    pv.style.setProperty('--brand', brand);
    pv.style.setProperty('--brand-ink', lum > 0.6 ? '#1a1a1a' : '#ffffff');
  }

  $$('[data-preset]').forEach((b) => b.onclick = () => {
    const p = THEME_PRESETS[Number(b.dataset.preset)];
    brand = p.brand; $('#brand').value = brand;
    $('#bg').value = p.background;
    $('#text').value = p.text; cleared.text = false;
    $('#cat').value = p.category || p.text; cleared.cat = !p.category;
    $(`[name=font][value=${p.font}]`).checked = true;
    $$('[data-corners]').forEach((x) => x.classList.toggle('active', x.dataset.corners === p.corners));
    draw();
  });
  $$('[data-sw]').forEach((b) => b.onclick = () => { brand = b.dataset.sw; $('#brand').value = brand; draw(); });
  $('#brand').oninput = (e) => { brand = e.target.value; draw(); };
  $('#text').oninput = () => { cleared.text = false; draw(); };
  $('#cat').oninput = () => { cleared.cat = false; draw(); };
  $('#bg').oninput = draw;
  $$('[data-clear]').forEach((b) => b.onclick = () => { cleared[b.dataset.clear] = true; draw(); });
  $$('[name=font]').forEach((x) => x.onchange = draw);
  $$('[data-corners]').forEach((b) => b.onclick = () => {
    $$('[data-corners]').forEach((x) => x.classList.toggle('active', x === b));
    draw();
  });
  draw();

  $('#save').onclick = async () => {
    try {
      await api('/api/admin/settings', { method: 'PUT', body: {
        brandColor: brand, theme: current(), restaurant: { ...settings.restaurant, logoUrl: logo(), coverUrl: cover() },
      } });
      toast('Η εμφάνιση αποθηκεύτηκε. Ανανεώστε το μενού στο κινητό για να τη δείτε.', 'ok');
      settings = await api('/api/admin/settings');
    } catch (err) { toast(err.message, 'err'); }
  };
}

function renderStore() {
  const r = settings.restaurant;
  $('#app').innerHTML = `<div class="panel narrow">
    <p class="muted small" style="margin-top:0">Λογότυπο, εξώφυλλο, χρώματα και γραμματοσειρά: καρτέλα <a href="?tab=look" data-go="look">Εμφάνιση</a>.</p>
    <h3>Στοιχεία</h3>
    <label class="field"><span>Όνομα καταστήματος</span><input class="input" id="name" maxlength="80" value="${esc(r.name)}"></label>
    ${i18nEditor([{ key: 'description', label: 'Σύντομη περιγραφή', textarea: true, max: 400 }, { key: 'hours', label: 'Ωράριο', max: 200 }], r)}
    <div class="two">
      <label class="field"><span>Διεύθυνση</span><input class="input" id="address" value="${esc(r.address)}"></label>
      <label class="field"><span>Σύνδεσμος Google Maps</span><input class="input" id="mapsUrl" value="${esc(r.mapsUrl)}"></label>
      <label class="field"><span>Τηλέφωνο</span><input class="input" id="phone" value="${esc(r.phone)}"></label>
      <label class="field"><span>Email</span><input class="input" id="email" value="${esc(r.email)}"></label>
      <label class="field"><span>Wi-Fi · όνομα δικτύου</span><input class="input" id="wifiName" value="${esc(r.wifiName)}"></label>
      <label class="field"><span>Wi-Fi · κωδικός</span><input class="input" id="wifiPassword" value="${esc(r.wifiPassword)}"></label>
      <label class="field"><span>Instagram (URL)</span><input class="input" id="instagram" value="${esc(r.instagram)}"></label>
      <label class="field"><span>Σύνδεσμος κριτικών (Google / TripAdvisor)</span><input class="input" id="reviewUrl" value="${esc(r.reviewUrl)}"></label>
    </div>
    <h3>Στοιχεία απόδειξης</h3>
    <p class="muted small" style="margin-top:0">Τυπώνονται στην κεφαλίδα της απόδειξης λογαριασμού.</p>
    <div class="two">
      <label class="field"><span>Επωνυμία επιχείρησης</span><input class="input" id="legalName" value="${esc(r.legalName || '')}" placeholder="π.χ. Παπαδόπουλος Γ. & ΣΙΑ Ο.Ε."></label>
      <label class="field"><span>ΑΦΜ</span><input class="input" id="vatNumber" value="${esc(r.vatNumber || '')}" inputmode="numeric"></label>
      <label class="field"><span>ΔΟΥ</span><input class="input" id="taxOffice" value="${esc(r.taxOffice || '')}"></label>
      <label class="field"><span>Κείμενο στο τέλος της απόδειξης</span><input class="input" id="receiptFooter" value="${esc(r.receiptFooter || '')}" placeholder="π.χ. Σας περιμένουμε ξανά!"></label>
    </div>
    <button class="btn" id="save">Αποθήκευση</button>
  </div>`;
  const read = bindI18n($('#app'));
  $('#save').onclick = async () => {
    const fields = ['name', 'address', 'mapsUrl', 'phone', 'email', 'wifiName', 'wifiPassword', 'instagram', 'reviewUrl',
      'legalName', 'vatNumber', 'taxOffice', 'receiptFooter'];
    const restaurant = { ...settings.restaurant, ...Object.fromEntries(fields.map((f) => [f, $(`#${f}`).value])), ...read() };
    try { await api('/api/admin/settings', { method: 'PUT', body: { restaurant } }); toast('Αποθηκεύτηκε', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function renderSettings() {
  const s = settings;
  const dbInfo = s.database === 'postgres'
    ? 'PostgreSQL (ορίζεται με τη μεταβλητή DATABASE_URL).'
    : 'SQLite, στο αρχείο <code>data/taverna.db</code> του server. Για online φιλοξενία ορίστε <code>DATABASE_URL</code> ώστε να χρησιμοποιηθεί PostgreSQL.';
  $('#app').innerHTML = `<div class="panel narrow">
    <h3>Ροή παραγγελιών</h3>
    <label class="switch"><input type="checkbox" id="approval" ${s.requireApproval ? 'checked' : ''}>
      <span><b>Έγκριση από το προσωπικό πριν την κουζίνα</b><br><span class="muted small">Ο σερβιτόρος βλέπει την παραγγελία, την καταχωρεί στο ταμείο/POS και την εγκρίνει.</span></span></label>
    <div class="note-box"><b>Σημαντικό για το myDATA.</b> Στην εστίαση με σερβίρισμα κάθε παραγγελία πρέπει να καταγράφεται ως
      «Δελτίο Παραγγελίας Εστίασης» από πιστοποιημένη ταμειακή ή πάροχο. Με ενεργή την έγκριση, το προσωπικό καταχωρεί την παραγγελία
      στο ταμείο σας. Συμβουλευτείτε τον λογιστή σας πριν την απενεργοποιήσετε.</div>

    <h3>Online πληρωμές πελατών</h3>
    <select class="input" id="payments" style="max-width:380px">
      <option value="off" ${s.onlinePayments === 'off' ? 'selected' : ''}>Απενεργοποιημένες (μετρητά ή κάρτα στη θέση)</option>
      ${s.demoPaymentsAllowed ? `<option value="demo" ${s.onlinePayments === 'demo' ? 'selected' : ''}>Δοκιμαστική λειτουργία (demo)</option>` : ''}
    </select>
    <p class="muted small">Η πληρωμή του λογαριασμού από το κινητό του πελάτη (Viva Wallet) θα προστεθεί σε επόμενη έκδοση.</p>

    <h3>Γλώσσες μενού</h3>
    <div class="checks">${s.allLanguages.map((l) => `<label><input type="checkbox" data-lang-on="${l}" ${s.languages.includes(l) ? 'checked' : ''}>${LANGUAGES[l].name}</label>`).join('')}</div>
    <label class="field" style="margin-top:.8rem;max-width:380px"><span>Προεπιλεγμένη γλώσσα</span><select class="input" id="defLang">
      ${s.allLanguages.map((l) => `<option value="${l}" ${s.defaultLanguage === l ? 'selected' : ''}>${LANGUAGES[l].name}</option>`).join('')}
    </select></label>
    <p class="muted small">Ο πελάτης βλέπει αυτόματα τη γλώσσα του κινητού του, εφόσον είναι διαθέσιμη.</p>

    <h3>Σύνδεση προσωπικού</h3>
    <p class="muted small" style="margin-top:0">Στείλτε αυτόν τον σύνδεσμο στους σερβιτόρους και στην κουζίνα. Ανοίγει από κινητό, tablet ή υπολογιστή· συνδέονται με το PIN τους.</p>
    <div class="copy-row"><input class="input" id="staffUrl" readonly value="${esc(s.staffUrl)}"><button class="btn secondary sm" id="copyStaff" type="button">Αντιγραφή</button></div>
    <p class="muted small">Κωδικός καταστήματος: <b>${esc(s.venue.slug)}</b></p>

    <h3>Προσωπικό με όνομα</h3>
    <p class="muted small" style="margin-top:0">Κάθε άτομο με δικό του PIN. Οι σερβιτόροι με ζώνες βλέπουν πρώτα τα δικά τους τραπέζια
      (π.χ. Γιάννης: Βεράντα, Μαρία: Παραλία). Οι ζώνες ορίζονται στις «Θέσεις & QR».</p>
    <div class="staff-list" id="staffList"></div>
    <button type="button" class="btn secondary sm" id="addMember">Προσθήκη ατόμου</button>

    <h3>Πόστα προετοιμασίας</h3>
    <p class="muted small" style="margin-top:0">Κάθε πόστο έχει δική του οθόνη και εκτυπωτή (Κουζίνα → επιλογή πόστου). Στις κατηγορίες του μενού
      ορίζετε ποιο πόστο τις ετοιμάζει.</p>
    <div id="stationList"></div>
    <button type="button" class="btn secondary sm" id="addStation">Προσθήκη πόστου</button>
    <label class="field" style="max-width:320px;margin-top:.8rem"><span>Προεπιλεγμένος χρόνος προετοιμασίας (λεπτά)</span>
      <input class="input" id="defPrep" type="number" min="1" max="180" value="${esc(s.defaultPrepMinutes)}"></label>

    <h3>PIN ρόλων (κοινά)</h3>
    <div class="two">
      <label class="field"><span>Διαχειριστής (τρέχον: ${esc(s.pins.admin)})</span><input class="input" id="pinAdmin" inputmode="numeric" placeholder="Νέο PIN, 4-8 ψηφία"></label>
      <label class="field"><span>Σερβιτόρος (τρέχον: ${esc(s.pins.waiter)})</span><input class="input" id="pinWaiter" inputmode="numeric" placeholder="Νέο PIN"></label>
      <label class="field"><span>Κουζίνα (τρέχον: ${esc(s.pins.kitchen)})</span><input class="input" id="pinKitchen" inputmode="numeric" placeholder="Νέο PIN"></label>
    </div>

    <details class="advanced"><summary>Για προχωρημένους</summary>
      <label class="field"><span>Διεύθυνση που ανοίγουν τα QR. Αφήστε το κενό, εκτός αν έχετε δικό σας domain.</span>
        <input class="input" id="baseUrl" value="${esc(s.publicBaseUrl)}" placeholder="${esc(location.origin)}"></label>
      <p class="small">Βάση δεδομένων: ${dbInfo}</p>
    </details>

    <div style="margin-top:1.2rem"><button class="btn" id="save">Αποθήκευση ρυθμίσεων</button></div>
  </div>`;
  // Named staff members
  let members = (s.staff || []).map((m) => ({ ...m }));
  const ROLE_EL = { waiter: 'Σερβιτόρος', kitchen: 'Κουζίνα / μπαρ', admin: 'Διαχείριση' };
  const drawMembers = () => {
    $('#staffList').innerHTML = members.map((m, i) => `<div class="member" data-i="${i}">
      <input class="input" data-f="name" placeholder="Όνομα" value="${esc(m.name || '')}">
      <select class="input" data-f="role">${Object.entries(ROLE_EL).map(([k, l]) => `<option value="${k}" ${m.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input class="input" data-f="pin" inputmode="numeric" placeholder="PIN" value="${esc(m.pin || '')}">
      <div class="checks">${s.zones.length ? s.zones.map((z) => `<label><input type="checkbox" data-zone="${esc(z)}" ${(m.zones || []).includes(z) ? 'checked' : ''}>${esc(z)}</label>`).join('') : '<span class="muted small">Χωρίς ζώνες</span>'}</div>
      <button type="button" class="mini" data-rm="${i}" title="Αφαίρεση">${icon('trash', 15)}</button>
    </div>`).join('') || '<p class="muted small">Δεν υπάρχουν άτομα. Μπορείτε να χρησιμοποιείτε μόνο τα κοινά PIN ρόλων.</p>';
    $$('#staffList [data-rm]').forEach((b) => b.onclick = () => { readMembers(); members.splice(Number(b.dataset.rm), 1); drawMembers(); });
  };
  const readMembers = () => {
    members = $$('#staffList .member').map((row, i) => ({
      id: members[i].id, name: $('[data-f=name]', row).value.trim(), role: $('[data-f=role]', row).value, pin: $('[data-f=pin]', row).value.trim(),
      zones: $$('[data-zone]', row).filter((c) => c.checked).map((c) => c.dataset.zone),
    }));
    return members;
  };
  $('#addMember').onclick = () => { readMembers(); members.push({ name: '', role: 'waiter', pin: '', zones: [] }); drawMembers(); };
  drawMembers();
  // Stations
  let stations = (s.stations || []).map((x) => ({ ...x }));
  const drawStations = () => {
    $('#stationList').innerHTML = stations.map((st, i) => `<div class="toolbar" data-st="${i}">
      <input class="input" data-f="name" value="${esc(st.name)}" style="max-width:260px">
      <span class="muted small">κωδικός: ${esc(st.id || '(νέο)')}</span>
      ${st.id === 'kitchen' ? '' : `<button type="button" class="mini" data-rmst="${i}">${icon('trash', 15)}</button>`}</div>`).join('');
    $$('[data-rmst]').forEach((b) => b.onclick = () => { readStations(); stations.splice(Number(b.dataset.rmst), 1); drawStations(); });
  };
  const readStations = () => {
    stations = $$('#stationList [data-st]').map((row, i) => ({ id: stations[i].id, name: $('[data-f=name]', row).value.trim() }));
    return stations;
  };
  $('#addStation').onclick = () => {
    readStations();
    const name = prompt('Όνομα πόστου (π.χ. Pool bar, Ζαχαροπλαστείο):');
    if (!name) return;
    const base = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'station';
    let id = base; for (let n = 2; stations.some((x) => x.id === id); n++) id = `${base}${n}`;
    stations.push({ id: id.slice(0, 20), name }); drawStations();
  };
  drawStations();
  $('#copyStaff').onclick = async () => {
    try { await navigator.clipboard.writeText(s.staffUrl); toast('Ο σύνδεσμος αντιγράφηκε', 'ok'); } catch { $('#staffUrl').select(); }
  };
  $('#save').onclick = async () => {
    const body = {
      requireApproval: $('#approval').checked,
      onlinePayments: $('#payments').value,
      languages: $$('[data-lang-on]').filter((c) => c.checked).map((c) => c.dataset.langOn),
      defaultLanguage: $('#defLang').value,
      pins: { admin: $('#pinAdmin').value.trim(), waiter: $('#pinWaiter').value.trim(), kitchen: $('#pinKitchen').value.trim() },
      publicBaseUrl: $('#baseUrl').value.trim(),
      staff: readMembers(), stations: readStations(), defaultPrepMinutes: $('#defPrep').value,
    };
    try { await api('/api/admin/settings', { method: 'PUT', body }); toast('Οι ρυθμίσεις αποθηκεύτηκαν', 'ok'); render(); }
    catch (err) { toast(err.message, 'err'); }
  };
}
