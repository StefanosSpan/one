import { randomBytes } from 'node:crypto';

export const LANGS = ['el', 'en', 'de', 'fr', 'it', 'es', 'nl', 'pl'];

// t('Ελληνικά', 'English', 'Deutsch', 'Français', 'Italiano', 'Español', 'Nederlands', 'Polski')
const t = (...values) => Object.fromEntries(LANGS.map((l, i) => [l, values[i] ?? values[1] ?? values[0]]));

const CATEGORIES = [
  { key: 'salads', icon: '', name: t('Σαλάτες', 'Salads', 'Salate', 'Salades', 'Insalate', 'Ensaladas', 'Salades', 'Sałatki') },
  { key: 'starters', icon: '', name: t('Ορεκτικά', 'Starters', 'Vorspeisen', 'Entrées', 'Antipasti', 'Entrantes', 'Voorgerechten', 'Przystawki') },
  { key: 'mains', icon: '', name: t('Κυρίως πιάτα', 'Main courses', 'Hauptgerichte', 'Plats principaux', 'Secondi piatti', 'Platos principales', 'Hoofdgerechten', 'Dania główne') },
  { key: 'seafood', icon: '', name: t('Θαλασσινά', 'Seafood', 'Meeresfrüchte', 'Fruits de mer', 'Frutti di mare', 'Mariscos', 'Zeevruchten', 'Owoce morza') },
  { key: 'desserts', icon: '', name: t('Γλυκά', 'Desserts', 'Desserts', 'Desserts', 'Dolci', 'Postres', 'Desserts', 'Desery') },
  { key: 'drinks', icon: '', name: t('Ποτά', 'Drinks', 'Getränke', 'Boissons', 'Bevande', 'Bebidas', 'Dranken', 'Napoje') },
];

