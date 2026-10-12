// Behaviour of the website pages built on the server (the pages for searches, see server/landing.js):
// icons, the header border on scroll, the soft fade-in of sections, the year and the company details in the footer.
import { icon } from '/js/icons.js';
import '/js/legal.js';
import '/js/cookies.js';

document.querySelectorAll('[data-i]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.i, el.classList.contains('fi') ? 20 : 18)));

const header = document.getElementById('top');
const onScroll = () => header.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true }); onScroll();

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
} else document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));

document.getElementById('year').textContent = new Date().getFullYear();
