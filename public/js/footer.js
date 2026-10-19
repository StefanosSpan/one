// The footer of the sign-up, login, demo and legal pages (added by the server, see server/site.js → siteFooter): the
// company details and the year. The cookie settings link is handled by cookies.js.
import '/js/legal.js';

const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();
