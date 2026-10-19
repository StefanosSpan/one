// The header of every page of the websites (server/site.js → siteHeader): it gets a line once the page scrolls, steps
// aside while reading down and comes back on the way up; the menu on phones; the Solutions list.
const $ = (s, root = document) => root.querySelector(s);

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

// Solutions: opens on a click (with a mouse also on hover, see header.css) and closes on a click elsewhere or Escape.
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
