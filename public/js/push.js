// Notifications on the waiter's phone when the screen is locked or the app is closed (Web Push, see server/push.js).
import { api } from './util.js';

const SCOPE = '/staff/';
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const iPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const bytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function current() {
  const reg = await navigator.serviceWorker.getRegistration(SCOPE);
  return { reg, sub: await reg?.pushManager.getSubscription() };
}

/**
 * 'on', 'off', 'denied' (blocked in the browser), 'install' (iPhone: works only from the icon on the home screen)
 * or 'unsupported'.
 */
export async function pushState() {
  if (!supported()) return iPhone() && !standalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  return (await current()).sub ? 'on' : 'off';
}

/** Asks for permission (must run from a tap) and subscribes this phone. Returns the new state. */
export async function enablePush() {
  // First, while the tap still counts: browsers show the question only in answer to a tap.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.register(`${SCOPE}sw.js`, { scope: SCOPE });
  await navigator.serviceWorker.ready;
  const { publicKey } = await api('/api/staff/push');
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another key of the service is replaced.
  if (sub && sub.options?.applicationServerKey && b64(sub.options.applicationServerKey) !== publicKey) { await sub.unsubscribe(); sub = null; }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(publicKey) });
  try {
    await api('/api/staff/push', { method: 'POST', body: sub.toJSON() });
  } catch (e) {
    // Not kept by the service: the phone does not keep it either, so the screen never shows "on" by mistake.
    await sub.unsubscribe().catch(() => {});
    throw e;
  }
  return 'on';
}

/** Renews the subscription of this phone for the person signed in now (each time the waiter screen opens). */
export async function renewPush() {
  if (await pushState() !== 'on') return;
  const { sub } = await current();
  await api('/api/staff/push', { method: 'POST', body: sub.toJSON() }).catch(() => {});
}

/** Stops the notifications on this phone (also on sign-out, so the next person does not get them). */
export async function disablePush() {
  if (!supported()) return;
  const { sub } = await current();
  if (!sub) return;
  await api('/api/staff/push/off', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
