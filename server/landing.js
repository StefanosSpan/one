// Pages for what restaurants search for ("qr menu", "ψηφιακό μενού", "παραγγελιοληψία", "table ordering system"…):
// one page per search, with its own title, text, questions and links to the others. They are built here with the
// header and footer of the website, so a new page is a new entry in LANDING. Pages with the same id are the same
// page in the other language (linked with hreflang).

// The date the texts last changed, for <lastmod> in the sitemap.
export const LANDING_UPDATED = '2026-10-12';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Words of the page frame in each language.
const UI = {
  gr: {
    lang: 'el', home: 'Αρχική', features: 'Δυνατότητες', pricing: 'Τιμές', login: 'Σύνδεση', trial: 'Δοκιμή δωρεάν',
    start: 'Ξεκινήστε δωρεάν', demo: 'Δείτε το demo', trust: ['14 ημέρες δωρεάν', 'Χωρίς κάρτα', 'Χωρίς εγκατάσταση'],
    price: '€14,90', perMonth: '/μήνα', priceTitle: 'Πόσο κοστίζει',
    priceText: 'Όλες οι δυνατότητες για έως 50 θέσεις με QR, χωρίς προμήθεια στις παραγγελίες. Για μεγαλύτερα καταστήματα και ξενοδοχεία, το Plus με €29,90/μήνα. Με ετήσια πληρωμή οι 2 μήνες είναι δωρεάν. Οι τιμές δεν περιλαμβάνουν ΦΠΑ.',
    seePrices: 'Όλες οι τιμές', faq: 'Συχνές ερωτήσεις', related: 'Δείτε επίσης',
    ctaTitle: 'Δοκιμάστε το δωρεάν για 14 ημέρες', ctaText: 'Χωρίς κάρτα, χωρίς εγκατάσταση, χωρίς δέσμευση. Αν θέλετε, περνάμε εμείς το μενού σας.',
    create: 'Δημιουργία λογαριασμού', tryDemo: 'Δοκιμάστε το demo',
    tag: 'Ψηφιακό μενού, παραγγελία και πληρωμή από το τραπέζι, για την ελληνική εστίαση.',
    product: 'Προϊόν', solutions: 'Λύσεις', legal: 'Νομικά', how: 'Πώς δουλεύει', vat: 'ΑΦΜ', gemi: 'ΓΕΜΗ',
    terms: 'Όροι χρήσης', privacy: 'Απόρρητο', cookies: 'Cookies', cookieSettings: 'Ρυθμίσεις cookies',
    other: ['https://kalimenu.com', 'en', 'English'],
  },
  us: {
    lang: 'en', home: 'Home', features: 'Features', pricing: 'Pricing', login: 'Sign in', trial: 'Start free',
    start: 'Start free', demo: 'See the demo', trust: ['14-day free trial', 'No credit card', 'Nothing to install'],
    price: '$29', perMonth: '/month', priceTitle: 'What it costs',
    priceText: 'Every feature for up to 50 QR spots, with no commission on orders. For larger venues and hotels, Plus at $59/month. Pay yearly and get 2 months free.',
    seePrices: 'See pricing', faq: 'Frequently asked questions', related: 'Read more',
    ctaTitle: 'Try it free for 14 days', ctaText: 'No credit card, nothing to install, no contract. We can set up your menu for you.',
    create: 'Create your account', tryDemo: 'Try the demo',
    tag: 'QR menus, ordering and payments at the table, for restaurants, bars and hotels.',
    product: 'Product', solutions: 'Solutions', legal: 'Legal', how: 'How it works',
    terms: 'Terms', privacy: 'Privacy', cookies: 'Cookies', cookieSettings: 'Your privacy choices',
    other: ['https://kalimenu.gr', 'el', 'Ελληνικά'],
  },
};

// Screenshots of the app: the shared copies, else the ones shipped with the site.
const SHIPPED = ['menu', 'menu-aegean', 'menu-cream', 'menu-lounge', 'pay', 'waiter', 'kitchen'];
const SIZE = { kitchen: [1600, 685], pay: [390, 745] };
function shot(market, key, alt, lazy = true) {
  const local = `/img/shot-${SHIPPED.includes(key) ? key : 'menu'}.jpg`;
  const sources = market === 'us' ? [`/assets/app2-us-${key}.jpg`, `/assets/app2-${key}.jpg`, local] : [`/assets/app2-${key}.jpg`, local];
  const [w, h] = SIZE[key] || [390, 844];
  return `<img src="${sources[0]}" data-fb="${sources.slice(1).join(',')}" onerror="fb(this)" alt="${esc(alt)}" width="${w}" height="${h}"${lazy ? ' loading="lazy"' : ''}>`;
}
const frame = (market, s, lazy) => {
  if (s.kind === 'trio') return `<div class="trio">${s.keys.map(([k, alt]) => `<div class="phone">${shot(market, k, alt, lazy)}</div>`).join('')}</div>`;
  return s.kind === 'tablet' ? `<div class="tablet">${shot(market, s.key, s.alt, lazy)}</div>` : `<div class="phone">${shot(market, s.key, s.alt, lazy)}</div>`;
};

