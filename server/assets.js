// Shared images that are published as bundles ({ key: base64 JPEG }) instead of files in the repository:
// the photos of the example menu and the app screenshots of the home page. The server copies each bundle into
// its own database the first time it is needed, so browsers only ever load the images from this service's domain.
import { db } from './db.js';
import { SAMPLE_DISH_PHOTOS } from './seed.js';

const CDN = 'https://d2ol7oe51mr4n9.cloudfront.net/user_3FfN8uy1PiKtwJpaWKaArcUWtSr';
export const BUNDLES = [
  // Photos of the example menu dishes, served as /assets/dish-<key>.jpg.
  { prefix: 'dish-', count: 21, url: process.env.DISH_PHOTOS_URL || `${CDN}/a20ff3fe-d8f6-4068-9c6a-0ebb24831d44.json` },
  // App screenshots of the home page in the current design (menu with photos, themes, payment, kitchen, waiter), with the
  // example venue's own logo and cover, served as /assets/app2-<key>.jpg. The home page falls back to the older
  // screenshots in public/img until these are loaded. A new design gets a new prefix, because stored images are never replaced.
  { prefix: 'app2-', count: 9, url: process.env.SITE_SHOTS_URL || `${CDN}/ee64024e-966c-4a6d-9305-e3a3bec0e65f.json` },
  // The same screenshots in English (New York demo) for kalimenu.com, served as /assets/app2-us-<key>.jpg.
  { prefix: 'app2-us-', count: 8, url: process.env.SITE_US_SHOTS_URL || `${CDN}/9b08fc2d-89c1-44c5-8bcd-7d747802beb2.json` },
  // The look of the public demos (the same fictional venue as in the screenshots): /assets/demo-cover.jpg, the harbour
  // cover, and /assets/demo-logo-gr.jpg / demo-logo-us.jpg, the logos of «Ταβέρνα στο Λιμάνι» and «Harbor Tavern».
  { prefix: 'demo-', count: 3, url: process.env.DEMO_LOOK_URL || `${CDN}/2404b2ec-4274-42ec-ace9-6033f2047c81.json` },
  // The picture shown when a link to the websites is shared (Facebook, WhatsApp, Viber, LinkedIn…): /assets/og-gr.jpg
  // for kalimenu.gr and /assets/og-us.jpg for kalimenu.com. Until it is loaded, the plain ones in public/brand are sent.
  { prefix: 'og-', count: 2, url: process.env.LINK_PREVIEWS_URL || `${CDN}/bc7faaee-d49b-4ccc-bebe-4afb64c22d11.json` },
];
// A name belongs to the bundle with the longest matching prefix ("app2-us-menu" is English, not "app2-").
const bundleOf = (name) => BUNDLES.filter((b) => name.startsWith(b.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
const RETRY_MS = 10 * 60_000;
const state = new Map(); // prefix -> { loading, failedAt }

const enabled = () => process.env.SHARED_ASSETS !== 'off' && !process.env.NODE_TEST_CONTEXT;

function loadBundle(bundle) {
  const s = state.get(bundle.prefix) || {};
  state.set(bundle.prefix, s);
  if (!enabled() || !/^https:\/\//.test(bundle.url)) return Promise.resolve(false);
  if (!s.loading && Date.now() - (s.failedAt || 0) < RETRY_MS) return Promise.resolve(false);
  s.loading ??= (async () => {
    const longer = BUNDLES.filter((b) => b !== bundle && b.prefix.startsWith(bundle.prefix)).map((b) => `${b.prefix}%`);
    const { n } = await db.get(`SELECT COUNT(*) AS n FROM shared_assets WHERE name LIKE ?${' AND name NOT LIKE ?'.repeat(longer.length)}`,
      [`${bundle.prefix}%`, ...longer]);
    if (Number(n) >= bundle.count) return true;
    const res = await fetch(bundle.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for (const [key, data] of Object.entries(await res.json())) {
      if (!/^[a-z0-9-]+$/.test(key) || typeof data !== 'string') continue;
      await db.run('INSERT INTO shared_assets (name, mime, data) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING',
        [`${bundle.prefix}${key}.jpg`, 'image/jpeg', Buffer.from(data, 'base64')]);
    }
    return true;
  })().catch((err) => {
    s.loading = null;
    s.failedAt = Date.now();
    console.warn(`Shared images (${bundle.prefix}) are not available yet:`, err.message);
    return false;
  });
  return s.loading;
}

export const loadSharedAssets = () => Promise.all(BUNDLES.map(loadBundle));

export async function sharedAsset(name) {
  if (!/^[a-z0-9-]+\.jpg$/.test(name)) return null;
  const find = () => db.get('SELECT mime, data FROM shared_assets WHERE name = ?', [name]);
  const hit = await find();
  if (hit) return hit;
  const bundle = bundleOf(name);
  return bundle && (await loadBundle(bundle)) ? find() : null;
}

/** Adds the photos to the sample dishes of a venue created before photos existed (only where no photo was set). */
export async function addSamplePhotos(venueId) {
  for (const [name, url] of SAMPLE_DISH_PHOTOS) {
    if (url) await db.run("UPDATE items SET image_url = ? WHERE venue_id = ? AND name = ? AND (image_url IS NULL OR image_url = '')", [url, venueId, name]);
  }
}
