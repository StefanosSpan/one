// English staff screens for venues in the United States: every Greek phrase of the screens and of the server's
// messages has an English entry, and the translation never half-translates the owner's own texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keysOf, translate, GREEK } from '../public/js/lang-core.js';
import { EN } from '../public/js/en.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Screens that venues in the United States see, and the server messages they show.
const FILES = ['public/js/admin.js', 'public/js/waiter.js', 'public/js/kitchen.js', 'public/js/staff.js', 'public/js/slips.js', 'public/js/theme.js',
  'public/staff/login.html', 'public/staff/qr.html', 'public/staff/print.html', 'public/staff/waiter.html', 'public/staff/kitchen.html',
  'public/staff/admin.html', 'server/index.js', 'server/plans.js'];

test('every Greek phrase of the staff screens has an English translation', () => {
  const missing = new Set();
  for (const f of FILES) {
    const src = readFileSync(join(ROOT, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const chunk of src.split(/\$\{|[`'"<>{}]/)) {
      if (!GREEK.test(chunk)) continue;
      // Texts of the e-mails and the console (with line breaks) never reach the screens.
      for (const k of keysOf(chunk)) if (!k.includes('\\n') && EN[k] === undefined) missing.add(`${k}  (${f})`);
    }
  }
  assert.deepEqual([...missing], [], `Add these phrases to public/js/en.js:\n${[...missing].join('\n')}`);
});

test('translation: whole texts, composed texts, numbers and punctuation', () => {
  const t = (s) => translate(s, EN);
  assert.equal(t('Νέα παραγγελία'), 'New order');
  assert.equal(t('  Εκτύπωση  '), '  Print  ');
  assert.equal(t('Τραπέζι 5: έκλεισε · Απόδειξη 2026-00012'), 'Table 5: closed · Check 2026-00012');
  assert.equal(t('3 πιάτα'), '3 dishes');
  assert.equal(t('1ω 5′'), '1h 5′');
  assert.equal(t('Ζητά λογαριασμό · Κάρτα'), 'Asks for the check · Card');
  // The Greek semicolon and quotation marks become English ones.
  assert.equal(t('Στείλτε αυτόν τον σύνδεσμο στους σερβιτόρους και στην κουζίνα. Ανοίγει από κινητό, tablet ή υπολογιστή· συνδέονται με το PIN τους.'),
    'Send this link to your servers and kitchen. It opens on a phone, tablet or computer; sign in with their PIN.');
  assert.equal(t('Ό,τι απενεργοποιήσετε εμφανίζεται αμέσως ως «Εξαντλήθηκε» στους πελάτες.'), 'Whatever you switch off shows right away as “Sold out” to guests.');
  // Texts without Greek letters stay as they are.
  assert.equal(t('Greek salad · $17.00'), 'Greek salad · $17.00');
});

test('the owner\'s own Greek texts are left whole, never half translated', () => {
  const missing = [];
  const out = translate('Κρέμα από κίτρινα φασόλια με κάπαρη', EN, (w) => missing.push(w));
  assert.equal(out, 'Κρέμα από κίτρινα φασόλια με κάπαρη');
  assert.equal(missing.length, 1);
});
