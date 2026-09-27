// Subscription plans and what each one allows. Prices are in cents per month, excluding VAT.
// Yearly billing costs 10 months (2 months free).
// Two months free, no card needed: long enough to run a full month of the season before paying.
export const TRIAL_DAYS = 60;

export const PLANS = {
  free: {
    name: 'Δωρεάν', month: 0, maxItems: 40, maxSpots: 10,
    ordering: false, calls: false, branding: false, photos: false, kinds: ['table'],
  },
  basic: {
    name: 'Βασικό', month: 790, maxItems: null, maxSpots: null,
    ordering: false, calls: true, branding: true, photos: true, kinds: ['table'],
  },
  pro: {
    name: 'Pro', month: 1490, maxItems: null, maxSpots: null,
    ordering: true, calls: true, branding: true, photos: true, kinds: ['table'],
  },
  hotel: {
    name: 'Ξενοδοχείο', month: 2490, maxItems: null, maxSpots: null,
    ordering: true, calls: true, branding: true, photos: true, kinds: ['table', 'room', 'sunbed'],
  },
};

export const PAID_PLANS = ['basic', 'pro', 'hotel'];

export const priceCents = (plan, interval) => PLANS[plan].month * (interval === 'year' ? 10 : 1);

// The plan whose features apply right now. A trial that ended without payment, a paused or a
// cancelled subscription fall back to the free plan: the menu and the printed QR codes keep working.
// A venue suspended by the platform administrator is offline altogether (see server/index.js).
export function effectivePlan(venue) {
  if (!venue || !PLANS[venue.plan]) return 'free';
  if (venue.status === 'trialing') return new Date(venue.trial_ends_at) > new Date() ? venue.plan : 'free';
  if (venue.status === 'active' || venue.status === 'past_due') return venue.plan;
  return 'free';
}

export const features = (venue) => PLANS[effectivePlan(venue)];
