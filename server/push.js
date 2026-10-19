// Notifications on the staff's phones when the screen is locked or the app is closed (Web Push: RFC 8030, 8291, 8292),
// without outside libraries. The service signs each message with its VAPID key and encrypts it for the phone, and only
// ever sends to the push services of the browsers, never to an address a phone made up.
import { createECDH, createCipheriv, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto';

// Push services of the browsers: Chrome/Android (Firebase, also as jmt17.google.com), Firefox, Safari/iOS, Edge.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^jmt\d+\.google\.com$/, /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

/** Whether the service may send to this address. `allowLocal` lets the tests use a server on 127.0.0.1. */
export function pushEndpointAllowed(url, { allowLocal = false } = {}) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (allowLocal && u.protocol === 'http:' && u.hostname === '127.0.0.1') return true;
  return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
}

const b64 = (s) => Buffer.from(String(s || ''), 'base64url');
/** The keys a phone gives when it subscribes: its public key (65 bytes) and a secret (16 bytes). */
export const validSubscriptionKeys = (keys) => b64(keys?.p256dh).length === 65 && b64(keys?.p256dh)[0] === 4 && b64(keys?.auth).length === 16;

/**
 * The VAPID key pair of the service: from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (base64url, as other tools make them),
 * else made once and kept in the database, so the phones' subscriptions stay valid across deploys.
 */
export async function loadVapidKeys(db) {
  let jwk;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    const pub = b64(process.env.VAPID_PUBLIC_KEY);
    jwk = { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33, 65).toString('base64url'), d: process.env.VAPID_PRIVATE_KEY };
  } else {
    const stored = await db.get("SELECT value FROM service_settings WHERE key = 'vapid'");
    if (stored) jwk = JSON.parse(stored.value);
    else {
      const made = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
      await db.run("INSERT INTO service_settings (key, value) VALUES ('vapid', ?) ON CONFLICT (key) DO NOTHING", [JSON.stringify(made)]);
      // Two starts at once keep the same pair: the one that was stored first.
      jwk = JSON.parse((await db.get("SELECT value FROM service_settings WHERE key = 'vapid'")).value);
    }
  }
  return {
    key: createPrivateKey({ key: jwk, format: 'jwk' }),
    publicKey: Buffer.concat([Buffer.from([4]), b64(jwk.x), b64(jwk.y)]).toString('base64url'),
  };
}

// "Authorization: vapid t=<signed token>, k=<public key>": proves the message comes from this service (RFC 8292).
function vapidHeader(endpoint, vapid, subject) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key: vapid.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `vapid t=${unsigned}.${signature}, k=${vapid.publicKey}`;
}

// The message encrypted for one phone (RFC 8291, "aes128gcm"): only that phone can read it.
// `fixed` (a sender private key and a salt) is only for checking against the example of the RFC.
export function encryptFor(sub, text, fixed = null) {
  const phoneKey = b64(sub.p256dh);
  const ecdh = createECDH('prime256v1');
  if (fixed) ecdh.setPrivateKey(b64(fixed.privateKey));
  else ecdh.generateKeys();
  const ownKey = ecdh.getPublicKey();
  const salt = fixed ? b64(fixed.salt) : randomBytes(16);
  const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(phoneKey), b64(sub.auth),
    Buffer.concat([Buffer.from('WebPush: info\0'), phoneKey, ownKey]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // One record: the text and the delimiter 2 that marks the last record.
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(text), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(4096, 16);
  head.writeUInt8(ownKey.length, 20);
  return Buffer.concat([head, ownKey, body]);
}

/** Sends one notification; returns the push service's HTTP status (201 sent; 404 and 410: the phone unsubscribed). */
export async function sendPush(sub, message, { vapid, subject, ttl = 900 }) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { TTL: String(ttl), Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      Authorization: vapidHeader(sub.endpoint, vapid, subject) },
    body: encryptFor(sub, JSON.stringify(message)),
    signal: AbortSignal.timeout(10_000),
  });
  return res.status;
}

// Texts of the notifications: Greek, or English for venues in the United States.
const WORDS = {
  el: { table: 'Τραπέζι', room: 'Δωμάτιο', sunbed: 'Ξαπλώστρα', takeaway: 'Παραλαβή', call: 'Κλήση', callBody: 'Ο πελάτης ζητά σερβιτόρο',
    bill: 'Λογαριασμός', billBody: 'Ο πελάτης ζητά τον λογαριασμό', card: 'Θα πληρώσει με κάρτα', cash: 'Θα πληρώσει με μετρητά',
    order: 'Νέα παραγγελία', approve: 'περιμένει έγκριση', ready: 'Έτοιμη για σερβίρισμα', pickupReady: 'Έτοιμη για παραλαβή', locale: 'el-GR' },
  en: { table: 'Table', room: 'Room', sunbed: 'Sunbed', takeaway: 'Pick-up', call: 'Call', callBody: 'The guest is asking for a server',
    bill: 'Check', billBody: 'The guest is asking for the check', card: 'Paying by card', cash: 'Paying cash',
    order: 'New order', approve: 'waiting for approval', ready: 'Ready to serve', pickupReady: 'Ready for pick-up', locale: 'en-US' },
};

/** The notification for a staff event (a new call, an order to approve, an order ready), or null for other events. */
export function staffMessage(venue, event, data) {
  const w = WORDS[venue.market === 'us' ? 'en' : 'el'];
  const lang = venue.market === 'us' ? 'en' : 'el';
  const spot = data.tableKind === 'takeaway' ? `${w.takeaway}${data.customer?.name ? ` · ${data.customer.name}` : ''}`
    : `${w[data.tableKind] || w.table} ${data.tableLabel}`;
  if (event === 'call') {
    const bill = data.type === 'bill';
    return { title: `${bill ? w.bill : w.call} · ${spot}`, body: bill ? w[data.paymentMethod] || w.billBody : w.callBody, tag: `call-${data.id}` };
  }
  const dishes = (data.items || []).map((i) => `${i.qty}× ${i.name?.[lang] || i.name?.el || i.name?.en || ''}`).join(', ');
  const short = dishes.length > 110 ? `${dishes.slice(0, 107)}…` : dishes;
  if (event === 'pending') {
    const total = new Intl.NumberFormat(w.locale, { style: 'currency', currency: venue.currency || 'EUR' }).format((data.total || 0) / 100);
    return { title: `${w.order} · ${spot}`, body: `${short} · ${total} · ${w.approve}`, tag: `order-${data.id}` };
  }
  if (event === 'ready') {
    return { title: `${data.tableKind === 'takeaway' ? w.pickupReady : w.ready} · ${spot}`, body: short, tag: `order-${data.id}` };
  }
  return null;
}
