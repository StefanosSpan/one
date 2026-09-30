export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export class ApiError extends Error {
  // code: the server's error text or code; reason: an extra machine-readable code (e.g. plan_limit, venue_required).
  constructor(status, code, reason = '') { super(code); this.status = status; this.code = code; this.reason = reason; }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'error', data.code || '');
  return data;
}

export function toast(msg, kind = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.append(el);
  setTimeout(() => el.remove(), 3800);
}

// Bottom sheet / modal. Returns { el, close }.
export function sheet(html, { onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  return { el: back.querySelector('.sheet'), close };
}

// Server-Sent Events with status callback (EventSource reconnects on its own).
export function stream(url, handlers, onStatus) {
  const es = new EventSource(url);
  es.onopen = () => onStatus?.(true);
  es.onerror = () => onStatus?.(false);
  for (const [event, fn] of Object.entries(handlers)) {
    es.addEventListener(event, (e) => fn(JSON.parse(e.data || '{}')));
  }
  return es;
}

// Short notification sound (no audio files needed).
let audioCtx;
export function beep(times = 2) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = i % 2 ? 660 : 880;
      const t = audioCtx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.2);
    }
  } catch { /* audio not available */ }
}
export const unlockAudio = () => { try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { /* ignore */ } };

export function timeAgo(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'τώρα';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}′`;
  return `${Math.floor(m / 60)}ω ${m % 60}′`;
}

// Language, date format and currency of the staff screens: Greece (euros) or the United States (dollars); see lang.js.
export const L10N = { market: 'gr', locale: 'el-GR', currency: 'EUR' };
// Hours and minutes: Greek uses the 24-hour clock (Intl would write "07:40 μ.μ."), English in the United States 12 hours.
export const hm = (locale = L10N.locale) => ({ hour: '2-digit', minute: '2-digit', ...(/^el\b/.test(locale) ? { hourCycle: 'h23' } : {}) });
export const euro = (cents) => new Intl.NumberFormat(L10N.locale, { style: 'currency', currency: L10N.currency }).format(cents / 100);