const ITEMS = [
  ['salads', '', 850, ['milk'], ['vegetarian', 'gluten_free', 'popular'],
    t('Χωριάτικη σαλάτα', 'Greek salad', 'Griechischer Bauernsalat', 'Salade grecque', 'Insalata greca', 'Ensalada griega', 'Griekse salade', 'Sałatka grecka'),
    t('Ντομάτα, αγγούρι, κρεμμύδι, πιπεριά, ελιές Καλαμών και φέτα', 'Tomato, cucumber, onion, pepper, Kalamata olives and feta', 'Tomate, Gurke, Zwiebel, Paprika, Kalamata-Oliven und Feta', 'Tomate, concombre, oignon, poivron, olives de Kalamata et feta', 'Pomodoro, cetriolo, cipolla, peperone, olive Kalamata e feta', 'Tomate, pepino, cebolla, pimiento, aceitunas de Kalamata y feta', 'Tomaat, komkommer, ui, paprika, Kalamata-olijven en feta', 'Pomidor, ogórek, cebula, papryka, oliwki Kalamata i feta')],
  ['salads', '', 700, ['gluten', 'milk'], ['vegetarian'],
    t('Ντάκος', 'Dakos', 'Dakos', 'Dakos', 'Dakos', 'Dakos', 'Dakos', 'Dakos'),
    t('Κριθαρένιο παξιμάδι με τριμμένη ντομάτα, μυζήθρα και ελαιόλαδο', 'Barley rusk with grated tomato, mizithra cheese and olive oil', 'Gerstenzwieback mit Tomate, Mizithra-Käse und Olivenöl', 'Biscotte d’orge, tomate râpée, fromage mizithra et huile d’olive', 'Fetta d’orzo con pomodoro, formaggio mizithra e olio d’oliva', 'Tostada de cebada con tomate, queso mizithra y aceite de oliva', 'Gerstebeschuit met tomaat, mizithra-kaas en olijfolie', 'Jęczmienny suchar z pomidorem, serem mizithra i oliwą')],
  ['starters', '', 450, ['milk'], ['vegetarian', 'gluten_free', 'popular'],
    t('Τζατζίκι', 'Tzatziki', 'Tzatziki', 'Tzatziki', 'Tzatziki', 'Tzatziki', 'Tzatziki', 'Tzatziki'),
    t('Στραγγιστό γιαούρτι, αγγούρι, σκόρδο και άνηθος', 'Strained yogurt, cucumber, garlic and dill', 'Abgetropfter Joghurt, Gurke, Knoblauch und Dill', 'Yaourt égoutté, concombre, ail et aneth', 'Yogurt colato, cetriolo, aglio e aneto', 'Yogur colado, pepino, ajo y eneldo', 'Uitgelekte yoghurt, komkommer, knoflook en dille', 'Gęsty jogurt, ogórek, czosnek i koperek')],
  ['starters', '', 550, [], ['vegan', 'gluten_free'],
    t('Φάβα Σαντορίνης', 'Santorini fava', 'Fava aus Santorini', 'Fava de Santorin', 'Fava di Santorini', 'Fava de Santorini', 'Fava uit Santorini', 'Fava z Santorini'),
    t('Κρέμα από κίτρινα φασόλια με κάπαρη και κρεμμύδι', 'Yellow split pea purée with capers and onion', 'Püree aus gelben Erbsen mit Kapern und Zwiebeln', 'Purée de pois jaunes, câpres et oignon', 'Crema di piselli gialli con capperi e cipolla', 'Puré de guisantes amarillos con alcaparras y cebolla', 'Puree van gele spliterwten met kappertjes en ui', 'Purée z żółtego groszku z kaparami i cebulą')],
  ['starters', '', 650, ['milk', 'gluten'], ['vegetarian'],
    t('Σαγανάκι', 'Saganaki', 'Saganaki', 'Saganaki', 'Saganaki', 'Saganaki', 'Saganaki', 'Saganaki'),
    t('Τηγανητή κεφαλογραβιέρα με λεμόνι', 'Pan-fried graviera cheese with lemon', 'Gebratener Graviera-Käse mit Zitrone', 'Fromage graviera poêlé au citron', 'Formaggio graviera fritto con limone', 'Queso graviera frito con limón', 'Gebakken graviera-kaas met citroen', 'Smażony ser graviera z cytryną')],
  ['starters', '', 400, [], ['vegan', 'gluten_free'],
    t('Πατάτες τηγανητές', 'French fries', 'Pommes frites', 'Frites', 'Patatine fritte', 'Patatas fritas', 'Friet', 'Frytki'),
    t('Φρέσκες πατάτες κομμένες στο χέρι, με ρίγανη', 'Fresh hand-cut potatoes with oregano', 'Frische, handgeschnittene Kartoffeln mit Oregano', 'Pommes de terre fraîches coupées main, à l’origan', 'Patate fresche tagliate a mano con origano', 'Patatas frescas cortadas a mano con orégano', 'Verse, met de hand gesneden aardappelen met oregano', 'Świeże ziemniaki krojone ręcznie, z oregano')],
  ['starters', '', 600, [], ['vegan', 'gluten_free'],
    t('Ντολμαδάκια', 'Dolmades', 'Dolmades', 'Dolmades', 'Dolmades', 'Dolmades', 'Dolmades', 'Dolmades'),
    t('Αμπελόφυλλα γεμιστά με ρύζι και μυρωδικά', 'Vine leaves stuffed with rice and herbs', 'Weinblätter gefüllt mit Reis und Kräutern', 'Feuilles de vigne farcies au riz et aux herbes', 'Foglie di vite ripiene di riso ed erbe', 'Hojas de parra rellenas de arroz y hierbas', 'Wijnbladeren gevuld met rijst en kruiden', 'Liście winogron nadziewane ryżem i ziołami')],
  ['mains', '', 1150, ['gluten', 'milk', 'eggs'], ['popular'],
    t('Μουσακάς', 'Moussaka', 'Moussaka', 'Moussaka', 'Moussaka', 'Musaka', 'Moussaka', 'Musaka'),
    t('Μελιτζάνα, πατάτα, κιμάς μοσχαρίσιος και μπεσαμέλ', 'Aubergine, potato, minced beef and béchamel', 'Aubergine, Kartoffel, Rinderhack und Béchamel', 'Aubergine, pomme de terre, bœuf haché et béchamel', 'Melanzane, patate, carne macinata di manzo e besciamella', 'Berenjena, patata, carne picada de ternera y bechamel', 'Aubergine, aardappel, rundergehakt en bechamel', 'Bakłażan, ziemniaki, mielona wołowina i beszamel')],
  ['mains', '', 1000, ['gluten', 'milk'], [],
    t('Σουβλάκι χοιρινό', 'Pork souvlaki', 'Schweinefleisch-Souvlaki', 'Souvlaki de porc', 'Souvlaki di maiale', 'Souvlaki de cerdo', 'Varkenssouvlaki', 'Souvlaki wieprzowe'),
    t('Δύο καλαμάκια με πίτα, πατάτες και τζατζίκι', 'Two skewers with pita, fries and tzatziki', 'Zwei Spieße mit Pita, Pommes und Tzatziki', 'Deux brochettes avec pita, frites et tzatziki', 'Due spiedini con pita, patatine e tzatziki', 'Dos brochetas con pita, patatas y tzatziki', 'Twee spiesjes met pita, friet en tzatziki', 'Dwa szaszłyki z pitą, frytkami i tzatziki')],
  ['mains', '', 1600, [], ['gluten_free'],
    t('Παϊδάκια αρνίσια', 'Lamb chops', 'Lammkoteletts', 'Côtelettes d’agneau', 'Costolette d’agnello', 'Chuletas de cordero', 'Lamskoteletten', 'Kotlety jagnięce'),
    t('Στα κάρβουνα, με λεμόνι και ρίγανη', 'Charcoal-grilled with lemon and oregano', 'Vom Holzkohlegrill mit Zitrone und Oregano', 'Grillées au charbon, citron et origan', 'Alla brace con limone e origano', 'A la brasa con limón y orégano', 'Van de houtskoolgrill met citroen en oregano', 'Z grilla węglowego z cytryną i oregano')],
  ['mains', '', 950, [], ['vegan', 'gluten_free'],
    t('Γεμιστά', 'Gemista', 'Gemista', 'Gemista', 'Gemista', 'Gemista', 'Gemista', 'Gemista'),
    t('Ντομάτες και πιπεριές γεμιστές με ρύζι και μυρωδικά', 'Tomatoes and peppers stuffed with rice and herbs', 'Mit Reis und Kräutern gefüllte Tomaten und Paprika', 'Tomates et poivrons farcis au riz et aux herbes', 'Pomodori e peperoni ripieni di riso ed erbe', 'Tomates y pimientos rellenos de arroz y hierbas', 'Tomaten en paprika’s gevuld met rijst en kruiden', 'Pomidory i papryki nadziewane ryżem i ziołami')],
  ['seafood', '', 1200, ['molluscs', 'gluten'], [],
    t('Καλαμαράκια τηγανητά', 'Fried calamari', 'Frittierte Calamari', 'Calamars frits', 'Calamari fritti', 'Calamares fritos', 'Gefrituurde inktvis', 'Smażone kalmary'),
    t('Τραγανά καλαμαράκια με λεμόνι', 'Crispy squid rings with lemon', 'Knusprige Tintenfischringe mit Zitrone', 'Anneaux de calamar croustillants au citron', 'Anelli di calamaro croccanti con limone', 'Anillas de calamar crujientes con limón', 'Knapperige inktvisringen met citroen', 'Chrupiące krążki kalmarów z cytryną')],
  ['seafood', '', 1500, ['molluscs'], ['gluten_free', 'popular'],
    t('Χταπόδι σχάρας', 'Grilled octopus', 'Gegrillter Oktopus', 'Poulpe grillé', 'Polpo alla griglia', 'Pulpo a la parrilla', 'Gegrilde octopus', 'Grillowana ośmiornica'),
    t('Με ελαιόλαδο, ξίδι και ρίγανη', 'With olive oil, vinegar and oregano', 'Mit Olivenöl, Essig und Oregano', 'À l’huile d’olive, vinaigre et origan', 'Con olio d’oliva, aceto e origano', 'Con aceite de oliva, vinagre y orégano', 'Met olijfolie, azijn en oregano', 'Z oliwą, octem i oregano')],
  ['seafood', '', 900, ['fish'], ['gluten_free'],
    t('Σαρδέλες ψητές', 'Grilled sardines', 'Gegrillte Sardinen', 'Sardines grillées', 'Sardine alla griglia', 'Sardinas a la parrilla', 'Gegrilde sardines', 'Grillowane sardynki'),
    t('Φρέσκες σαρδέλες με λαδολέμονο', 'Fresh sardines with lemon-olive oil dressing', 'Frische Sardinen mit Zitronen-Olivenöl', 'Sardines fraîches, sauce citron-huile d’olive', 'Sardine fresche con olio e limone', 'Sardinas frescas con aliño de limón y aceite', 'Verse sardines met citroen-olijfoliedressing', 'Świeże sardynki z sosem cytrynowo-oliwnym')],
  ['desserts', '', 500, ['milk', 'nuts'], ['vegetarian', 'gluten_free'],
    t('Γιαούρτι με μέλι και καρύδια', 'Yogurt with honey and walnuts', 'Joghurt mit Honig und Walnüssen', 'Yaourt au miel et aux noix', 'Yogurt con miele e noci', 'Yogur con miel y nueces', 'Yoghurt met honing en walnoten', 'Jogurt z miodem i orzechami włoskimi'),
    t('Στραγγιστό γιαούρτι με θυμαρίσιο μέλι', 'Strained yogurt with thyme honey', 'Abgetropfter Joghurt mit Thymianhonig', 'Yaourt égoutté au miel de thym', 'Yogurt colato con miele di timo', 'Yogur colado con miel de tomillo', 'Uitgelekte yoghurt met tijmhoning', 'Gęsty jogurt z miodem tymiankowym')],
  ['desserts', '', 550, ['gluten', 'nuts', 'milk'], ['vegetarian'],
    t('Μπακλαβάς', 'Baklava', 'Baklava', 'Baklava', 'Baklava', 'Baklava', 'Baklava', 'Baklawa'),
    t('Φύλλο με καρύδια και σιρόπι μελιού', 'Filo pastry with walnuts and honey syrup', 'Filoteig mit Walnüssen und Honigsirup', 'Pâte filo aux noix et sirop de miel', 'Pasta fillo con noci e sciroppo di miele', 'Masa filo con nueces y almíbar de miel', 'Filodeeg met walnoten en honingsiroop', 'Ciasto filo z orzechami i syropem miodowym')],
  ['drinks', '', 700, ['sulphites'], [],
    t('Χύμα κρασί (½ λίτρο)', 'House wine (½ litre)', 'Hauswein (½ Liter)', 'Vin de la maison (½ litre)', 'Vino della casa (½ litro)', 'Vino de la casa (½ litro)', 'Huiswijn (½ liter)', 'Wino domowe (½ litra)'),
    t('Λευκό, κόκκινο ή ροζέ', 'White, red or rosé', 'Weiß, rot oder rosé', 'Blanc, rouge ou rosé', 'Bianco, rosso o rosato', 'Blanco, tinto o rosado', 'Wit, rood of rosé', 'Białe, czerwone lub różowe')],
  ['drinks', '', 600, [], [],
    t('Ούζο (καραφάκι)', 'Ouzo (small carafe)', 'Ouzo (Karaffe)', 'Ouzo (carafon)', 'Ouzo (caraffa)', 'Ouzo (jarrita)', 'Ouzo (karafje)', 'Ouzo (karafka)'),
    t('Σερβίρεται με πάγο', 'Served with ice', 'Mit Eis serviert', 'Servi avec des glaçons', 'Servito con ghiaccio', 'Servido con hielo', 'Geserveerd met ijs', 'Podawane z lodem')],
  ['drinks', '', 450, ['gluten'], [],
    t('Μπύρα 500ml', 'Beer 500ml', 'Bier 500 ml', 'Bière 500 ml', 'Birra 500 ml', 'Cerveza 500 ml', 'Bier 500 ml', 'Piwo 500 ml'),
    t('Ελληνική μπύρα, παγωμένη', 'Ice-cold Greek beer', 'Eiskaltes griechisches Bier', 'Bière grecque bien fraîche', 'Birra greca ghiacciata', 'Cerveza griega bien fría', 'IJskoud Grieks bier', 'Lodowato zimne greckie piwo')],
  ['drinks', '', 350, [], ['vegan', 'gluten_free'],
    t('Σπιτική λεμονάδα', 'Homemade lemonade', 'Hausgemachte Limonade', 'Citronnade maison', 'Limonata fatta in casa', 'Limonada casera', 'Huisgemaakte limonade', 'Domowa lemoniada'),
    t('Με φρέσκα λεμόνια και δυόσμο', 'With fresh lemons and mint', 'Mit frischen Zitronen und Minze', 'Citrons frais et menthe', 'Con limoni freschi e menta', 'Con limones frescos y menta', 'Met verse citroenen en munt', 'Ze świeżych cytryn i mięty')],
  ['drinks', '', 150, [], ['vegan', 'gluten_free'],
    t('Νερό 1L', 'Water 1L', 'Wasser 1 l', 'Eau 1 L', 'Acqua 1 L', 'Agua 1 L', 'Water 1 L', 'Woda 1 l'),
    t('Εμφιαλωμένο νερό', 'Bottled water', 'Mineralwasser', 'Eau en bouteille', 'Acqua in bottiglia', 'Agua embotellada', 'Flessenwater', 'Woda butelkowana')],
];

