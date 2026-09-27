// Guest payments with Viva Wallet Smart Checkout. The money always goes straight to the venue's own Viva account.
// Two ways to connect a venue:
//   1. "Viva Connect" (ISV partner program): Kalimenu is a Viva ISV partner. The owner presses "Connect with Viva",
//      completes Viva's own sign-up/verification, and payments are created with Kalimenu's ISV credentials on behalf of
//      the venue's merchant id. Kalimenu may keep an ISV fee per payment (VIVA_ISV_FEE_PERCENT / VIVA_ISV_FEE_CENTS).
//   2. Manual keys: the owner copies Client ID / Client Secret / Source Code from their Viva account.
// Flow: create a payment order → redirect the guest to Viva → Viva sends the guest back to
// /pay/viva/return?t=<transactionId>&s=<orderCode> → we confirm the transaction with Viva before marking it paid.
// Endpoints per Viva's Smart Checkout and ISV Payment API documentation; test first with demo accounts.
const HOSTS = {
  demo: { accounts: 'https://demo-accounts.vivapayments.com', api: 'https://demo-api.vivapayments.com', checkout: 'https://demo.vivapayments.com' },
  live: { accounts: 'https://accounts.vivapayments.com', api: 'https://api.vivapayments.com', checkout: 'https://www.vivapayments.com' },
};
// Tests point every Viva host at a local mock (never in production).
const TEST_HOST = process.env.NODE_ENV !== 'production' && process.env.VIVA_TEST_HOST;
const hostOf = (cfg) => (TEST_HOST ? { accounts: TEST_HOST, api: TEST_HOST, checkout: TEST_HOST } : HOSTS[cfg.environment === 'live' ? 'live' : 'demo']);

/** Kalimenu's own ISV partner credentials (hosting settings), or null when Viva Connect is not set up. */
export function isvConfig() {
  const e = process.env;
  if (!e.VIVA_ISV_CLIENT_ID || !e.VIVA_ISV_CLIENT_SECRET) return null;
  return {
    isv: true, clientId: e.VIVA_ISV_CLIENT_ID, clientSecret: e.VIVA_ISV_CLIENT_SECRET, sourceCode: e.VIVA_ISV_SOURCE_CODE || '',
    environment: e.VIVA_ISV_ENV === 'live' ? 'live' : 'demo',
    feePercent: Math.min(Math.max(Number(e.VIVA_ISV_FEE_PERCENT) || 0, 0), 10),
    feeCents: Math.min(Math.max(Math.trunc(Number(e.VIVA_ISV_FEE_CENTS)) || 0, 0), 500),
  };
}

/** Kalimenu's fee for a payment of `amount` cents (the tip is never charged), always below the total. */
export function isvFee(cfg, amount, tip = 0) {
  const fee = Math.round(amount * (cfg.feePercent || 0) / 100) + (cfg.feeCents || 0);
  return Math.max(0, Math.min(fee, amount + tip - 1));
}

const tokens = new Map(); // clientId -> { token, until }

