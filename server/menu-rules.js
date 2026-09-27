// Rules that decide what a guest sees and pays at a given moment and spot:
// category schedules (breakfast, room service hours…), per-zone menus, happy hour prices and all-inclusive spots.
export const DEFAULT_TZ = 'Europe/Athens';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Day of week (1 = Monday … 7 = Sunday) and minutes since midnight in the venue's time zone. */
export function venueClock(tz = DEFAULT_TZ, date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1;
  return { day, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** A window {days:[1-7], from:'HH:MM', to:'HH:MM'}; empty means always. Windows past midnight (22:00–02:00) work. */
export function inWindow(win, clock) {
  if (!win || (!win.from && !win.to && !(win.days || []).length)) return true;
  const days = (win.days || []).length ? win.days : [1, 2, 3, 4, 5, 6, 7];
  if (!win.from || !win.to) return days.includes(clock.day);
  const from = toMinutes(win.from), to = toMinutes(win.to);
  if (from <= to) return days.includes(clock.day) && clock.minutes >= from && clock.minutes < to;
  // Past midnight: the early hours belong to the previous day's window.
  if (clock.minutes >= from) return days.includes(clock.day);
  const yesterday = clock.day === 1 ? 7 : clock.day - 1;
  return clock.minutes < to && days.includes(yesterday);
}

export function cleanWindow(w) {
  if (!w || typeof w !== 'object') return null;
  const days = [...new Set((Array.isArray(w.days) ? w.days : []).map(Number).filter((d) => d >= 1 && d <= 7))].sort();
  const from = TIME.test(w.from) ? w.from : '';
  const to = TIME.test(w.to) ? w.to : '';
  if (!days.length && !from && !to) return null;
  return { days, from, to };
}

export const cleanZones = (list) => [...new Set((Array.isArray(list) ? list : [])
  .map((z) => String(z ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 30)).filter(Boolean))].slice(0, 30);

/** Is a category shown at this spot right now? */
export function categoryVisible(cat, { clock, table }) {
  if (!cat.active) return false;
  if (!inWindow(cat.schedule, clock)) return false;
  const zones = cat.zones || [];
  if (zones.length && table && !zones.includes(table.zone || '')) return false;
  return true;
}

export const happyHourActive = (settings, clock) => !!settings.happyHour?.enabled && inWindow(settings.happyHour, clock);

/** Price of a dish (without options) for this spot and moment, and why. */
export function dishPrice(item, { happy, table }) {
  if (table?.all_inclusive && !item.premium) return { price: 0, included: true, happy: false };
  if (happy && item.happy_price_cents != null && item.happy_price_cents < item.price_cents) {
    return { price: item.happy_price_cents, included: false, happy: true };
  }
  return { price: item.price_cents, included: false, happy: false };
}
