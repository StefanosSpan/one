// Guest menu theme, shared by the menu (customer.js) and the live preview in the administration.
// Look chosen by the venue: background, text and category colours, fonts and corners. Secondary colours
// (muted text, lines, fields) are mixed from the background and text so any combination stays readable.
const FONTS = {
  modern: [null, null],
  classic: ["Georgia, 'Times New Roman', serif", null],
  elegant: ["'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif", "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif"],
  rounded: ["ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif", "ui-rounded, 'SF Pro Rounded', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"],
  traditional: ["Georgia, 'Times New Roman', serif", "Georgia, 'Times New Roman', serif"],
};
const RADIUS = { square: '2px', soft: '8px', round: '16px' };
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, w) => `#${rgb(a).map((v, i) => Math.round(v * (1 - w) + rgb(b)[i] * w).toString(16).padStart(2, '0')).join('')}`;
const isDark = (hex) => { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) < 140; };

export function applyTheme(theme = {}, root = document.documentElement) {
  const bg = theme.background || '#ffffff';
  const text = theme.text || (isDark(bg) ? '#f4f1ea' : '#1a1a1a');
  const dark = isDark(bg);
  const set = (k, v) => (v ? root.style.setProperty(k, v) : root.style.removeProperty(k));
  set('--bg', bg);
  set('--surface', dark ? mix(bg, '#ffffff', 0.07) : (bg === '#ffffff' ? '#ffffff' : mix(bg, '#ffffff', 0.55)));
  set('--text', text);
  set('--muted', mix(text, bg, 0.42));
  set('--faint', mix(text, bg, 0.58));
  set('--line', mix(text, bg, 0.88));
  set('--border', mix(text, bg, 0.8));
  set('--fill', mix(text, bg, 0.94));
  set('--cat', theme.category || text);
  const [display, body] = FONTS[theme.font] || FONTS.modern;
  set('--font-display', display);
  if (body) root.style.setProperty('--font', body); else root.style.removeProperty('--font');
  set('--radius', RADIUS[theme.corners] || null);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

export const THEME_PRESETS = [
  { name: 'Λευκό', brand: '#1f3a5f', background: '#ffffff', text: '#1a1a1a', category: '', font: 'modern', corners: 'soft' },
  { name: 'Κρεμ ταβέρνα', brand: '#8a4b2a', background: '#f6efe3', text: '#2b2118', category: '#8a4b2a', font: 'traditional', corners: 'soft' },
  { name: 'Αιγαίο', brand: '#1c5d8f', background: '#f3f7fa', text: '#15314b', category: '#1c5d8f', font: 'classic', corners: 'round' },
  { name: 'Ελιά', brand: '#5a6b2f', background: '#f4f3ea', text: '#26301f', category: '#5a6b2f', font: 'elegant', corners: 'soft' },
  { name: 'Σκούρο lounge', brand: '#d9b26f', background: '#141414', text: '#f1ece3', category: '#d9b26f', font: 'elegant', corners: 'square' },
  { name: 'Νύχτα', brand: '#7fb3e6', background: '#0f1b2d', text: '#eef2f7', category: '#7fb3e6', font: 'modern', corners: 'round' },
];
