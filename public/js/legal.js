// Fills the business details of the service provider (set on the hosting with COMPANY_* variables)
// into the legal pages and the footer: <span data-company="name"></span>, data-company="vat", …
// A detail that is not set is left out together with its label: wrap them in <span data-if="vat">…</span>.
const FALLBACK = { name: 'Kalimenu' };

export async function fillCompany(root = document) {
  let company = {};
  try { company = (await (await fetch('/api/site')).json()).company || {}; } catch { /* offline preview */ }
  for (const el of root.querySelectorAll('[data-if]')) el.hidden = !company[el.dataset.if];
  for (const el of root.querySelectorAll('[data-company]')) {
    const key = el.dataset.company;
    const value = company[key];
    el.textContent = value || FALLBACK[key] || '';
    if (value && key === 'email') el.innerHTML = `<a href="mailto:${value}">${value}</a>`;
  }
  // A line of " · "-separated details starts with its first shown detail, not with a separator.
  for (const line of root.querySelectorAll('.co-line')) {
    const first = [...line.children].find((el) => !el.hidden);
    if (first?.firstChild?.nodeType === Node.TEXT_NODE) first.firstChild.textContent = first.firstChild.textContent.replace(/^ · /, '');
    line.hidden = !first;
  }
  return company;
}

fillCompany();