export const LANDING = {
  gr: [
    {
      id: 'qr', path: '/qr-menu', name: 'QR menu',
      blurb: 'Το μενού στο κινητό του πελάτη με ένα σκανάρισμα, με παραγγελία και κλήση σερβιτόρου.',
      title: 'QR menu για εστιατόρια, καφέ και μπαρ | Kalimenu',
      description: 'QR menu με παραγγελία από το τραπέζι, σε 8 γλώσσες. Ο πελάτης σκανάρει το QR code και βλέπει το μενού στο κινητό, χωρίς εφαρμογή. €14,90/μήνα, 14 ημέρες δωρεάν.',
      eyebrow: 'QR menu', h1: 'QR menu για το κατάστημά σας, <em>με παραγγελία από το τραπέζι</em>',
      lead: 'Ο πελάτης σκανάρει το QR code στο τραπέζι και το μενού ανοίγει στο κινητό του, στη γλώσσα του, χωρίς εφαρμογή. Από εκεί παραγγέλνει, καλεί τον σερβιτόρο και πληρώνει.',
      hero: { key: 'menu', alt: 'QR menu ταβέρνας ανοιχτό σε κινητό' },
      sections: [
        { h2: 'Τι είναι το QR menu',
          p: ['Το QR menu, ή μενού με QR code, είναι το μενού του καταστήματος σε ψηφιακή μορφή. Ανοίγει όταν ο πελάτης σκανάρει με την κάμερα του κινητού έναν κωδικό QR, χωρίς να κατεβάσει εφαρμογή και χωρίς να συνδεθεί κάπου: η σελίδα ανοίγει αμέσως στον browser.',
            'Στο Kalimenu κάθε τραπέζι, δωμάτιο ή ξαπλώστρα έχει το δικό του QR. Έτσι, όταν ο πελάτης παραγγέλνει ή καλεί τον σερβιτόρο, ξέρετε αμέσως από πού.'] },
        { h2: 'Περισσότερα από ένα μενού σε PDF', shot: { key: 'dish', alt: 'Πιάτο με φωτογραφία, επιλογές και αλλεργιογόνα στο QR menu' },
          p: ['Ένα PDF στο κινητό διαβάζεται δύσκολα και δεν κάνει τίποτα άλλο. Το QR menu του Kalimenu είναι φτιαγμένο για κινητό και δουλεύει για το κατάστημα:'],
          ticks: ['Μενού σε 8 γλώσσες, που ανοίγει αυτόματα στη γλώσσα του κινητού',
            'Φωτογραφίες, περιγραφές, αλλεργιογόνα και ετικέτες όπως «Vegan», «Πικάντικο» ή «Κατεψυγμένο»',
            'Παραγγελία από το τραπέζι, με επιλογές και σημειώσεις ανά πιάτο',
            'Κλήση σερβιτόρου και λογαριασμός με ένα πάτημα',
            'Πληρωμή από το κινητό με κάρτα, Apple Pay ή Google Pay, μέσω του Viva Wallet σας',
            'Αρχική οθόνη με Wi-Fi, κριτική, παραλαβή σε πακέτο και τα social σας'] },
        { h2: 'Αλλάζετε τιμές χωρίς να ξανατυπώσετε', shot: { kind: 'trio', keys: [['menu-aegean', 'QR menu με το θέμα Αιγαίο'], ['menu-cream', 'QR menu με το θέμα Κρεμ ταβέρνα'], ['menu-lounge', 'QR menu με σκούρο θέμα']] },
          p: ['Οι αλλαγές σε πιάτα, τιμές και διαθεσιμότητα φαίνονται αμέσως στα κινητά των πελατών. Τα QR μένουν τα ίδια, οπότε τα τυπώνετε μία φορά, σε αυτοκόλλητο, κάρτα ή επιτραπέζια πινακίδα, με το λογότυπό σας.',
            'Αν ένα πιάτο τελειώσει, το κρύβετε με ένα πάτημα ή ορίζετε μερίδες και «τελειώνει» μόνο του. Το μενού παίρνει τα χρώματα, τη γραμματοσειρά και το λογότυπο του καταστήματος.'] },
        { h2: 'Ένας σύνδεσμος και για το Instagram και το Google',
          p: ['Εκτός από τα QR των τραπεζιών, κάθε κατάστημα έχει έναν δημόσιο σύνδεσμο μενού. Τον βάζετε στο προφίλ σας στο Google Maps, στο Instagram και στη βιτρίνα, και αν θέλετε, οι πελάτες παραγγέλνουν από εκεί για παραλαβή σε πακέτο.'] },
      ],
      steps: [['Φτιάχνετε λογαριασμό', 'Με το e-mail σας, σε ένα λεπτό. Ξεκινάτε με έτοιμο δείγμα μενού και αλλάζετε πιάτα και τιμές.'],
        ['Τυπώνετε τα QR', 'Ένα για κάθε τραπέζι, σε σελίδα Α4 ή σε κάρτες, με το λογότυπό σας.'],
        ['Οι πελάτες σκανάρουν', 'Βλέπουν το μενού, παραγγέλνουν και καλούν τον σερβιτόρο από το κινητό.']],
      faq: [
        ['Πώς φτιάχνω QR code για το μενού μου;', 'Με την εγγραφή στο Kalimenu δημιουργούνται αυτόματα QR για κάθε τραπέζι. Από τη Διαχείριση τα τυπώνετε σε σελίδα Α4 ή σε κάρτες, με το λογότυπο του καταστήματος και το όνομα του τραπεζιού. Υπάρχει και ένα γενικό QR για τη βιτρίνα και το ταμείο.'],
        ['Υπάρχει δωρεάν QR menu;', 'Υπάρχουν δωρεάν γεννήτριες QR που ανοίγουν ένα PDF, αλλά δεν δέχονται παραγγελίες, δεν αλλάζουν γλώσσα και κάθε αλλαγή τιμής θέλει νέο αρχείο. Το Kalimenu το δοκιμάζετε δωρεάν για 14 ημέρες με όλες τις δυνατότητες, χωρίς κάρτα, και μετά κοστίζει €14,90 τον μήνα.'],
        ['Πόσο κοστίζει ένα QR menu;', 'Το Kalimenu κοστίζει €14,90 τον μήνα ανά κατάστημα για έως 50 θέσεις με QR, και €29,90 τον μήνα χωρίς όριο θέσεων. Δεν υπάρχει προμήθεια στις παραγγελίες ούτε συμβόλαιο. Τους μήνες που είστε κλειστοί παγώνετε τη συνδρομή χωρίς χρέωση.'],
        ['Χρειάζεται ο πελάτης να κατεβάσει εφαρμογή;', 'Όχι. Σκανάρει το QR με την κάμερα του κινητού και το μενού ανοίγει στον browser, σε iPhone και Android.'],
        ['Μπορώ να έχω άλλο μενού το πρωί και άλλο το βράδυ;', 'Ναι. Κατηγορίες όπως το πρωινό ή το happy hour εμφανίζονται μόνο τις ώρες που ορίζετε, και κάθε χώρος (σάλα, μπαρ, παραλία) μπορεί να έχει το δικό του μενού.'],
      ],
    },
    {
      id: 'digital', path: '/psifiako-menou', name: 'Ψηφιακό μενού',
      blurb: 'Ηλεκτρονικός κατάλογος με φωτογραφίες και αλλεργιογόνα, στα χρώματα του καταστήματος.',
      title: 'Ψηφιακό μενού εστιατορίου σε 8 γλώσσες | Kalimenu',
      description: 'Ψηφιακό μενού και ηλεκτρονικός κατάλογος για εστιατόρια, ταβέρνες και καφέ: φωτογραφίες, αλλεργιογόνα, 8 γλώσσες και η δική σας εμφάνιση. 14 ημέρες δωρεάν.',
      eyebrow: 'Ψηφιακό μενού', h1: 'Ψηφιακό μενού εστιατορίου <em>που μοιάζει με το κατάστημά σας</em>',
      lead: 'Ένας ηλεκτρονικός κατάλογος με φωτογραφίες, περιγραφές και αλλεργιογόνα, στα χρώματα και με το λογότυπό σας. Ανοίγει από QR στο τραπέζι ή από σύνδεσμο στο Instagram και στο Google.',
      hero: { key: 'menu-cream', alt: 'Ψηφιακό μενού ταβέρνας σε κινητό' },
      sections: [
        { h2: 'Ψηφιακός κατάλογος αντί για χάρτινο μενού',
          p: ['Ένα χάρτινο μενού θέλει ανατύπωση σε κάθε αλλαγή τιμής, φθείρεται και συνήθως έχει μία ή δύο γλώσσες. Το ψηφιακό μενού αλλάζει από τη Διαχείριση σε δευτερόλεπτα και ο πελάτης βλέπει πάντα τις σωστές τιμές και μόνο τα πιάτα που υπάρχουν.'],
          table: { head: ['', 'Χάρτινο ή PDF', 'Ψηφιακό μενού Kalimenu'], rows: [
            ['Αλλαγή τιμής', 'Νέα εκτύπωση ή νέο αρχείο', 'Αμέσως, από το κινητό σας'],
            ['Γλώσσες', 'Συνήθως 1–2', '8, αυτόματα στη γλώσσα του πελάτη'],
            ['Ανάγνωση στο κινητό', 'Μεγέθυνση με τα δάχτυλα', 'Φτιαγμένο για κινητό'],
            ['Παραγγελία και κλήση σερβιτόρου', 'Όχι', 'Ναι'],
            ['Πιάτα που τελείωσαν', 'Ο σερβιτόρος το λέει', 'Κρύβονται μόνα τους'],
          ] } },
        { h2: 'Σχεδιασμός μενού χωρίς γραφίστα', shot: { kind: 'trio', keys: [['menu-aegean', 'Ψηφιακό μενού με το θέμα Αιγαίο'], ['menu-cream', 'Ψηφιακό μενού με το θέμα Κρεμ ταβέρνα'], ['menu-lounge', 'Ψηφιακό μενού με το θέμα Σκούρο lounge']] },
          p: ['Σχεδιάζετε την εμφάνιση από τη Διαχείριση και βλέπετε κάθε αλλαγή αμέσως στην προεπισκόπηση.'],
          ticks: ['Λογότυπο και φωτογραφία εξωφύλλου', 'Χρώματα για φόντο, κείμενο, κατηγορίες και κουμπιά, πάντα ευανάγνωστα',
            'Πέντε γραμματοσειρές με σωστά ελληνικά', 'Έτοιμα θέματα όπως «Κρεμ ταβέρνα», «Αιγαίο» και «Σκούρο lounge»'] },
        { h2: 'Όσα πρέπει να γράφει ένα μενού',
          p: ['Κάθε πιάτο έχει τιμή, περιγραφή, φωτογραφία και τα 14 αλλεργιογόνα της ΕΕ, με ετικέτες όπως «Χορτοφαγικό», «Χωρίς γλουτένη» και «Κατεψυγμένο».',
            'Στην Ελλάδα το μενού δείχνει αυτόματα ότι οι τιμές περιλαμβάνουν όλους τους φόρους, ότι ο πελάτης δεν υποχρεούται να πληρώσει αν δεν λάβει νόμιμη απόδειξη, και τον αγορανομικό υπεύθυνο που ορίζετε.'] },
        { h2: 'Ένα μενού για κάθε χώρο και κάθε ώρα', cards: [
          ['clock', 'Ωράρια και happy hour', 'Πρωινό, μενού μπαρ ή room service που εμφανίζονται μόνα τους την ώρα τους.'],
          ['alert', 'Πιάτο ημέρας', 'Ανακοίνωση στην κορυφή του μενού, με φωτογραφία.'],
          ['grid', 'Μενού ανά χώρο', 'Άλλο μενού στη σάλα, άλλο στο μπαρ και άλλο στην παραλία.'],
          ['plus', 'Προτάσεις στο καλάθι', '«Θα σας άρεσε και…»: ποτά και γλυκά με ένα πάτημα.'],
        ] },
      ],
      faq: [
        ['Πόσο κοστίζει ένα ψηφιακό μενού;', 'Το Kalimenu κοστίζει €14,90 τον μήνα ανά κατάστημα (έως 50 θέσεις με QR) και περιλαμβάνει, εκτός από το ψηφιακό μενού, παραγγελία από το τραπέζι, κλήση σερβιτόρου και οθόνες για κουζίνα και μπαρ. Δοκιμάζεται δωρεάν για 14 ημέρες.'],
        ['Μπορώ να περάσω το μενού μόνος μου;', 'Ναι, από τον υπολογιστή ή το κινητό, κατηγορία-κατηγορία. Αν προτιμάτε, με το στήσιμο από εμάς (€49 εφάπαξ) περνάμε εμείς μενού, μεταφράσεις και φωτογραφίες.'],
        ['Μπορώ να βάλω φωτογραφίες στα πιάτα;', 'Ναι. Ανεβάζετε μια φωτογραφία από το κινητό για κάθε πιάτο και εμφανίζεται στη λίστα και στη σελίδα του πιάτου.'],
        ['Θα βρίσκουν οι πελάτες το μενού μου στο Google;', 'Κάθε κατάστημα έχει δημόσιο σύνδεσμο μενού με τίτλο, περιγραφή και δομημένα δεδομένα εστιατορίου. Βάλτε τον στο προφίλ σας στο Google Maps ως σύνδεσμο μενού και στο Instagram.'],
      ],
    },
    {
      id: 'ordering', path: '/paraggelioliptia', name: 'Παραγγελιοληψία',
      blurb: 'Παραγγελίες από το κινητό του πελάτη ή του σερβιτόρου, κατευθείαν σε κουζίνα και μπαρ.',
      title: 'Ασύρματη παραγγελιοληψία από το κινητό | Kalimenu',
      description: 'Σύστημα παραγγελιοληψίας για εστίαση χωρίς PDA: ο πελάτης παραγγέλνει από το QR, ο σερβιτόρος από το κινητό, κουζίνα και μπαρ βλέπουν ή τυπώνουν. €14,90/μήνα.',
      eyebrow: 'Παραγγελιοληψία', h1: 'Ασύρματη παραγγελιοληψία <em>χωρίς PDA και ακριβό εξοπλισμό</em>',
      lead: 'Οι παραγγελίες φτάνουν στην κουζίνα και στο μπαρ τη στιγμή που γίνονται, από το κινητό του πελάτη μέσω QR ή από το κινητό του σερβιτόρου. Δουλεύει σε όποιο κινητό, tablet ή υπολογιστή έχετε ήδη.',
      hero: { key: 'waiter', alt: 'Οθόνη σερβιτόρου με παραγγελίες και κλήσεις ανά τραπέζι' },
      sections: [
        { h2: 'Πώς δουλεύει η παραγγελιοληψία', steps: [
          ['Η παραγγελία ξεκινά από το τραπέζι', 'Ο πελάτης παραγγέλνει από το QR menu, ή ο σερβιτόρος την περνά από το κινητό του.'],
          ['Ο σερβιτόρος την εγκρίνει', 'Όσες στέλνουν οι πελάτες περνούν από τον σερβιτόρο με ένα πάτημα, ώστε τίποτα να μη φτάνει στην κουζίνα χωρίς έλεγχο.'],
          ['Κουζίνα και μπαρ την ετοιμάζουν', 'Κάθε πόστο βλέπει μόνο τα δικά του, με χρονόμετρο, και ειδοποιεί όταν είναι έτοιμη.']] },
        { h2: 'Παραγγελιοληψία με κινητό ή tablet', shot: { kind: 'tablet', key: 'kitchen', alt: 'Οθόνη κουζίνας με παραγγελίες σε tablet' },
          p: ['Δεν χρειάζεστε PDA ή ειδικά τερματικά. Κάθε σερβιτόρος μπαίνει από το κινητό του με έναν σύνδεσμο και το δικό του PIN και βλέπει πρώτα τα τραπέζια της ζώνης του.',
            'Η κουζίνα και το μπαρ δουλεύουν σε οποιοδήποτε tablet ή υπολογιστή, και αν έχετε θερμικό εκτυπωτή 80 mm, τυπώνουν και δελτία παραγγελίας.'] },
        { h2: 'Λιγότερα λάθη, πιο γρήγορο σέρβις', cards: [
          ['check', 'Χωρίς παρεξηγήσεις', 'Η παραγγελία γράφεται όπως τη θέλει ο πελάτης, με επιλογές όπως «ψήσιμο» και σημειώσεις ανά πιάτο.'],
          ['flame', 'Κάθε πόστο τα δικά του', 'Τα ποτά στο μπαρ, τα φαγητά στην κουζίνα, χωρίς χαρτάκια που χάνονται.'],
          ['clock', 'Χρόνος αναμονής', 'Ο πελάτης βλέπει πότε θα είναι έτοιμο το φαγητό του και ρωτά λιγότερο.'],
          ['chart', 'Στατιστικά', 'Τζίρος, πιάτα που πουλάνε, γλώσσες πελατών και εξαγωγή σε Excel.'],
        ] },
        { h2: 'Ασύρματη κλήση σερβιτόρου, στο ίδιο σύστημα',
          p: ['Ο πελάτης πατά «Σερβιτόρος» ή «Λογαριασμός» στο κινητό του και ο σερβιτόρος της ζώνης το βλέπει αμέσως με ήχο, μαζί με το τραπέζι και τον τρόπο που θέλει να πληρώσει. <a href="/klisi-servitorou">Περισσότερα για την κλήση σερβιτόρου</a>.'] },
        { h2: 'Ταμειακή και myDATA',
          p: ['Το Kalimenu δεν είναι ταμειακό σύστημα και δεν εκδίδει νόμιμες αποδείξεις. Ο σερβιτόρος καταχωρεί την παραγγελία στην ταμειακή σας όπως κάνει σήμερα, και στην απόδειξη λογαριασμού του Kalimenu μπορείτε να σημειώνετε τον αριθμό ή το ΜΑΡΚ της νόμιμης απόδειξης.'] },
      ],
      faq: [
        ['Τι χρειάζομαι για ασύρματη παραγγελιοληψία;', 'Ίντερνετ στο κατάστημα, τα κινητά των σερβιτόρων και ένα tablet ή υπολογιστή για την κουζίνα. Προαιρετικά, έναν θερμικό εκτυπωτή 80 mm για δελτία. Δεν χρειάζεται εγκατάσταση.'],
        ['Πόσο κοστίζει;', '€14,90 τον μήνα ανά κατάστημα για έως 50 θέσεις, χωρίς χρέωση ανά σερβιτόρο ή ανά συσκευή και χωρίς προμήθεια στις παραγγελίες. Για περισσότερες θέσεις, €29,90 τον μήνα.'],
        ['Μπορούν οι σερβιτόροι να παίρνουν παραγγελία για πελάτες που δεν θέλουν QR;', 'Ναι. Ο σερβιτόρος ανοίγει το τραπέζι στο κινητό του, διαλέγει πιάτα και τη στέλνει στην κουζίνα, όπως με ένα PDA.'],
        ['Συνδέεται με την ταμειακή και το myDATA;', 'Όχι απευθείας. Η παραγγελία καταχωρείται στην ταμειακή σας από τον σερβιτόρο, όπως σήμερα, και η νόμιμη απόδειξη εκδίδεται από εκεί.'],
        ['Πόσοι σερβιτόροι μπορούν να δουλεύουν;', 'Όσοι χρειάζεστε. Κάθε σερβιτόρος έχει δικό του PIN και ζώνη τραπεζιών.'],
      ],
    },
    {
      id: 'call', path: '/klisi-servitorou', name: 'Κλήση σερβιτόρου',
      blurb: 'Ο πελάτης καλεί τον σερβιτόρο ή ζητά λογαριασμό από το κινητό, χωρίς κουδουνάκια.',
      title: 'Κλήση σερβιτόρου από το κινητό με QR | Kalimenu',
      description: 'Ασύρματη κλήση σερβιτόρου χωρίς κουδουνάκια και εξοπλισμό: ο πελάτης πατά «Σερβιτόρος» ή «Λογαριασμός» στο QR menu και ο σερβιτόρος το βλέπει αμέσως στο κινητό.',
      eyebrow: 'Κλήση σερβιτόρου', h1: 'Κλήση σερβιτόρου <em>με ένα πάτημα από το τραπέζι</em>',
      lead: 'Ο πελάτης δεν χρειάζεται να σηκώνει το χέρι. Πατά «Σερβιτόρος» ή «Λογαριασμός» στο μενού του κινητού και ο σερβιτόρος της ζώνης βλέπει αμέσως ποιο τραπέζι τον θέλει.',
      hero: { key: 'waiter', alt: 'Κλήσεις πελατών στην οθόνη σερβιτόρου' },
      sections: [
        { h2: 'Χωρίς ασύρματα κουδουνάκια',
          p: ['Τα ασύρματα συστήματα κλήσης σερβιτόρου θέλουν κουμπί σε κάθε τραπέζι, μπαταρίες και ρολόι ή οθόνη για το προσωπικό. Με το Kalimenu η κλήση γίνεται από το QR που υπάρχει ήδη στο τραπέζι και φτάνει στα κινητά των σερβιτόρων. Δεν αγοράζετε τίποτα.'] },
        { h2: 'Ο σωστός σερβιτόρος, την ώρα που χρειάζεται', shot: { key: 'waiter', alt: 'Οθόνη σερβιτόρου με κλήσεις ανά τραπέζι' },
          ticks: ['Η κλήση φτάνει με ήχο στην οθόνη σερβιτόρου, με το όνομα του τραπεζιού',
            'Κάθε σερβιτόρος βλέπει πρώτα τη ζώνη του, ώστε να μην τρέχουν όλοι στο ίδιο τραπέζι',
            'Ο πελάτης βλέπει ότι η κλήση του ελήφθη και δεν ξαναφωνάζει',
            'Ο λογαριασμός ζητιέται μαζί με τον τρόπο πληρωμής: μετρητά ή κάρτα'] },
        { h2: 'Από την κλήση στην πληρωμή', shot: { key: 'pay', alt: 'Πληρωμή λογαριασμού από το κινητό με διαχωρισμό' },
          p: ['Αν το θέλετε, ο πελάτης πληρώνει μόνος του από το κινητό με κάρτα, Apple Pay ή Google Pay, όλον τον λογαριασμό, μόνο τα δικά του πιάτα ή ίσα μερίδια, με φιλοδώρημα. Τα χρήματα πάνε κατευθείαν στον λογαριασμό Viva Wallet σας.'] },
        { h2: 'Για ξενοδοχεία, παραλίες και μεγάλες σάλες',
          p: ['Η κλήση σερβιτόρου είναι πιο χρήσιμη εκεί που ο πελάτης δεν φαίνεται εύκολα: σε ξαπλώστρες, σε αυλές, στην πισίνα. Κάθε θέση έχει το δικό της QR, οπότε ο σερβιτόρος ξέρει ακριβώς πού να πάει. Δείτε και τις σελίδες για <a href="/beach-bar">beach bar</a> και <a href="/xenodoxeia">ξενοδοχεία</a>.'] },
      ],
      faq: [
        ['Χρειάζεται εξοπλισμός για την κλήση σερβιτόρου;', 'Όχι. Ο πελάτης χρησιμοποιεί το κινητό του και ο σερβιτόρος το δικό του. Αρκούν τα QR στα τραπέζια, που τυπώνετε από τη Διαχείριση.'],
        ['Πώς ειδοποιείται ο σερβιτόρος;', 'Στην οθόνη σερβιτόρου, που ανοίγει στο κινητό του, η κλήση εμφανίζεται με ήχο μαζί με το τραπέζι. Όταν την εξυπηρετήσει, την κλείνει με ένα πάτημα.'],
        ['Μπορεί ο πελάτης να ζητήσει τον λογαριασμό;', 'Ναι, με το κουμπί «Λογαριασμός», διαλέγοντας αν θα πληρώσει με μετρητά ή με κάρτα. Αν έχετε συνδέσει το Viva Wallet, μπορεί και να πληρώσει από το κινητό.'],
        ['Πόσο κοστίζει;', 'Η κλήση σερβιτόρου περιλαμβάνεται στο Kalimenu, μαζί με το ψηφιακό μενού και την παραγγελία από το τραπέζι, με €14,90 τον μήνα.'],
      ],
    },
    {
      id: 'translate', path: '/metafrasi-menou', name: 'Μενού σε 8 γλώσσες',
      blurb: 'Αγγλικά, γερμανικά, γαλλικά, ιταλικά και άλλες γλώσσες, αυτόματα για κάθε τουρίστα.',
      title: 'Μενού εστιατορίου στα αγγλικά και σε 8 γλώσσες | Kalimenu',
      description: 'Πολύγλωσσο μενού για τουρίστες: ελληνικά, αγγλικά, γερμανικά, γαλλικά, ιταλικά, ισπανικά, ολλανδικά, πολωνικά. Ανοίγει αυτόματα στη γλώσσα του κινητού.',
      eyebrow: 'Πολύγλωσσο μενού', h1: 'Το μενού σας σε 8 γλώσσες, <em>για κάθε τουρίστα</em>',
      lead: 'Ο επισκέπτης από τη Γερμανία βλέπει το μενού στα γερμανικά και ο Ιταλός στα ιταλικά, χωρίς να ρωτήσουν. Το μενού ανοίγει αυτόματα στη γλώσσα του κινητού και αλλάζει με ένα πάτημα.',
      hero: { key: 'menu-aegean', alt: 'Πολύγλωσσο μενού εστιατορίου σε κινητό' },
      sections: [
        { h2: 'Γιατί μενού σε πολλές γλώσσες',
          p: ['Ο τουρίστας που καταλαβαίνει τι είναι το «κοκορέτσι» ή η «φάβα» παραγγέλνει πιο εύκολα και δοκιμάζει περισσότερα. Ο σερβιτόρος εξηγεί λιγότερα και η παραγγελία βγαίνει πιο γρήγορα, ειδικά τον Αύγουστο με γεμάτη σάλα.',
            'Και επειδή ο πελάτης μπορεί να παραγγείλει από το κινητό στη γλώσσα του, δεν χρειάζεται σερβιτόρος που να μιλά γερμανικά ή πολωνικά.'] },
        { h2: 'Οι 8 γλώσσες του μενού', cards: [
          ['globe', 'Ελληνικά και αγγλικά', 'Για Έλληνες πελάτες και για όλους τους υπόλοιπους.'],
          ['globe', 'Γερμανικά και ολλανδικά', 'Για τους επισκέπτες από τη Γερμανία, την Αυστρία, την Ολλανδία και το Βέλγιο.'],
          ['globe', 'Γαλλικά, ιταλικά, ισπανικά', 'Για τις μεγάλες αγορές της Νότιας Ευρώπης.'],
          ['globe', 'Πολωνικά', 'Για μια από τις αγορές που μεγαλώνουν πιο γρήγορα στον ελληνικό τουρισμό.'],
        ] },
        { h2: 'Πώς γίνεται η μετάφραση του μενού', shot: { key: 'menu', alt: 'Μενού ταβέρνας στο κινητό του πελάτη' },
          p: ['Για κάθε πιάτο γράφετε όνομα και περιγραφή σε όσες γλώσσες θέλετε, στην ίδια φόρμα. Ξεκινάτε με έτοιμο δείγμα μενού όπου τα κλασικά ελληνικά πιάτα είναι ήδη μεταφρασμένα, και το προσαρμόζετε.',
            'Αν μια μετάφραση λείπει, ο πελάτης βλέπει το πιάτο στα αγγλικά ή στα ελληνικά, ώστε να μην εμφανίζεται ποτέ κενό. Αν δεν θέλετε να ασχοληθείτε, με το στήσιμο από εμάς (€49 εφάπαξ) περνάμε εμείς μενού και μεταφράσεις.'] },
        { h2: 'Όχι μόνο τα πιάτα',
          ticks: ['Κουμπιά, καλάθι, παραγγελία και πληρωμή στη γλώσσα του πελάτη', 'Τα 14 αλλεργιογόνα και οι ετικέτες μεταφρασμένα αυτόματα',
            'Οι υποχρεωτικές ενδείξεις του μενού σε κάθε γλώσσα', 'Η αρχική οθόνη με επιλογή γλώσσας, Wi-Fi και κριτική'] },
      ],
      faq: [
        ['Πόσο κοστίζει η μετάφραση του μενού;', 'Οι 8 γλώσσες περιλαμβάνονται στο Kalimenu (€14,90 τον μήνα). Τις μεταφράσεις των πιάτων τις γράφετε εσείς, ή τις περνάμε εμείς με το στήσιμο των €49 εφάπαξ.'],
        ['Ανοίγει μόνο του στη γλώσσα του πελάτη;', 'Ναι, στη γλώσσα του κινητού του, αν είναι μία από τις 8. Ο πελάτης μπορεί πάντα να αλλάξει γλώσσα από την αρχική οθόνη ή από το κουμπί γλώσσας.'],
        ['Μπορώ να διορθώσω μια μετάφραση;', 'Ναι, από τη Διαχείριση, όποτε θέλετε. Η αλλαγή φαίνεται αμέσως στα κινητά.'],
        ['Φτάνει ένα μενού στα αγγλικά;', 'Τα αγγλικά καλύπτουν τους περισσότερους, αλλά πολλοί επισκέπτες, ειδικά μεγαλύτερης ηλικίας από Γερμανία, Γαλλία και Ιταλία, διαβάζουν πιο άνετα στη γλώσσα τους και παραγγέλνουν περισσότερο.'],
      ],
    },
    {
      id: 'beach', path: '/beach-bar', name: 'Beach bar',
      blurb: 'QR σε κάθε ξαπλώστρα: παραγγελία, κλήση και πληρωμή χωρίς να σηκωθεί ο πελάτης.',
      title: 'Παραγγελία από την ξαπλώστρα για beach bar | Kalimenu',
      description: 'QR σε κάθε ξαπλώστρα: ο λουόμενος βλέπει το μενού, παραγγέλνει και πληρώνει από το κινητό. Ζώνες σερβιτόρων, μπαρ και κουζίνα χωριστά, πάγωμα συνδρομής τον χειμώνα.',
      eyebrow: 'Beach bar', h1: 'Beach bar με παραγγελία <em>από την ξαπλώστρα</em>',
      lead: 'Ένα QR σε κάθε ξαπλώστρα ή ομπρέλα. Ο λουόμενος βλέπει το μενού στη γλώσσα του, παραγγέλνει, καλεί τον σερβιτόρο και πληρώνει, χωρίς να σηκωθεί.',
      hero: { key: 'menu-aegean', alt: 'Μενού beach bar στο κινητό' },
      sections: [
        { h2: 'Ο σερβιτόρος ξέρει ακριβώς πού να πάει',
          p: ['Στην παραλία ο πελάτης δεν φαίνεται εύκολα και ο σερβιτόρος χάνει χρόνο ψάχνοντας. Κάθε ξαπλώστρα έχει το δικό της QR, οπότε κάθε παραγγελία και κάθε κλήση φτάνει με τον αριθμό της θέσης.'],
          ticks: ['Ζώνες ανά σερβιτόρο: ο καθένας βλέπει πρώτα τις δικές του ξαπλώστρες', 'Τα ποτά στο μπαρ, τα φαγητά στην κουζίνα, σε ξεχωριστές οθόνες',
            'Ο πελάτης βλέπει πότε θα είναι έτοιμη η παραγγελία του'] },
        { h2: 'Πληρωμή από την ξαπλώστρα', shot: { key: 'pay', alt: 'Πληρωμή από το κινητό με κάρτα και φιλοδώρημα' },
          p: ['Με το Viva Wallet σας ο πελάτης πληρώνει από το κινητό με κάρτα, Apple Pay ή Google Pay, με φιλοδώρημα αν θέλει. Η παρέα χωρίζει τον λογαριασμό χωρίς πηγαινέλα με το POS.'] },
        { h2: 'Για τον τουρίστα, στη γλώσσα του',
          p: ['Το μενού ανοίγει αυτόματα σε μία από τις 8 γλώσσες. Ο Γερμανός, ο Ιταλός και ο Πολωνός παραγγέλνουν χωρίς να χρειαστεί μετάφραση από τον σερβιτόρο. <a href="/metafrasi-menou">Δείτε πώς δουλεύουν οι γλώσσες</a>.'] },
        { h2: 'Πληρώνετε μόνο τη σεζόν', cards: [
          ['calendar', 'Πάγωμα τον χειμώνα', 'Παγώνετε τη συνδρομή τους μήνες που είστε κλειστοί, χωρίς χρέωση. Μενού και QR μένουν αποθηκευμένα.'],
          ['grid', 'Παραλία και εστιατόριο', 'Αν έχετε και εστιατόριο, κάθε χώρος έχει το δικό του μενού, από τον ίδιο λογαριασμό.'],
          ['clock', 'Ωράρια', 'Πρωινό, μεσημεριανό και κοκτέιλ το απόγευμα, που εμφανίζονται μόνα τους την ώρα τους.'],
          ['wifi', 'Wi-Fi με QR', 'Ο πελάτης συνδέεται στο Wi-Fi σας από την αρχική οθόνη του μενού.'],
        ] },
      ],
      faq: [
        ['Αντέχουν τα QR στον ήλιο και στο νερό;', 'Τυπώστε τα σε πλαστικοποιημένη κάρτα, αυτοκόλλητο βινυλίου ή πινακίδα plexiglass. Τα QR του Kalimenu δεν αλλάζουν όταν αλλάζετε το μενού, οπότε τα φτιάχνετε μία φορά.'],
        ['Πόσες ξαπλώστρες μπορώ να έχω;', 'Με το Kalimenu (€14,90/μήνα) έως 50 θέσεις με QR, τραπέζια και ξαπλώστρες μαζί. Με το Kalimenu Plus (€29,90/μήνα) χωρίς όριο.'],
        ['Τι γίνεται τον χειμώνα;', 'Παγώνετε τη συνδρομή χωρίς χρέωση και τη συνεχίζετε με ένα κλικ την επόμενη σεζόν.'],
        ['Χρειάζεται καλό ίντερνετ στην παραλία;', 'Οι πελάτες χρησιμοποιούν τα δεδομένα του κινητού τους. Το προσωπικό χρειάζεται σύνδεση στα κινητά και στις οθόνες μπαρ και κουζίνας.'],
      ],
    },
    {
      id: 'hotel', path: '/xenodoxeia', name: 'Ξενοδοχεία',
      blurb: 'Room service από το δωμάτιο, χρέωση στο δωμάτιο και μενού για πισίνα και εστιατόριο.',
      title: 'Ψηφιακό μενού και room service για ξενοδοχεία | Kalimenu',
      description: 'QR σε δωμάτια, πισίνα και παραλία: room service, χρέωση στο δωμάτιο, all-inclusive και μενού ανά χώρο και ώρα, σε 8 γλώσσες. Για ξενοδοχεία κάθε μεγέθους.',
      eyebrow: 'Ξενοδοχεία', h1: 'Room service και μενού για ξενοδοχεία, <em>σε 8 γλώσσες</em>',
      lead: 'Ένα QR σε κάθε δωμάτιο, ξαπλώστρα και τραπέζι. Ο επισκέπτης βλέπει το σωστό μενού για τον χώρο και την ώρα, παραγγέλνει στη γλώσσα του και χρεώνει στο δωμάτιο.',
      hero: { key: 'menu-lounge', alt: 'Μενού ξενοδοχείου σε κινητό' },
      sections: [
        { h2: 'Room service χωρίς τηλέφωνα', shot: { key: 'waiter', alt: 'Παραγγελίες room service στην οθόνη του προσωπικού' },
          p: ['Ο επισκέπτης σκανάρει το QR στο δωμάτιο και παραγγέλνει από το κινητό, στη γλώσσα του. Η παραγγελία φτάνει με τον αριθμό του δωματίου στο προσωπικό και στην κουζίνα, χωρίς τηλέφωνα και χωρίς λάθη στη μετάφραση.'] },
        { h2: 'Χρέωση στο δωμάτιο και all-inclusive', cards: [
          ['bed', 'Χρέωση στο δωμάτιο', 'Ο επισκέπτης επιλέγει να χρεωθεί η παραγγελία στο δωμάτιό του.'],
          ['gift', 'All-inclusive', 'Στις θέσεις all-inclusive τα πιάτα εμφανίζονται ως «Περιλαμβάνεται» και χρεώνονται μόνο όσα ορίζετε ως premium.'],
          ['card', 'Πληρωμή με κάρτα', 'Για εξωτερικούς πελάτες, πληρωμή από το κινητό μέσω Viva Wallet.'],
          ['users', 'Ζώνες προσωπικού', 'Room service, πισίνα και εστιατόριο, το καθένα με τους σερβιτόρους του.'],
        ] },
        { h2: 'Το σωστό μενού σε κάθε χώρο και ώρα',
          p: ['Πρωινό στο εστιατόριο, σνακ και κοκτέιλ στην πισίνα, room service το βράδυ. Κάθε χώρος έχει το δικό του μενού και οι κατηγορίες εμφανίζονται μόνες τους τις ώρες που ορίζετε. Αν έχετε περισσότερα σημεία, όπως εστιατόριο και beach bar, τα διαχειρίζεστε από τον ίδιο λογαριασμό.'] },
        { h2: 'Για ξενοδοχεία κάθε μεγέθους',
          p: ['Το Kalimenu Plus (€29,90 τον μήνα ανά κατάστημα) δεν έχει όριο στις θέσεις με QR, ώστε να καλύψετε όλα τα δωμάτια, τις ξαπλώστρες και τα τραπέζια, με προτεραιότητα στην υποστήριξη. Για μικρότερα καταλύματα, έως 50 θέσεις, αρκεί το Kalimenu με €14,90 τον μήνα.'] },
      ],
      faq: [
        ['Μπορεί ο επισκέπτης να χρεώσει την παραγγελία στο δωμάτιο;', 'Ναι. Ενεργοποιείτε τη χρέωση στο δωμάτιο και ο επισκέπτης την επιλέγει όταν ζητά τον λογαριασμό. Η εξόφληση γίνεται στη ρεσεψιόν όπως σήμερα.'],
        ['Συνδέεται με το PMS του ξενοδοχείου;', 'Όχι. Οι χρεώσεις στο δωμάτιο καταγράφονται στο Kalimenu με τον αριθμό του δωματίου και περνούν στο σύστημα του ξενοδοχείου από το προσωπικό.'],
        ['Υποστηρίζεται το all-inclusive;', 'Ναι. Ορίζετε ποια δωμάτια ή θέσεις είναι all-inclusive. Εκεί τα πιάτα εμφανίζονται ως «Περιλαμβάνεται» και χρεώνονται μόνο όσα έχετε ορίσει ως premium.'],
        ['Σε ποιες γλώσσες;', 'Ελληνικά, αγγλικά, γερμανικά, γαλλικά, ιταλικά, ισπανικά, ολλανδικά και πολωνικά, αυτόματα στη γλώσσα του κινητού.'],
      ],
    },
  ],
  us: [
    {
      id: 'qr', path: '/qr-code-menu', name: 'QR code menu',
      blurb: 'Your menu on every guest\'s phone with one scan, with ordering and server calls.',
      title: 'QR Code Menu for Restaurants, with Ordering | Kalimenu',
      description: 'A QR code menu in 8 languages: guests scan, read your menu on their phone, order from the table and call a server. No app needed. $29/month, 14-day free trial.',
      eyebrow: 'QR code menu', h1: 'A QR code menu <em>your guests can order from</em>',
      lead: 'Guests scan the QR code on the table and your menu opens on their phone, in their language, with no app to download. From there they order, call a server and ask for the check.',
      hero: { key: 'menu', alt: 'A restaurant QR code menu on a phone' },
      sections: [
        { h2: 'What is a QR code menu?',
          p: ['A QR code menu is your restaurant menu in digital form. It opens when a guest points their phone camera at a QR code: no app, no sign-up, the page opens straight in the browser.',
            'With Kalimenu every table, room or patio spot has its own QR code, so you always know where an order or a server call comes from.'] },
        { h2: 'More than a PDF menu', shot: { key: 'dish', alt: 'A dish with photo, options and allergens on the QR menu' },
          p: ['A PDF is hard to read on a phone and does nothing else. Kalimenu is built for phones and works for your restaurant:'],
          ticks: ['A menu in 8 languages that opens in the language of the guest\'s phone', 'Photos, descriptions, allergens and tags like "Vegan" or "Spicy"',
            'Ordering from the table, with options and notes per dish', 'Server calls and check requests with one tap', 'A welcome screen with Wi-Fi, reviews, pick-up and your socials'] },
        { h2: 'Change prices without reprinting', shot: { kind: 'trio', keys: [['menu-aegean', 'QR menu in the Aegean theme'], ['menu-cream', 'QR menu in the Cream theme'], ['menu-lounge', 'QR menu in a dark theme']] },
          p: ['Changes to dishes, prices and availability show up on guests\' phones right away. Your QR codes never change, so you print them once, on stickers, cards or table tents with your logo.',
            'Sold out? Hide a dish with one tap, or set a portion count and it sells out on its own. The menu takes your colors, font and logo.'] },
      ],
      steps: [['Create your account', 'With your email, in a minute. Start from a sample menu and change dishes and prices.'],
        ['Print your QR codes', 'One per table, on a sheet or on cards, with your logo.'],
        ['Guests scan and order', 'They read the menu, order and call a server from their phone.']],
      faq: [
        ['How do I make a QR code for my menu?', 'When you sign up, Kalimenu creates a QR code for each table. Print them from the admin on a sheet or as cards, with your logo and the table name. There is also a general menu link for your window, Instagram and Google Business Profile.'],
        ['Is there a free QR code menu?', 'Free QR generators can open a PDF, but they don\'t take orders, don\'t switch language and need a new file for every price change. Kalimenu is free for 14 days with every feature and no credit card, then $29/month.'],
        ['Do guests need to download an app?', 'No. They scan the code with their phone camera and the menu opens in the browser, on iPhone and Android.'],
        ['Can guests pay from their phone?', 'Not yet in the United States: it is coming soon. Today guests order and ask for the check from their phone, and you close the check on your POS as you do now.'],
      ],
    },
    {
      id: 'ordering', path: '/table-ordering', name: 'Table ordering',
      blurb: 'Guests order from their phone, servers approve, the kitchen and bar get their own tickets.',
      title: 'Table Ordering System for Restaurants and Bars | Kalimenu',
      description: 'Guests order from their phone at the table, servers approve with one tap, the kitchen and bar see their own tickets. No new hardware. $29/month, 14-day free trial.',
      eyebrow: 'Table ordering', h1: 'A table ordering system <em>without new hardware</em>',
      lead: 'Orders reach the kitchen and the bar the moment they are placed, from the guest\'s phone through a QR code or from a server\'s phone. It runs on the phones, tablets and computers you already have.',
      hero: { key: 'waiter', alt: 'The server screen with orders and calls per table' },
      sections: [
        { h2: 'How table ordering works', steps: [
          ['The order starts at the table', 'The guest orders from the QR menu, or a server enters it on their phone.'],
          ['A server approves it', 'Orders sent by guests pass by a server with one tap, so nothing reaches the kitchen unchecked.'],
          ['Kitchen and bar prepare it', 'Each station sees only its own items, with a timer, and marks the order ready.']] },
        { h2: 'Kitchen and bar screens on any tablet', shot: { kind: 'tablet', key: 'kitchen', alt: 'The kitchen display with orders on a tablet' },
          p: ['No handhelds or special terminals. Each server signs in on their own phone with a link and a PIN and sees their section first.',
            'The kitchen and the bar run on any tablet or computer, and with an 80 mm thermal printer they print tickets too.'] },
        { h2: 'Fewer mistakes, faster service', cards: [
          ['check', 'No mix-ups', 'Orders arrive the way guests want them, with options like "medium rare" and notes per dish.'],
          ['flame', 'Each station its own', 'Drinks to the bar, food to the kitchen, no lost paper tickets.'],
          ['clock', 'Wait times', 'Guests see when their food will be ready and ask less.'],
          ['chart', 'Reports', 'Sales, best sellers, guest languages and export to Excel.'],
        ] },
        { h2: 'Works next to your POS',
          p: ['Kalimenu is not a POS. Servers ring orders up on your POS as they do today, and you close checks there. Kalimenu takes care of the menu, the ordering and the calls from the table.'] },
      ],
      faq: [
        ['What do I need for table ordering?', 'Internet at the restaurant, your servers\' phones and a tablet or computer for the kitchen. An 80 mm thermal printer is optional. Nothing to install.'],
        ['How much does it cost?', '$29/month per location for up to 50 QR spots, with no fee per server or per device and no commission on orders. $59/month without a spot limit.'],
        ['Can servers take orders for guests who don\'t want to scan?', 'Yes. The server opens the table on their phone, picks the dishes and sends the order to the kitchen.'],
        ['Does it connect to my POS?', 'No. Orders are rung up on your POS by your staff, as today.'],
      ],
    },
    {
      id: 'translate', path: '/multilingual-menu', name: 'Menu in 8 languages',
      blurb: 'English, Spanish, French and more: the menu opens in each guest\'s language.',
      title: 'Multilingual Digital Menu in 8 Languages | Kalimenu',
      description: 'Your menu in English, Spanish, French, German, Italian, Greek, Dutch and Polish. It opens in the language of each guest\'s phone. $29/month, 14-day free trial.',
      eyebrow: 'Multilingual menu', h1: 'Your menu in 8 languages, <em>for every guest</em>',
      lead: 'A visitor from Paris reads your menu in French and a guest from Madrid in Spanish, without asking. The menu opens in the language of their phone and switches with one tap.',
      hero: { key: 'menu-aegean', alt: 'A multilingual restaurant menu on a phone' },
      sections: [
        { h2: 'Why a menu in more than one language',
          p: ['Guests who understand a dish order it with confidence and try more. Servers spend less time explaining, and orders come in faster on a busy night.'] },
        { h2: 'How translation works', shot: { key: 'menu', alt: 'A restaurant menu on a guest\'s phone' },
          p: ['For each dish you write the name and description in as many languages as you like, in the same form. If a translation is missing, the guest sees the dish in English, so nothing is ever blank.'] },
        { h2: 'More than the dishes',
          ticks: ['Buttons, cart, ordering and checks in the guest\'s language', 'Allergens and tags translated automatically', 'A welcome screen with a language picker, Wi-Fi and reviews'] },
      ],
      faq: [
        ['Which languages are supported?', 'English, Spanish, French, German, Italian, Greek, Dutch and Polish.'],
        ['Does it open in the guest\'s language automatically?', 'Yes, in the language of their phone if it is one of the 8. Guests can always switch from the welcome screen or the language button.'],
        ['How much does it cost?', 'All 8 languages are included in Kalimenu, $29/month per location.'],
      ],
    },
  ],
};

