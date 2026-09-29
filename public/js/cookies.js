// Cookie banner of the websites (kalimenu.gr in Greek, kalimenu.com in English).
// The service itself only uses strictly necessary cookies (sign-in). Analytics (Google Analytics) and advertising (Meta Pixel)
// are loaded only when their ids are set on the hosting (GA_MEASUREMENT_ID, META_PIXEL_ID) AND the visitor accepts them.
// Without such tools the banner is a one-time notice. The choice is kept for 6 months in the "kalimenu_consent" cookie and can be
// changed from any element with data-cookie-settings (e.g. "Cookie settings" in the footer).
const EN = document.documentElement.lang === 'en';
const T = EN ? {
  title: 'Cookies',
  notice: 'We only use cookies that are necessary for the website to work, for example to keep you signed in.',
  ask: 'We use necessary cookies to make the website work and, if you agree, cookies to understand visits and measure our ads.',
  ok: 'OK', all: 'Accept all', necessary: 'Necessary only', settings: 'Settings', save: 'Save choices', policy: 'Cookie Policy',
  cats: { necessary: ['Necessary', 'Sign-in and security. Always on.'], analytics: ['Analytics', 'Google Analytics: which pages are visited, anonymously.'],
    marketing: ['Advertising', 'Meta Pixel: measures our Facebook and Instagram ads.'] },
} : {
  title: 'Cookies',
  notice: 'Χρησιμοποιούμε μόνο cookies απαραίτητα για τη λειτουργία του site, π.χ. για να παραμένετε συνδεδεμένοι.',
  ask: 'Χρησιμοποιούμε απαραίτητα cookies για τη λειτουργία του site και, αν συμφωνείτε, cookies για στατιστικά επισκέψεων και για τη μέτρηση των διαφημίσεών μας.',
  ok: 'Εντάξει', all: 'Αποδοχή όλων', necessary: 'Μόνο απαραίτητα', settings: 'Ρυθμίσεις', save: 'Αποθήκευση επιλογών', policy: 'Πολιτική cookies',
  cats: { necessary: ['Απαραίτητα', 'Σύνδεση και ασφάλεια. Πάντα ενεργά.'], analytics: ['Στατιστικά', 'Google Analytics: ποιες σελίδες διαβάζονται, ανώνυμα.'],
    marketing: ['Διαφήμιση', 'Meta Pixel: μέτρηση των διαφημίσεών μας σε Facebook και Instagram.'] },
};
const NAME = 'kalimenu_consent';
const DAYS = 180;

