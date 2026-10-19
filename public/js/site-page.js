// Behaviour of the website pages (built on the server, see server/site.js): the header, the menu on phones, the
// Solutions menu, the phone that follows the steps of an order, monthly or yearly prices, the contact form, the
// company details and the year in the footer.
import { ready } from '/js/legal.js';
import '/js/cookies.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

// The header gets a line once the page scrolls, steps aside while reading down and comes back on the way up.
const header = $('.sh');
let lastY = scrollY;
addEventListener('scroll', () => {
  const y = scrollY;
  header.classList.toggle('scrolled', y > 8);
  header.classList.toggle('away', y > 400 && y > lastY && !document.body.classList.contains('nav-open') && !$('.sh-drop.open'));
  lastY = y;
}, { passive: true });

// The menu on phones.
const burger = $('.sh-burger');
const setNav = (open) => { burger?.setAttribute('aria-expanded', String(open)); document.body.classList.toggle('nav-open', open); };
burger?.addEventListener('click', () => setNav(burger.getAttribute('aria-expanded') !== 'true'));

// Solutions: opens on a click (with a mouse also on hover, see site.css) and closes on a click elsewhere or Escape.
const drop = $('.sh-drop');
const dropBtn = $('.sh-drop-btn');
const setDrop = (open) => { drop?.classList.toggle('open', open); dropBtn?.setAttribute('aria-expanded', String(open)); };
dropBtn?.addEventListener('click', (e) => { e.stopPropagation(); setDrop(!drop.classList.contains('open')); });
document.addEventListener('click', (e) => { if (drop && !drop.contains(e.target)) setDrop(false); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  setDrop(false);
  if (document.body.classList.contains('nav-open')) { setNav(false); burger.focus(); }
});
addEventListener('resize', () => { if (innerWidth > 1080) setNav(false); });

// Home: the phone shows the step that is in the middle of the screen.
const steps = $$('.story-steps > li');
const screens = $$('.stage .screen');
const dots = $$('.story-dots li');
if (steps.length && 'IntersectionObserver' in window) {
  const show = (i) => [steps, screens, dots].forEach((list) => list.forEach((el, k) => el.classList.toggle('on', k === i)));
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) show(Number(e.target.dataset.step)); }),
    { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((s) => io.observe(s));
}

// Pricing: monthly or yearly, and the sign-up links follow.
const plans = $('.plans');
const choices = $$('.billing [data-b]');
choices.forEach((b) => b.addEventListener('click', () => {
  plans.dataset.billing = b.dataset.b;
  choices.forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  $$('[data-plan]', plans).forEach((a) => { a.href = `/signup?plan=${a.dataset.plan}&interval=${b.dataset.b}`; });
}));

// The contact form.
const form = $('#contactForm');
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('.form-status', form);
  const button = $('button', form);
  button.disabled = true;
  status.className = 'form-status';
  status.textContent = '';
  try {
    const r = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status < 500 && data.error ? data.error : form.dataset.error);
    form.reset();
    status.textContent = form.dataset.sent;
    status.classList.add('ok');
  } catch (err) {
    status.textContent = err.message || form.dataset.error;
    status.classList.add('err');
  } finally { button.disabled = false; }
});

// Contact details: the box shows only when there is something in it.
ready.then(() => {
  for (const box of $$('[data-details]')) box.hidden = !$$('[data-if]', box).some((el) => !el.hidden);
});

$('#year').textContent = new Date().getFullYear();
