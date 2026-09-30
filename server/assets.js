// Shared images that are published as bundles ({ key: base64 JPEG }) instead of files in the repository:
// the photos of the example menu and the app screenshots of the home page. The server copies each bundle into
// its own database the first time it is needed, so browsers only ever load the images from this service's domain.
import { db } from './db.js';
import { SAMPLE_DISH_PHOTOS } from './seed.js';

const CDN = 'https://d2ol7oe51mr4n9.cloudfront.net/user_3FfN8uy1PiKtwJpaWKaArcUWtSr';
export const BUNDLES = [
  // Photos of the example menu dishes, served as /assets/dish-<key>.jpg.
  { prefix: 'dish-', count: 21, url: process.env.DISH_PHOTOS_URL || `${CDN}/a20ff3fe-d8f6-4068-9c6a-0ebb24831d44.json` },
  // App screenshots of the home page (menu with photos, themes, payment, kitchen, waiter), served as /assets/site-<key>.jpg.
  // The home page falls back to the older screenshots in public/img until these are loaded.
  { prefix: 'site-', count: 9, url: process.env.SITE_SHOTS_URL || `${CDN}/581661d6-4af1-4aca-a79c-a6f57eef6534.json` },
  // The same screenshots in English (New York demo) for kalimenu.com, served as /assets/site-us-<key>.jpg.
  { prefix: 'site-us-', count: 7, url: process.env.SITE_US_SHOTS_URL || `${CDN}/8823c601-c16e-40f7-b846-f284e1a35fc6.json` },
];
// A name belongs to the bundle with the longest matching prefix ("site-us-menu" is English, not "site-").
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
