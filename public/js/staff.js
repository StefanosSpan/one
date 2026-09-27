// Shared helpers for staff screens (login check, top bar, live connection).
import { api, esc, stream, unlockAudio } from './util.js';
import { icon } from './icons.js';

const HOME = { admin: '/staff/admin', waiter: '/staff/waiter', kitchen: '/staff/kitchen' };

export async function requireLogin(allowed) {
  try {
    const me = await api('/api/staff/me');
    if (me.role !== 'admin' && !allowed.includes(me.role)) { location.href = HOME[me.role]; return null; }
    return me;
  } catch {
    location.href = `/staff?next=${encodeURIComponent(location.pathname)}`;
    return null;
  }
}

export function topBar(me, current, title) {
  const links = me.role === 'admin'
    ? [['waiter', 'users', 'Σερβιτόρος'], ['kitchen', 'flame', 'Κουζίνα'], ['admin', 'sliders', 'Διαχείριση']]
    : [];
  const bar = document.createElement('header');
  bar.className = 'bar';
  bar.innerHTML = `<div class="bar-inner">
    <div class="title"><span class="conn" id="conn"></span>${esc(title)}<span class="venue">${esc(me.restaurant || '')}</span></div>
    ${links.map(([k, , l]) => `<a href="${HOME[k]}" class="${k === current ? 'active' : ''}">${l}</a>`).join('')}
    <button id="soundBtn" title="Ήχος ειδοποιήσεων"></button>
    <button id="logout" title="Έξοδος"><span>Έξοδος</span></button>
  </div>`;
  document.body.prepend(bar);
  let soundOn = false;
  const sb = bar.querySelector('#soundBtn');
  const setSound = (on) => {
    soundOn = on;
    sb.innerHTML = `${icon(on ? 'volume' : 'volumeOff', 16)}<span>${on ? 'Ήχος: ναι' : 'Ήχος: όχι'}</span>`;
    if (on) unlockAudio();
  };
  setSound(false);
  sb.onclick = () => setSound(!soundOn);
  // Browsers only allow sound after a user gesture: enable on first tap anywhere.
  document.addEventListener('pointerdown', () => { if (!soundOn) setSound(true); }, { once: true });
  bar.querySelector('#logout').onclick = async () => {
    await api('/api/staff/logout', { method: 'POST' });
    location.href = me.owner ? '/login' : `/staff?v=${encodeURIComponent(me.venue?.slug || '')}`;
  };
  return { soundEnabled: () => soundOn };
}

export function liveStaff(onChange) {
  let timer;
  const trigger = (evt) => (data) => { clearTimeout(timer); timer = setTimeout(() => onChange(evt, data), 120); };
  const events = ['order:new', 'order:update', 'call:new', 'call:update', 'call:done', 'table:paid', 'table:closed', 'menu:update'];
  return stream('/api/staff/stream', Object.fromEntries(events.map((e) => [e, trigger(e)])), (ok) => {
    document.getElementById('conn')?.classList.toggle('off', !ok);
    if (ok) onChange('reconnect', {});
  });
}

export const LANG_CODES = { el: 'EL', en: 'EN', de: 'DE', fr: 'FR', it: 'IT', es: 'ES', nl: 'NL', pl: 'PL' };
export const KIND = {
  table: { one: 'Τραπέζι', short: 'Τρ.', icon: 'utensils' },
  room: { one: 'Δωμάτιο', short: 'Δωμ.', icon: 'bed' },
  sunbed: { one: 'Ξαπλώστρα', short: 'Ξαπλ.', icon: 'pin' },
};
export const spotName = (kind, label, short = false) => `${(KIND[kind] || KIND.table)[short ? 'short' : 'one']} ${label}`;
// Chosen options of an order line, e.g. "Καλοψημένο, Έξτρα φέτα".
export const optionNames = (line) => (line.options || []).map((x) => x.choice?.el || x.choice?.en || '').join(', ');
export const itemName = (name) => name?.el || name?.en || Object.values(name || {})[0] || '';