// Options / extras for some demo dishes, keyed by the dish's position in ITEMS.
const choice = (name, price_cents = 0) => ({ name, price_cents });
const OPTIONS = {
  0: [{ name: t('Έξτρα', 'Extras', 'Extras', 'Suppléments', 'Extra', 'Extras', "Extra's", 'Dodatki'), required: false, multi: true, choices: [
    choice(t('Έξτρα φέτα', 'Extra feta', 'Extra Feta', 'Supplément feta', 'Feta extra', 'Feta extra', 'Extra feta', 'Dodatkowa feta'), 150),
    choice(t('Κάπαρη', 'Capers', 'Kapern', 'Câpres', 'Capperi', 'Alcaparras', 'Kappertjes', 'Kapary'), 50),
  ] }],
  8: [{ name: t('Συνοδευτικό', 'Side', 'Beilage', 'Accompagnement', 'Contorno', 'Guarnición', 'Bijgerecht', 'Dodatek'), required: true, multi: false, choices: [
    choice(t('Πατάτες τηγανητές', 'Fries', 'Pommes frites', 'Frites', 'Patatine fritte', 'Patatas fritas', 'Friet', 'Frytki')),
    choice(t('Σαλάτα', 'Salad', 'Salat', 'Salade', 'Insalata', 'Ensalada', 'Salade', 'Sałatka')),
  ] }],
  9: [{ name: t('Ψήσιμο', 'Cooking', 'Garstufe', 'Cuisson', 'Cottura', 'Punto de cocción', 'Garing', 'Stopień wysmażenia'), required: true, multi: false, choices: [
    choice(t('Μέτριο', 'Medium', 'Medium', 'À point', 'Media cottura', 'Al punto', 'Medium', 'Średnio')),
    choice(t('Καλοψημένο', 'Well done', 'Durchgebraten', 'Bien cuit', 'Ben cotto', 'Muy hecho', 'Doorbakken', 'Dobrze wysmażone')),
  ] }],
  16: [{ name: t('Κρασί', 'Wine', 'Wein', 'Vin', 'Vino', 'Vino', 'Wijn', 'Wino'), required: true, multi: false, choices: [
    choice(t('Λευκό', 'White', 'Weiß', 'Blanc', 'Bianco', 'Blanco', 'Wit', 'Białe')),
    choice(t('Κόκκινο', 'Red', 'Rot', 'Rouge', 'Rosso', 'Tinto', 'Rood', 'Czerwone')),
    choice(t('Ροζέ', 'Rosé', 'Rosé', 'Rosé', 'Rosato', 'Rosado', 'Rosé', 'Różowe')),
  ] }],
};