const read = () => {
  const m = document.cookie.match(new RegExp(`(?:^|; )${NAME}=([^;]*)`));
  if (!m) return null;
  const [v, a, k] = decodeURIComponent(m[1]).split('.');
  return v === '1' ? { analytics: a === '1', marketing: k === '1' } : null;
};
const write = (c) => {
  document.cookie = `${NAME}=${encodeURIComponent(`1.${c.analytics ? 1 : 0}.${c.marketing ? 1 : 0}`)}; Max-Age=${DAYS * 86400}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
};

let tracking = {};
const loaded = new Set();
function loadScript(src) { const s = document.createElement('script'); s.async = true; s.src = src; document.head.append(s); }

// Google Analytics 4, with Consent Mode: nothing is stored until the visitor accepts.
function startAnalytics(id) {
  if (loaded.has('ga')) return;
  loaded.add('ga');
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); }; // eslint-disable-line prefer-rest-params
  window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  window.gtag('js', new Date());
  window.gtag('config', id, { anonymize_ip: true });
  loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
}
// Meta Pixel (Facebook / Instagram ads).
function startPixel(id) {
  if (loaded.has('pixel')) return;
  loaded.add('pixel');
  const f = window.fbq = function fbq() { f.callMethod ? f.callMethod(...arguments) : f.queue.push(arguments); }; // eslint-disable-line prefer-rest-params
  if (!window._fbq) window._fbq = f;
  f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
  loadScript('https://connect.facebook.net/en_US/fbevents.js');
  window.fbq('init', id);
  window.fbq('track', 'PageView');
}
// Global Privacy Control: the browser's "do not sell or share" signal counts as a refusal of advertising cookies.
const GPC = navigator.globalPrivacyControl === true;
function apply(c) {
  if (c?.analytics && tracking.ga) startAnalytics(tracking.ga);
  if (c?.marketing && !GPC && tracking.metaPixel) startPixel(tracking.metaPixel);
}

const css = `.ck{position:fixed;left:16px;right:16px;bottom:16px;z-index:1000;max-width:560px;margin-left:auto;background:#fff;color:#16202b;border:1px solid #e6e0d6;
  border-radius:14px;box-shadow:0 18px 48px rgba(22,32,43,.18);padding:18px 18px 16px;font:15px/1.5 Manrope,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}
  .ck b.t{display:block;font-size:1rem;margin-bottom:.25rem}.ck p{margin:0 0 .8rem;color:#5d6673}.ck p a{color:#16202b}
  .ck .acts{display:flex;flex-wrap:wrap;gap:.5rem}.ck button{border:1px solid #d9d2c6;background:#fff;color:#16202b;border-radius:10px;padding:.55rem .9rem;font:inherit;font-weight:700;cursor:pointer}
  .ck button.pri{background:#d2643c;border-color:#d2643c;color:#fff}.ck label{display:flex;gap:.6rem;align-items:flex-start;padding:.5rem 0;border-top:1px solid #efe8dc}
  .ck label input{margin-top:.3rem;accent-color:#d2643c}.ck label small{display:block;color:#5d6673}
  @media (max-width:560px){.ck{left:10px;right:10px;bottom:10px}.ck .acts button{flex:1}}`;

let box;
function close() { box?.remove(); box = null; }
function show(detail = false) {
  close();
  if (!document.getElementById('ck-css')) { const s = document.createElement('style'); s.id = 'ck-css'; s.textContent = css; document.head.append(s); }
  const optional = [tracking.ga && 'analytics', tracking.metaPixel && 'marketing'].filter(Boolean);
  const current = read() || { analytics: false, marketing: false };
  box = document.createElement('div');
  box.className = 'ck';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', T.title);
  const policy = `<a href="/cookies">${T.policy}</a>`;
  if (!optional.length) {
    box.innerHTML = `<b class="t">${T.title}</b><p>${T.notice} ${policy}.</p><div class="acts"><button class="pri" data-a="ok">${T.ok}</button></div>`;
  } else if (!detail) {
    box.innerHTML = `<b class="t">${T.title}</b><p>${T.ask} ${policy}.</p>
      <div class="acts"><button class="pri" data-a="all">${T.all}</button><button data-a="none">${T.necessary}</button><button data-a="more">${T.settings}</button></div>`;
  } else {
    const row = (k, on, fixed) => `<label><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''} ${fixed ? 'disabled' : ''}><span><b>${T.cats[k][0]}</b><small>${T.cats[k][1]}</small></span></label>`;
    box.innerHTML = `<b class="t">${T.title}</b><p>${T.ask} ${policy}.</p>${row('necessary', true, true)}${optional.map((k) => row(k, current[k])).join('')}
      <div class="acts" style="margin-top:.6rem"><button class="pri" data-a="save">${T.save}</button><button data-a="all">${T.all}</button></div>`;
  }
  box.addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (!a) return;
    if (a === 'more') return show(true);
    const choice = a === 'all' ? { analytics: true, marketing: !GPC }
      : a === 'save' ? { analytics: !!box.querySelector('[data-k=analytics]')?.checked, marketing: !!box.querySelector('[data-k=marketing]')?.checked }
        : { analytics: false, marketing: false };
    write(choice);
    close();
    // Tools already running stop at the next page load when consent is withdrawn.
    apply(choice);
  });
  document.body.append(box);
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-cookie-settings]')) { e.preventDefault(); show(true); }
});

(async () => {
  try { tracking = (await (await fetch('/api/site')).json()).tracking || {}; } catch { tracking = {}; }
  const c = read();
  if (c) apply(c);
  else show();
})();