/** The page at `path` of a market, or null. */
export const landingFor = (market, path) => (LANDING[market] || []).find((p) => p.path === path.replace(/\/+$/, '')) || null;

/** The same page in the other market (for hreflang), or null. */
export const pairOf = (market, page) => (LANDING[market === 'us' ? 'gr' : 'us'] || []).find((p) => p.id === page.id) || null;

/** The whole HTML of a search page; `head` are the search engine tags added by seo.js. */
export function renderLanding(market, page, head) {
  const t = UI[market];
  const others = LANDING[market].filter((p) => p !== page);
  const ticks = (list) => `<ul class="ticks">${list.map((x) => `<li data-i="check"><span>${x}</span></li>`).join('')}</ul>`;
  const steps = (list) => `<div class="steps">${list.map(([b, p]) => `<div class="step reveal"><b>${b}</b><p>${p}</p></div>`).join('')}</div>`;
  const cards = (list) => `<div class="features lp-cards">${list.map(([i, b, p]) => `<div class="feat"><span class="fi" data-i="${i}"></span><b>${b}</b><p>${p}</p></div>`).join('')}</div>`;
  const table = ({ head: h, rows }) => `<div class="table-scroll"><table class="cmp lp-cmp"><thead><tr>${h.map((x) => `<th>${x}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((x, i) => `<td${i === 2 ? ' class="hl"' : ''}>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const body = (s) => [(s.p || []).map((x) => `<p>${x}</p>`).join(''), s.ticks ? ticks(s.ticks) : ''].join('');
  let side = 0;
  const sections = page.sections.map((s, n) => {
    const alt = n % 2 === 0 ? ' bg-cream' : '';
    if (s.shot) {
      side += 1;
      const phone = s.shot.kind !== 'tablet' && s.shot.kind !== 'trio';
      return `<section class="lp-sec${alt}"><div class="wrap"><div class="spot${side % 2 === 0 ? ' rev' : ''} reveal">
        <div><h2>${s.h2}</h2>${body(s)}</div>
        <div class="spot-media${phone ? ' phone-media' : ''}"><div class="blob"></div>${frame(market, s.shot.kind ? s.shot : { ...s.shot, kind: 'phone' })}</div>
      </div></div></section>`;
    }
    return `<section class="lp-sec${alt}"><div class="wrap"><div class="lp-text reveal"><h2>${s.h2}</h2>${body(s)}</div>
      ${s.steps ? steps(s.steps) : ''}${s.cards ? cards(s.cards) : ''}${s.table ? `<div class="lp-text">${table(s.table)}</div>` : ''}</div></section>`;
  }).join('\n');
  const [otherUrl, otherLang, otherName] = t.other;
  return `<!doctype html>
<html lang="${t.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.description)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#1f3a5f">
  ${head}
  <link rel="preload" href="/fonts/manrope-${market === 'us' ? 'latin' : 'greek'}-800-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/css/app.css">
  <link rel="stylesheet" href="/css/site.css">
  <script>
    // Screenshots: the shared copies, else the ones shipped with the site.
    function fb(img) { const next = (img.dataset.fb || '').split(',').filter(Boolean); if (!next.length) { img.onerror = null; return; } img.src = next.shift(); img.dataset.fb = next.join(','); }
  </script>
</head>
<body class="lp">
  <header class="site" id="top">
    <div class="wrap">
      <a class="wordmark" href="/"><img src="/brand/logo.svg" alt="Kalimenu" width="144" height="28"></a>
      <nav>
        <a class="hide-m" href="/#features">${t.features}</a>
        <a class="hide-m" href="/#pricing">${t.pricing}</a>
        <a class="hide-m" href="/demo">Demo</a>
        <a href="/login">${t.login}</a>
        <a class="btn primary sm" href="/signup">${t.trial}</a>
      </nav>
    </div>
  </header>

  <main>
    <div class="hero-bg">
      <div class="wrap hero lp-hero">
        <div>
          <nav class="crumbs" aria-label="breadcrumb"><a href="/">${t.home}</a><span aria-hidden="true">›</span><span>${esc(page.name)}</span></nav>
          <span class="eyebrow">${page.eyebrow}</span>
          <h1>${page.h1}</h1>
          <p class="lead">${page.lead}</p>
          <div class="ctas">
            <a class="btn primary" href="/signup">${t.start}</a>
            <a class="btn secondary" href="/demo">${t.demo}</a>
          </div>
          <ul class="trust">${t.trust.map((x) => `<li data-i="check">${x}</li>`).join('')}</ul>
        </div>
        <div class="visual">${frame(market, { kind: 'phone', ...page.hero }, false)}</div>
      </div>
    </div>

    ${sections}

    ${page.steps ? `<section class="lp-sec"><div class="wrap"><div class="lp-text center reveal"><h2>${market === 'us' ? 'Up and running in an afternoon' : 'Έτοιμο σε ένα απόγευμα'}</h2></div>${steps(page.steps)}</div></section>` : ''}

    <section class="lp-sec"><div class="wrap">
      <div class="lp-price reveal">
        <div><span class="eyebrow">${t.priceTitle}</span>
          <div class="lp-amount">${t.price}<small>${t.perMonth}</small></div>
          <p>${t.priceText}</p></div>
        <div class="ctas"><a class="btn primary" href="/signup">${t.start}</a><a class="btn secondary" href="/#pricing">${t.seePrices}</a></div>
      </div>
    </div></section>

    <section class="lp-sec bg-cream" id="faq"><div class="wrap faq">
      <div class="reveal"><span class="eyebrow">${esc(page.name)}</span><h2>${t.faq}</h2></div>
      <div>${page.faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
    </div></section>

    <section class="lp-sec"><div class="wrap">
      <h2 class="lp-rel-title">${t.related}</h2>
      <div class="lp-related">${others.map((p) => `<a class="lp-link" href="${p.path}"><b>${esc(p.name)}</b><span>${esc(p.blurb)}</span></a>`).join('')}
        <a class="lp-link" href="/"><b>Kalimenu</b><span>${market === 'us' ? 'Everything Kalimenu does, with pricing.' : 'Όλες οι δυνατότητες και οι τιμές.'}</span></a></div>
    </div></section>

    <div class="wrap">
      <div class="cta-band reveal">
        <h2>${t.ctaTitle}</h2>
        <p class="sub">${t.ctaText}</p>
        <div class="ctas"><a class="btn primary" href="/signup">${t.create}</a><a class="btn secondary" href="/demo">${t.tryDemo}</a></div>
      </div>
    </div>
  </main>

  <footer><div class="wrap foot">
    <div class="foot-brand"><img src="/brand/logo-white.svg" alt="Kalimenu" width="133" height="26">
      <p class="foot-tag">${t.tag}</p>
      © <span id="year"></span> Kalimenu<span data-if="name"> · <span data-company="name"></span></span>${market === 'us' ? '' : `<span data-if="vat"> · ${t.vat} <span data-company="vat"></span></span><span data-if="gemi"> · ${t.gemi} <span data-company="gemi"></span></span>`}
      <span class="co-line"><span data-if="address"> · <span data-company="address"></span></span><span data-if="email"> · <span data-company="email"></span></span><span data-if="phone"> · <span data-company="phone"></span></span></span>
      <div class="made-by"><a class="walkup" href="https://walkupdigital.com" target="_blank" rel="noopener"><img src="/brand/walkup-mark.png" alt="" width="22" height="15">Designed by walkupdigital.com</a></div></div>
    <div class="foot-cols">
      <nav><b>${t.product}</b><a href="/#how">${t.how}</a><a href="/#features">${t.features}</a><a href="/#pricing">${t.pricing}</a><a href="/demo">Demo</a><a href="/signup">${t.trial}</a></nav>
      <nav><b>${t.solutions}</b>${LANDING[market].map((p) => `<a href="${p.path}">${esc(p.name)}</a>`).join('')}</nav>
      <nav><b>${t.legal}</b><a href="/terms">${t.terms}</a><a href="/privacy">${t.privacy}</a><a href="/cookies">${t.cookies}</a><a href="#" data-cookie-settings>${t.cookieSettings}</a><a href="${otherUrl}" hreflang="${otherLang}" translate="no">${otherName}</a></nav>
    </div>
  </div></footer>

  <script type="module" src="/js/site-page.js"></script>
</body>
</html>
`;
}
