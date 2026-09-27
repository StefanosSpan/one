// Guest payments with Viva Wallet Smart Checkout. Each venue uses its own Viva account, so the money goes
// straight to the venue. Flow: create a payment order → redirect the guest to Viva → Viva sends the guest back
// to /pay/viva/return?t=<transactionId>&s=<orderCode> → we confirm the transaction with Viva before marking it paid.
// Endpoints per Viva's Smart Checkout documentation; test first with a demo account (environment "demo").
const HOSTS = {
  demo: { accounts: 'https://demo-accounts.vivapayments.com', api: 'https://demo-api.vivapayments.com', checkout: 'https://demo.vivapayments.com' },
  live: { accounts: 'https://accounts.vivapayments.com', api: 'https://api.vivapayments.com', checkout: 'https://www.vivapayments.com' },
};

const tokens = new Map(); // clientId -> { token, until }

async function vivaToken(cfg) {
  const hit = tokens.get(cfg.clientId);
  if (hit && hit.until > Date.now()) return hit.token;
  const host = HOSTS[cfg.environment === 'live' ? 'live' : 'demo'];
  const res = await fetch(`${host.accounts}/connect/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw Object.assign(new Error('Αποτυχία σύνδεσης με το Viva Wallet'), { status: 502 });
  tokens.set(cfg.clientId, { token: data.access_token, until: Date.now() + ((data.expires_in || 3600) - 60) * 1000 });
  return data.access_token;
}

/** Creates a Smart Checkout order and returns { orderCode, url }. Amounts in cents. */
export async function vivaCreateOrder(cfg, { amount, tip, description, reference, lang = 'el' }) {
  const host = HOSTS[cfg.environment === 'live' ? 'live' : 'demo'];
  const res = await fetch(`${host.api}/checkout/v2/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await vivaToken(cfg)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: amount + tip, tipAmount: tip || undefined, customerTrns: description, merchantTrns: reference,
      sourceCode: cfg.sourceCode || undefined, paymentTimeout: 1800, preauth: false, allowRecurring: false,
      maxInstallments: 0, disableCash: true, customer: { requestLang: lang === 'el' ? 'el-GR' : 'en-GB' },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.orderCode) throw Object.assign(new Error('Το Viva Wallet δεν δέχτηκε την πληρωμή'), { status: 502 });
  const orderCode = String(data.orderCode);
  return { orderCode, url: `${host.checkout}/web/checkout?ref=${encodeURIComponent(orderCode)}` };
}

/** Confirms a transaction: { ok, amount (cents), orderCode }. */
export async function vivaVerify(cfg, transactionId) {
  const host = HOSTS[cfg.environment === 'live' ? 'live' : 'demo'];
  const res = await fetch(`${host.api}/checkout/v2/transactions/${encodeURIComponent(transactionId)}`, {
    headers: { Authorization: `Bearer ${await vivaToken(cfg)}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false };
  // statusId "F" = finished (paid). Amount is returned in euros.
  return { ok: data.statusId === 'F', amount: Math.round(Number(data.amount) * 100), orderCode: String(data.orderCode ?? '') };
}
