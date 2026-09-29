// Subscription plans. Both include every feature (ordering, payments, rooms, sunbeds…);
// they differ only in how many spots with a QR code the venue has.
// Prices are in cents per month, excluding VAT / sales tax, per currency: euros for Greece (kalimenu.gr),
// dollars for the United States (kalimenu.com, New York pricing). Yearly billing costs 10 months (2 months free).
export const TRIAL_DAYS = 14;
export const STANDARD_SPOTS = 50;

const ALL_KINDS = ['table', 'room', 'sunbed'];

export const PLANS = {
  pro: { name: 'Kalimenu', month: 1490, prices: { EUR: 1490, USD: 2900 }, maxSpots: STANDARD_SPOTS, ordering: true, calls: true, kinds: ALL_KINDS },
  plus: { name: 'Kalimenu Plus', month: 2990, prices: { EUR: 2990, USD: 5900 }, maxSpots: null, ordering: true, calls: true, kinds: ALL_KINDS },
};

export const PAID_PLANS = Object.keys(PLANS);

// No trial and no paid subscription: the menu is not shown to guests, the owner can still sign in,
// prepare the menu and choose a plan. Nothing is deleted, so the printed QR codes work again on renewal.
export const INACTIVE = { name: 'Χωρίς συνδρομή', month: 0, maxSpots: null, ordering: false, calls: false, kinds: ALL_KINDS, inactive: true };

export const CURRENCIES = ['EUR', 'USD'];
export const priceCents = (plan, interval, currency = 'EUR') => (PLANS[plan].prices[currency] ?? PLANS[plan].month) * (interval === 'year' ? 10 : 1);

/** The plans with their monthly price in one currency (what a venue or a visitor of that market sees). */
export const plansIn = (currency = 'EUR') => Object.fromEntries(Object.entries(PLANS)
  .map(([k, p]) => [k, { ...p, month: p.prices[currency] ?? p.month, currency }]));

// Plan stored on the venue; older plan names are mapped to the current ones.
export const planOf = (venue) => (PLANS[venue?.plan] ? venue.plan : venue?.plan === 'hotel' ? 'plus' : 'pro');

// The smallest plan that fits a number of spots.
export const planForSpots = (spots) => (spots > STANDARD_SPOTS ? 'plus' : 'pro');

/** The plan that applies right now, or null while the venue has no running trial or subscription. */
export function effectivePlan(venue) {
  if (!venue) return null;
  if (venue.status === 'trialing') return new Date(venue.trial_ends_at) > new Date() ? planOf(venue) : null;
  if (venue.status === 'active' || venue.status === 'past_due') return planOf(venue);
  return null; // paused, canceled, suspended
}

export const features = (venue) => PLANS[effectivePlan(venue)] || INACTIVE;