export const DEFAULT_RESTAURANT = {
  name: 'Το εστιατόριό σας',
  description: t(
    'Παραδοσιακή ελληνική κουζίνα δίπλα στη θάλασσα, από το 1985.',
    'Traditional Greek cuisine by the sea, since 1985.',
    'Traditionelle griechische Küche am Meer, seit 1985.',
    'Cuisine grecque traditionnelle au bord de la mer, depuis 1985.',
    'Cucina greca tradizionale sul mare, dal 1985.',
    'Cocina griega tradicional junto al mar, desde 1985.',
    'Traditionele Griekse keuken aan zee, sinds 1985.',
    'Tradycyjna kuchnia grecka nad morzem, od 1985 roku.'),
  hours: t(
    'Κάθε μέρα 12:00 – 00:00', 'Every day 12:00 – 00:00', 'Täglich 12:00 – 00:00', 'Tous les jours 12h00 – 00h00',
    'Tutti i giorni 12:00 – 00:00', 'Todos los días 12:00 – 00:00', 'Dagelijks 12:00 – 00:00', 'Codziennie 12:00 – 00:00'),
  address: 'Παραλία 12, Νάξος 843 00',
  phone: '+30 22850 12345',
  email: '',
  mapsUrl: 'https://maps.google.com/?q=Naxos',
  wifiName: 'Taverna-Guests',
  wifiPassword: 'kalosirthate',
  instagram: '',
  reviewUrl: '',
};

