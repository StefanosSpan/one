// The header and footer of the sign-up, login, demo and legal pages, which the server puts in place of their own
// (see server/site.js → siteHeader, siteFooter): the header's menus, the company details and the year. The cookie
// settings link is handled by cookies.js.
import '/js/legal.js';
import '/js/cookies.js';
import '/js/header.js';

const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();
