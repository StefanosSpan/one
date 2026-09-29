// Renders printable order slips and bills (used by the staff print page and the guest's digital copy).
import { esc } from './util.js';

const KIND_EL = { table: 'Τραπέζι', room: 'Δωμάτιο', sunbed: 'Ξαπλώστρα' };
const eur = (c) => new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(c / 100);
const when = (iso, locale = 'el-GR') => new Date(iso).toLocaleString(locale, {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const nameIn = (obj, lang = 'el') => obj?.[lang] || obj?.el || obj?.en || Object.values(obj || {})[0] || '';

function header(r, { withLegal = false } = {}) {
  return `<div class="c">
    ${r.logoUrl ? `<img class="logo" src="${esc(r.logoUrl)}" alt="">` : ''}
    <div class="venue">${esc(r.name)}</div>
    ${withLegal ? `
      ${r.legalName ? `<div class="legal">${esc(r.legalName)}</div>` : ''}
      ${r.vatNumber || r.taxOffice ? `<div class="legal">${r.vatNumber ? `ΑΦΜ ${esc(r.vatNumber)}` : ''}${r.vatNumber && r.taxOffice ? ' · ' : ''}${r.taxOffice ? `ΔΟΥ ${esc(r.taxOffice)}` : ''}</div>` : ''}
      ${r.address ? `<div class="legal">${esc(r.address)}</div>` : ''}
      ${r.phone ? `<div class="legal">Τηλ. ${esc(r.phone)}</div>` : ''}` : ''}
  </div>`;
}

// Kitchen / waiter slip for one order (Greek dish names, large quantities, notes in bold).
export function orderSlip(order, restaurant) {
  return `<div class="slip">
    ${header(restaurant)}
    <div class="c title">Δελτίο παραγγελίας</div>
    <div class="c spot">${esc(KIND_EL[order.tableKind] || 'Τραπέζι')} ${esc(order.tableLabel)}</div>
    <div class="c meta">Παραγγελία #${order.id} · ${when(order.createdAt)} · ${order.takenBy ? esc(order.takenBy) : `QR ${esc(order.lang.toUpperCase())}`}</div>
    ${order.customer ? `<div class="c meta">Παραλαβή: ${esc(order.customer.name)} · ${esc(order.customer.phone)}${order.customer.pickupAt ? ` · ${when(order.customer.pickupAt)}` : ''}</div>` : ''}
    <hr>
    <table class="kitchen-items">
      ${order.items.map((i) => `<tr><td class="q">${i.qty}×</td><td>${esc(nameIn(i.name))}
        ${(i.options || []).map((o) => `<div class="opt">+ ${esc(nameIn(o.choice))}</div>`).join('')}
        ${i.note ? `<div class="note">» ${esc(i.note)}</div>` : ''}</td></tr>`).join('')}
    </table>
    ${order.note ? `<div class="order-note">${esc(order.note)}</div>` : ''}
    <hr>
    <div class="row"><span>Σύνολο</span><span>${eur(order.total)}</span></div>
    <div class="disclaimer">Εσωτερικό δελτίο. Δεν αποτελεί φορολογικό στοιχείο.</div>
  </div>`;
}

// Bill. `t` translates labels (guest copy) – defaults to Greek for the staff printout.
export function receiptSlip(receipt, restaurant, { lang = 'el', t = (k, el) => el } = {}) {
  const locale = { el: 'el-GR', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', it: 'it-IT', es: 'es-ES', nl: 'nl-NL', pl: 'pl-PL' }[lang] || 'el-GR';
  const spot = lang === 'el' ? KIND_EL[receipt.tableKind] || 'Τραπέζι' : t(receipt.tableKind, KIND_EL[receipt.tableKind]);
  return `<div class="slip">
    ${header(restaurant, { withLegal: true })}
    <div class="c title">${esc(t('receipt', 'Απόδειξη λογαριασμού'))}</div>
    <div class="c meta">Νο ${esc(receipt.number)}</div>
    <div class="c meta">${esc(t('date', 'Ημερομηνία'))}: ${when(receipt.createdAt, locale)} · ${esc(spot)} ${esc(receipt.tableLabel)}</div>
    <hr>
    <table>
      ${receipt.lines.map((l) => `<tr><td class="q">${l.qty}×</td><td>${esc(nameIn(l.name, lang))}
        ${(l.options || []).map((o) => `<div class="opt">+ ${esc(nameIn(o.choice, lang))}</div>`).join('')}</td>
        <td class="p">${eur(l.total_cents)}</td></tr>`).join('')}
    </table>
    <hr>
    <div class="total"><span>${esc(t('total', 'Σύνολο'))}</span><span>${eur(receipt.total)}</span></div>
    ${receipt.tip ? `<div class="row"><span>${esc(t('tip', 'Φιλοδώρημα'))}</span><span>${eur(receipt.tip)}</span></div>` : ''}
    <div class="row" style="margin-top:1.5mm"><span>${esc(t('payment', 'Πληρωμή'))}</span><span>${esc(t(`pay_${receipt.payment}`, { cash: 'Μετρητά', card: 'Κάρτα', online: 'Online', room: 'Χρέωση δωματίου' }[receipt.payment]))}</span></div>
    ${receipt.fiscalRef ? `<div class="row"><span>${esc(t('fiscalRef', 'Αρ. νόμιμης απόδειξης'))}</span><span>${esc(receipt.fiscalRef)}</span></div>` : ''}
    ${restaurant.receiptFooter ? `<div class="foot">${esc(restaurant.receiptFooter)}</div>` : ''}
    <div class="foot">${esc(t('thankYou', 'Ευχαριστούμε για την επίσκεψη!'))}</div>
    <div class="disclaimer">${esc(t('notFiscal', 'Δεν αποτελεί φορολογικό στοιχείο. Η νόμιμη απόδειξη εκδίδεται από το ταμείο.'))}</div>
  </div>`;
}
