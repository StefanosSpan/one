// Subscription billing with Stripe (Checkout, customer portal, webhooks), without the Stripe SDK.
// Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. Prices are created on the fly from server/plans.js,
// so nothing has to be set up in the Stripe dashboard except the webhook and the customer portal.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const stripeEnabled = () => !!process.env.STRIPE_SECRET_KEY;

// {a: {b: [ {c: 1} ]}} -> a[b][0][c]=1
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe(path, params, method = 'POST') {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : form(params || {}),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error?.message || 'Σφάλμα πληρωμών');
    err.status = 502;
    throw err;
  }
  return data;
}

// Verifies the Stripe-Signature header (https://docs.stripe.com/webhooks#verify-manually).
export function verifyWebhook(raw, header, secret = process.env.STRIPE_WEBHOOK_SECRET, toleranceSec = 300) {
  if (!secret || !header) return null;
  const parts = Object.groupBy(String(header).split(',').map((p) => p.split('=')), ([k]) => k);
  const t = parts.t?.[0]?.[1];
  const sigs = (parts.v1 || []).map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex'));
  const ok = sigs.some((s) => {
    const given = Buffer.from(s);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Stripe subscription status -> our venue status.
export function venueStatus(sub) {
  if (sub.pause_collection) return 'paused';
  switch (sub.status) {
    case 'active':
    case 'trialing': return 'active'; // card on file; Stripe starts charging when its trial ends
    case 'past_due':
    case 'unpaid': return 'past_due';
    case 'paused': return 'paused';
    case 'canceled':
    case 'incomplete_expired': return 'canceled';
    default: return null; // incomplete: wait for the next event
  }
}
