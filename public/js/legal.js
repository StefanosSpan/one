// Fills the business details of the service provider (set on the hosting with COMPANY_* variables)
// into the legal pages and the footer: <span data-company="name"></span>, data-company="vat", …
const FIELDS = { name: 'Επωνυμία', vat: 'ΑΦΜ', taxOffice: 'ΔΟΥ', gemi: 'Αρ. ΓΕΜΗ', address: 'Διεύθυνση', email: 'E-mail', phone: 'Τηλέφωνο' };

export async function fillCompany(root = document) {
  let company = {};
  try { company = (await (await fetch('/api/site')).json()).company || {}; } catch { /* offline preview */ }
  for (const el of root.querySelectorAll('[data-company]')) {
    const key = el.dataset.company;
    const value = company[key];
    el.textContent = value || `[${FIELDS[key] || key}]`;
    if (value && key === 'email') el.innerHTML = `<a href="mailto:${value}">${value}</a>`;
  }
  return company;
}

fillCompany();