async function vivaToken(cfg) {
  const hit = tokens.get(cfg.clientId);
  if (hit && hit.until > Date.now()) return hit.token;
  const res = await fetch(`${hostOf(cfg).accounts}/connect/token`, {
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

async function vivaFetch(cfg, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${hostOf(cfg).api}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await vivaToken(cfg)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/**
 * Creates a Smart Checkout order and returns { orderCode, url, fee }. Amounts in cents.
 * With an ISV config (`cfg.isv`), the order is created for `cfg.merchantId` and Kalimenu's fee is sent as isvAmount.
 */
export async function vivaCreateOrder(cfg, { amount, tip, description, reference, lang = 'el' }) {
  const fee = cfg.isv ? isvFee(cfg, amount, tip) : 0;
  const path = cfg.isv ? `/checkout/v2/isv/orders?merchantId=${encodeURIComponent(cfg.merchantId)}` : '/checkout/v2/orders';
  const { ok, data } = await vivaFetch(cfg, path, {
    method: 'POST',
    body: {
      amount: amount + tip, tipAmount: tip || undefined, customerTrns: description, merchantTrns: reference,
      sourceCode: cfg.sourceCode || undefined, paymentTimeout: 1800, preauth: false, allowRecurring: false,
      maxInstallments: 0, disableCash: true, customer: { requestLang: lang === 'el' ? 'el-GR' : 'en-GB' },
      ...(cfg.isv ? { isvAmount: fee } : {}),
    },
  });
  if (!ok || !data.orderCode) throw Object.assign(new Error('Το Viva Wallet δεν δέχτηκε την πληρωμή'), { status: 502 });
  const orderCode = String(data.orderCode);
  return { orderCode, fee, url: `${hostOf(cfg).checkout}/web/checkout?ref=${encodeURIComponent(orderCode)}` };
}

/** Confirms a transaction: { ok, amount (cents), orderCode }. */
export async function vivaVerify(cfg, transactionId) {
  const id = encodeURIComponent(transactionId);
  const path = cfg.isv ? `/checkout/v2/isv/transactions/${id}?merchantId=${encodeURIComponent(cfg.merchantId)}` : `/checkout/v2/transactions/${id}`;
  const { ok, data } = await vivaFetch(cfg, path);
  if (!ok) return { ok: false };
  // statusId "F" = finished (paid). Amount is returned in euros.
  return { ok: data.statusId === 'F', amount: Math.round(Number(data.amount) * 100), orderCode: String(data.orderCode ?? '') };
}

// ---------------------------------------------------------------------------
// Viva Connect: connected accounts (merchant onboarding). Viva runs the whole sign-up and verification (KYC/KYB).
// ---------------------------------------------------------------------------

/** Starts onboarding for a venue. Returns { accountId, redirectUrl } (the Viva page the owner opens). */
export async function isvCreateAccount(cfg, { email, returnUrl }) {
  const { ok, data } = await vivaFetch(cfg, '/isv/v1/accounts', { method: 'POST', body: { email, returnUrl } });
  const accountId = data.accountId || data.id;
  const redirectUrl = data.redirectUrl || data.invitation?.redirectUrl;
  if (!ok || !accountId || !redirectUrl) {
    throw Object.assign(new Error(data.message || 'Η Viva δεν δέχτηκε τη σύνδεση. Δοκιμάστε ξανά σε λίγο.'), { status: 502 });
  }
  return { accountId: String(accountId), redirectUrl: String(redirectUrl) };
}

/** Current state of a connected account: { merchantId, verified, email, redirectUrl }. */
export async function isvGetAccount(cfg, accountId) {
  const { ok, status, data } = await vivaFetch(cfg, `/isv/v1/accounts/${encodeURIComponent(accountId)}`);
  if (!ok) throw Object.assign(new Error(status === 404 ? 'Η σύνδεση δεν βρέθηκε στη Viva' : 'Αποτυχία ελέγχου στη Viva'), { status: 502 });
  const merchantId = data.merchantId || data.merchant?.id || data.merchants?.[0]?.merchantId || '';
  const verified = data.verified === true || data.isVerified === true || /^verified$/i.test(data.verificationStatus || data.status || '');
  return { merchantId: String(merchantId || ''), verified, email: data.email || '', redirectUrl: data.invitation?.redirectUrl || data.redirectUrl || '' };
}

// ---------------------------------------------------------------------------
// Webhooks: Viva tells us about every paid transaction, so a payment counts even when the guest closes the phone
// before coming back to the menu. Viva first checks the URL with a GET that must answer with our verification key.
// ---------------------------------------------------------------------------
let webhookKey = { key: '', until: 0 };

/** Verification key for the webhook URL (ISV partner account), cached for an hour. */
export async function isvWebhookKey(cfg) {
  if (webhookKey.key && webhookKey.until > Date.now()) return webhookKey.key;
  const { ok, data } = await vivaFetch(cfg, '/isv/v1/webhooks/token');
  const key = data.key || data.Key;
  if (!ok || !key) throw Object.assign(new Error('Αποτυχία λήψης κλειδιού webhook από τη Viva'), { status: 502 });
  webhookKey = { key: String(key), until: Date.now() + 3600_000 };
  return webhookKey.key;
}

/** Registers our webhook URL for paid transactions (event 1796, "Transaction Payment Created") of connected venues. */
export async function isvCreateWebhook(cfg, url) {
  const { ok, data } = await vivaFetch(cfg, '/isv/v1/webhooks', { method: 'POST', body: { url, eventTypeId: 1796 } });
  if (!ok) throw Object.assign(new Error(data.message || 'Η Viva δεν δέχτηκε το webhook'), { status: 502 });
  return data;
}