export async function seed(db, { newToken }) {
  const settings = {
    restaurant: DEFAULT_RESTAURANT,
    languages: LANGS,
    defaultLanguage: 'el',
    requireApproval: true,
    onlinePayments: 'demo',
    currency: 'EUR',
    brandColor: '#1f3a5f',
    pins: { admin: '1234', waiter: '1111', kitchen: '2222' },
    secret: randomBytes(32).toString('hex'),
    publicBaseUrl: '',
  };
  for (const [k, v] of Object.entries(settings)) {
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      [k, JSON.stringify(v)]);
  }

  const catIds = {};
  for (const [i, c] of CATEGORIES.entries()) {
    catIds[c.key] = await db.insert('INSERT INTO categories (name, icon, sort) VALUES (?, ?, ?)', [JSON.stringify(c.name), c.icon, i]);
  }

  for (const [i, [cat, emoji, price, allergens, tags, name, desc]] of ITEMS.entries()) {
    await db.insert(`INSERT INTO items (category_id, name, description, price_cents, allergens, tags, emoji, sort, options)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [catIds[cat], JSON.stringify(name), JSON.stringify(desc), price,
      JSON.stringify(allergens), JSON.stringify(tags), emoji, i, JSON.stringify(OPTIONS[i] || [])]);
  }

  const spots = [
    ...Array.from({ length: 12 }, (_, i) => [String(i + 1), 'table']),
    ...['101', '102', '201', '202'].map((r) => [r, 'room']),
    ...Array.from({ length: 4 }, (_, i) => [String(i + 1), 'sunbed']),
  ];
  for (const [label, kind] of spots) {
    await db.insert('INSERT INTO tables (label, token, kind) VALUES (?, ?, ?)', [label, newToken(), kind]);
  }
}
