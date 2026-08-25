// The Ausreden-Generator: a deliberate gag on the event cards (see
// DESIGN_SYSTEM.md, "Orga"). It writes an excuse for whatever *other* event
// collides with a Respawn event, so nobody has to invent one under pressure.
//
// Two rules shape the data below:
//   1. No entry ever mentions the Respawn event. The excuse is sent to the
//      organizer of the competing appointment, and naming the LAN would defeat
//      the entire purpose.
//   2. Detail is the joke. Dosages, file numbers, room numbers and street-level
//      specifics are what make an excuse read as true, so `excuseCredibility()`
//      literally scores length plus concrete numbers.
//
// Duration buckets keep an excuse plausible for the absence it has to cover: a
// single evening needs a different story than a five-day trip. `durations`
// lists the buckets an entry fits; the `unknown` bucket (an event whose date is
// still being polled) is derived instead — it offers every entry that needs no
// date placeholder at all.

const DAY_MS = 24 * 60 * 60 * 1000;

// Fits any length of absence.
const ANY = Object.freeze(['short', 'medium', 'long']);
// Needs a real period because the text prints concrete dates. A text that
// prints a start *and* an end date must use MULTI instead: on a single-day
// event both resolve to the same date, and "von 12.09. bis 12.09." reads as a
// copy-paste slip. `{zeitraum}` is the placeholder that already collapses that
// case, so it is the safe choice here.
const DATED = Object.freeze(['short', 'medium', 'long']);
// At least two calendar days — the only buckets where `{tage}` is >= 2 and the
// plural in the German text is correct.
const MULTI = Object.freeze(['medium', 'long']);
const SHORT = Object.freeze(['short']);
const MEDIUM = Object.freeze(['medium']);
const LONG = Object.freeze(['long']);
const SHORT_MEDIUM = Object.freeze(['short', 'medium']);

export const EXCUSE_CATEGORIES = Object.freeze([
  { id: 'krankheit', label: 'Krankheit' },
  { id: 'familie', label: 'Familie' },
  { id: 'haushalt', label: 'Haus & Hof' },
  { id: 'tier', label: 'Tiere' },
  { id: 'amt', label: 'Behörde' },
  { id: 'technik', label: 'Technik' },
  { id: 'beruf', label: 'Beruf' },
  { id: 'schicksal', label: 'Höhere Gewalt' },
]);

export const EVENT_EXCUSES = Object.freeze([
  // ---------- Krankheit ----------
  {
    id: 'norovirus',
    category: 'krankheit',
    durations: ANY,
    text: 'Norovirus, und zwar die Variante GII.4 Sydney. Das Gesundheitsamt hat mir am Telefon vorgelesen, dass ich noch 48 Stunden nach dem letzten Symptom als ansteckend gelte. Symptomfrei bin ich seit heute Morgen um 6:40 Uhr, du kannst also selbst nachrechnen.',
  },
  {
    id: 'zeh-billy',
    category: 'krankheit',
    durations: MULTI,
    text: 'Beim Aufbau eines Billy-Regals ist mir das Seitenteil auf den linken kleinen Zeh gefallen. Grundgliedfraktur, Dachziegelverband, Ibuprofen 600 alle acht Stunden. Dr. Wenzel hat {tage} Tage Hochlagern verordnet, und mit Dr. Wenzel diskutiert man nicht.',
  },
  {
    id: 'bindehaut',
    category: 'krankheit',
    durations: ANY,
    text: 'Bindehautentzündung, beidseitig und bakteriell. Ich tropfe alle vier Stunden Gentamicin und sehe aus wie ein Kaninchen, das gerade eine Steuernachzahlung bekommen hat. Ansteckend bleibe ich bis mindestens 24 Stunden nach dem ersten Antibiotikum.',
  },
  {
    id: 'hexenschuss',
    category: 'krankheit',
    durations: ANY,
    text: 'Hexenschuss beim Anheben einer Getränkekiste, auf Höhe L4/L5. Ich stehe in einer Haltung, die meine Physiotherapeutin freundlich „Fragezeichen“ nennt, und darf nichts über zwei Kilo heben. Eine Grußkarte wiegt weniger, die schaffe ich noch.',
  },
  {
    id: 'weisheitszahn',
    category: 'krankheit',
    durations: ANY,
    text: 'Weisheitszahn 48 wird operativ entfernt, er liegt verlagert und wächst quer auf den Nerv zu. Der Kieferchirurg rechnet mit dickem Gesicht, Kühlpads alle 20 Minuten und einer Ernährung, die für mehrere Tage ausschließlich aus lauwarmer Kartoffelsuppe besteht.',
  },
  {
    id: 'allergie-provokation',
    category: 'krankheit',
    durations: MULTI,
    text: 'Ich habe nach 14 Monaten Wartezeit endlich einen Platz für den stationären Provokationstest im Allergiezentrum bekommen. Ich liege {tage} Tage am Tropf und esse unter Aufsicht Haselnüsse. Wenn ich absage, fange ich die Warteliste von hinten an.',
  },
  {
    id: 'nebenhoehlen',
    category: 'krankheit',
    durations: ANY,
    text: 'Nebenhöhlenentzündung, die richtig eitrige Sorte. Amoxicillin 1000 dreimal täglich, Nasendusche mit Emser Salz, und wenn ich mich vorbeuge, höre ich in meinem eigenen Kopf das Meer rauschen. Sprechen geht, Zuhören leider nicht.',
  },
  {
    id: 'guertelrose',
    category: 'krankheit',
    durations: ANY,
    text: 'Gürtelrose auf der linken Rippenseite. Aciclovir fünfmal am Tag, und solange die Bläschen nicht verkrustet sind, bin ich für jeden ohne Windpocken ein wandelndes Risiko. Ich möchte nicht der Mensch sein, der eine ganze Veranstaltung ansteckt.',
  },
  {
    id: 'sehnenscheide',
    category: 'krankheit',
    durations: ANY,
    text: 'Sehnenscheidenentzündung im rechten Handgelenk, im Befund steht „Tendovaginitis de Quervain“. Ich trage eine Daumen-Handgelenk-Orthese, darf sie nur zum Waschen abnehmen und habe für diese Nachricht hier mit links 14 Minuten gebraucht.',
  },
  {
    id: 'daumen-spuelmaschine',
    category: 'krankheit',
    durations: ANY,
    text: 'Ich habe mir beim Ausräumen der Spülmaschine den Daumen verstaucht: Bandverletzung am Grundgelenk, medizinisch ein Skidaumen, nur ohne die Würde des Skifahrens. Acht Wochen Schiene, ab Woche drei zusätzlich Krankengymnastik.',
  },
  {
    id: 'migraene',
    category: 'krankheit',
    durations: SHORT,
    text: 'Migräne mit Aura. Es hat um 15:12 Uhr mit Flimmerskotomen im rechten Gesichtsfeld angefangen, das Sumatriptan wirkt frühestens in einer Stunde, und den Rest des Tages verbringe ich in einem abgedunkelten Zimmer mit einem feuchten Waschlappen im Gesicht.',
  },
  {
    id: 'hoersturz',
    category: 'krankheit',
    durations: MULTI,
    text: 'Hörsturz links, seit gestern Watte im Ohr und ein Dauerton in der Tonlage eines schlecht gestimmten Kühlschranks. Ich bekomme {tage} Tage lang täglich eine Infusion über 45 Minuten und soll danach Stress meiden. Größere Menschenmengen zählen laut HNO als Stress.',
  },
  {
    id: 'zeckenbiss',
    category: 'krankheit',
    durations: ANY,
    text: 'Zeckenbiss in der Kniekehle mit einer Wanderröte von inzwischen sieben Zentimetern. Ich nehme Doxycyclin 100, und darunter sind Alkohol und direkte Sonne praktisch verboten. Ich wäre der traurigste Gast, den du je hattest.',
  },
  {
    id: 'blutspende',
    category: 'krankheit',
    durations: SHORT,
    text: 'Ich war Blut spenden und bin beim Aufstehen umgekippt. Der Arzt hat mir 24 Stunden ohne Anstrengung, ohne Autofahren und mit viel Flüssigkeit verordnet, und meine bessere Hälfte hat das Wort „ohne Anstrengung“ leider mitgehört.',
  },
  {
    id: 'fieber-protokoll',
    category: 'krankheit',
    durations: ANY,
    text: 'Grippaler Infekt, heute Morgen 38,9 Grad, am Mittag 38,4 Grad. Meine Hausärztin lässt mich ein Fieberprotokoll führen, und laut diesem Protokoll wäre ich frühestens 48 fieberfreie Stunden später wieder auf Menschen loszulassen.',
  },
  {
    id: 'schlaflabor',
    category: 'krankheit',
    durations: MULTI,
    text: 'Ich habe endlich einen Platz im Schlaflabor bekommen: {tage} Tage verkabelt schlafen, mit Nasenbrille, Thoraxgurt und einem Kabel am Bein, das jede Bewegung mitschreibt. Absagen geht nur mit ärztlichem Attest, und gegen Termine gibt es keins.',
  },
  {
    id: 'darmspiegelung',
    category: 'krankheit',
    durations: SHORT_MEDIUM,
    text: 'Darmspiegelung. Die Untersuchung dauert 20 Minuten, die Vorbereitung mit zwei Litern Trinklösung dagegen einen kompletten Tag, den ich in einem Radius von vier Metern um eine ganz bestimmte Tür verbringe. Danach darf ich wegen der Sedierung nicht fahren.',
  },
  {
    id: 'nierenstein',
    category: 'krankheit',
    durations: ANY,
    text: 'Nierenstein, 4 Millimeter, aktuell im unteren Harnleiter. Ich nehme Tamsulosin, trinke drei Liter am Tag und muss durch ein Sieb urinieren, um den Stein für die Analyse aufzufangen. Das ist keine Tätigkeit, die sich mit einem Buffet verträgt.',
  },
  {
    id: 'impfreaktion',
    category: 'krankheit',
    durations: SHORT,
    text: 'Ich hatte gestern die Auffrischungsimpfung und habe jetzt einen Oberarm wie ein Feuerlöscher, 38,2 Grad und Gliederschmerzen. Die Ärztin nennt das die erwünschte Immunantwort. Meine Immunantwort möchte auf dem Sofa bleiben.',
  },
  {
    id: 'rippenprellung',
    category: 'krankheit',
    durations: ANY,
    text: 'Rippenprellung, vierte und fünfte Rippe rechts, zugezogen auf dem Trampolin meiner achtjährigen Nichte bei einem Manöver, das sie „Doppelmond“ nennt. Lachen tut weh, Husten tut mehr weh, und Niesen ist eine mittlere Katastrophe.',
  },
  {
    id: 'karpaltunnel',
    category: 'krankheit',
    durations: MULTI,
    text: 'Karpaltunnel-Operation rechts. Der Termin steht seit Februar, danach {tage} Tage Ruhigstellung, dann Fäden ziehen. Wenn ich verschiebe, bin ich frühestens im Frühjahr wieder dran und bis dahin schlafen mir jede Nacht drei Finger ein.',
  },
  {
    id: 'sonnenbrand',
    category: 'krankheit',
    durations: ANY,
    text: 'Sonnenbrand zweiten Grades auf dem gesamten Rücken, weil ich auf dem Balkon eingeschlafen bin. Es haben sich Blasen gebildet, ich schlafe im Sitzen und creme stündlich. Kein Stoff darf mich berühren, und das schließt Kleidung leider ein.',
  },
  {
    id: 'wurzelbehandlung',
    category: 'krankheit',
    durations: ANY,
    text: 'Dritte Sitzung meiner Wurzelbehandlung an Zahn 26. Die Praxis vergibt dafür nur zwei Termine pro Woche, die medikamentöse Einlage liegt seit sechs Wochen, und wenn sie zu lange bleibt, war die ganze Behandlung umsonst.',
  },
  {
    id: 'reha',
    category: 'krankheit',
    durations: LONG,
    text: 'Ich bin in der Anschlussheilbehandlung: {tage} Tage Bewegungstherapie, Vortragsprogramm und Anwesenheitspflicht bis zur Visite. Die Rentenversicherung hat das bewilligt, und die Rentenversicherung findet spontane Ausflüge nicht witzig.',
  },
  {
    id: 'patchtest',
    category: 'krankheit',
    durations: MULTI,
    text: 'Ich habe einen Epikutantest auf dem Rücken kleben: 32 Testfelder, die 72 Stunden weder nass werden noch schwitzen dürfen. Kein Duschen, kein Sport, keine Wärme. Ich bin gerade im Grunde ein Möbelstück mit Pflaster.',
  },
  {
    id: 'scharlach-kontakt',
    category: 'krankheit',
    durations: ANY,
    text: 'Ich bin Kontaktperson für Scharlach, die halbe Kita-Gruppe hat es erwischt. Wir messen morgens und abends Fieber, und bei den ersten Halsschmerzen muss ich sofort in die Praxis. Ich wäre exakt die Person, die es weiterträgt.',
  },
  {
    id: 'trommelfell',
    category: 'krankheit',
    durations: ANY,
    text: 'Ich habe mir beim Schnorcheln das Trommelfell perforiert, der Druckausgleich hat nicht funktioniert. Das Ohr muss absolut trocken bleiben, kein Wasser, kein Lärm, keine Höhenmeter. Der HNO hat wörtlich „vier Wochen langweiliges Leben“ verordnet.',
  },
  {
    id: 'prt-spritze',
    category: 'krankheit',
    durations: SHORT,
    text: 'Ich bekomme eine periradikuläre Therapie an der Lendenwirbelsäule, also eine Spritze unter CT-Kontrolle direkt an die Nervenwurzel. Danach darf ich 24 Stunden nicht Auto fahren und nicht allein bleiben, weil das Bein wegsacken kann.',
  },

  // ---------- Familie ----------
  {
    id: 'goldene-hochzeit',
    category: 'familie',
    durations: ANY,
    text: 'Goldene Hochzeit von Tante Roswitha und Onkel Helmut, 50 Jahre, Saal „Zur Linde“, 78 Gäste. Die Sitzordnung hängt seit April an Roswithas Kühlschrank, mein Name steht auf Platz 14, und dieser Platz wird nicht leer bleiben.',
  },
  {
    id: 'schwiegermutter-umzug',
    category: 'familie',
    durations: MULTI,
    text: 'Meine Schwiegermutter zieht um: dritter Stock ohne Aufzug, ein Klavier von 1961 und 40 Jahre Keller. Ich habe zugesagt, bevor ich vom Klavier wusste, aber zugesagt ist zugesagt und das Klavier steht immer noch da.',
  },
  {
    id: 'hochzeitsrede',
    category: 'familie',
    durations: ANY,
    text: 'Meine Cousine heiratet und ich halte die Rede. Elf Minuten Text, drei Anekdoten und ein Running Gag über einen Bollerwagen, den außerhalb dieser Familie niemand versteht. Das lässt sich nicht kurzfristig an jemand anderen abgeben.',
  },
  {
    id: 'konfirmation-patenkind',
    category: 'familie',
    durations: ANY,
    text: 'Konfirmation meines Patenkindes. Ich bin nicht nur eingeladen, ich habe eine Rolle im Gottesdienst und stehe namentlich im gedruckten Programm. Ein leerer Platz in Reihe zwei fällt in einer Dorfkirche mit 90 Sitzplätzen auf.',
  },
  {
    id: 'erbengemeinschaft',
    category: 'familie',
    durations: ANY,
    text: 'Familienrat zur Erbengemeinschaft für das Grundstück, Flurstück 217/3. Sechs Beteiligte, ein Notartermin und eine Tante, die seit 2019 nicht mit einer anderen Tante spricht. Wer fehlt, über dessen Anteil wird in seiner Abwesenheit geredet.',
  },
  {
    id: 'kinder-huetung',
    category: 'familie',
    durations: MULTI,
    text: 'Meine Schwester hat einen Bandscheibenvorfall und liegt flach. Ich habe ihre drei Kinder für {tage} Tage, inklusive Schwimmkurs, Geigenunterricht und einer Ernährungsliste mit zwei Unverträglichkeiten. Ich bin gerade ein Hotel mit angeschlossenem Fahrdienst.',
  },
  {
    id: 'vater-70',
    category: 'familie',
    durations: ANY,
    text: 'Mein Vater wird 70, und es ist eine Überraschungsfeier. Ich bin für Technik und Beamer zuständig, habe die Bilder aus vier Jahrzehnten sortiert und bin der Einzige, der weiß, wie der Ton aus dem Laptop in die Anlage kommt.',
  },
  {
    id: 'hochzeitstag-stahl',
    category: 'familie',
    durations: MEDIUM,
    text: 'Hochzeitstag, elftes Jahr, das ist Stahl. Stahl bedeutet in unserem Fall zwei Nächte in einem Wellnesshotel, gebucht vor sechs Monaten, und in der Bestätigungsmail steht wörtlich „nicht stornierbar und nicht umbuchbar“.',
  },
  {
    id: 'umzug-freund',
    category: 'familie',
    durations: MEDIUM,
    text: 'Mein bester Freund zieht um. Ich habe den Transporter auf meinen Namen gemietet und bin als einziger Fahrer eingetragen. Ohne mich steht ein 7,5-Tonner auf dem Hof, den niemand sonst bewegen darf.',
  },
  {
    id: 'elternabend-beirat',
    category: 'familie',
    durations: SHORT,
    text: 'Elternabend mit Nachwahl zum Elternbeirat. Ich habe letztes Jahr gefehlt und wurde in Abwesenheit zum Klassenkassenwart gewählt. Diesen Fehler mache ich kein zweites Mal.',
  },
  {
    id: 'kurzzeitpflege',
    category: 'familie',
    durations: ANY,
    text: 'Ich hole meine Oma aus der Kurzzeitpflege ab. Die Übergabe geht nur zu festen Zeiten, es müssen Medikamentenplan, Pflegehilfsmittel und drei Unterschriften mit, und angehörigenseitig bin ich allein zuständig.',
  },
  {
    id: 'taufe-zwillinge',
    category: 'familie',
    durations: ANY,
    text: 'Taufe der Zwillinge meines Bruders. Ich bin Pate von beiden, stehe also zweimal am Taufbecken, und die Fotografin hat einen Ablaufplan, in dem mein Name achtmal vorkommt.',
  },
  {
    id: 'begleitetes-fahren',
    category: 'familie',
    durations: ANY,
    text: 'Ich bin eingetragene Begleitperson beim Begleiteten Fahren meiner Nichte, und sie hat genau jetzt ihre einzigen freien Übungsstunden. Ohne eingetragene Begleitung darf sie das Auto nicht einmal aus der Einfahrt fahren.',
  },
  {
    id: 'kirchenarchiv',
    category: 'familie',
    durations: ANY,
    text: 'Ich habe nach sieben Monaten Wartezeit einen Platz im Kirchenarchiv bekommen. Die Kirchenbücher sind nicht digitalisiert, der Lesesaal öffnet an zwei Nachmittagen im Monat, und ich bin bei 1782 stehengeblieben.',
  },
  {
    id: 'laeuse',
    category: 'familie',
    durations: ANY,
    text: 'Bei uns sind Läuse ausgebrochen. Nissenkämmen alle zwei Tage, Kopfkissen und Kuscheltiere bei 60 Grad, der Rest drei Tage in den Gefrierschrank. Ich wäre die Person, die das mitbringt, und das will wirklich niemand.',
  },
  {
    id: 'e-jugend-turnier',
    category: 'familie',
    durations: SHORT,
    text: 'Mein Sohn hat Turnier in der E-Jugend, sieben Spiele, und ich bin als Linienrichter eingeteilt. Der Staffelleiter hat die Aufstellung schon verschickt, mit Namen, in Fettdruck.',
  },
  {
    id: 'nachbarn-silberhochzeit',
    category: 'familie',
    durations: ANY,
    text: 'Silberhochzeit der Nachbarn. Das sind genau die Nachbarn, mit denen wir uns wegen der Grundstücksgrenze auf keinen Fall verkrachen dürfen, weil die Sache mit dem Zaun juristisch noch nicht abschließend geklärt ist.',
  },
  {
    id: 'trauerfeier',
    category: 'familie',
    durations: ANY,
    text: 'Trauerfeier für Großonkel Egon. Ich habe ihn zweimal im Leben getroffen, aber in dieser Familie wird Anwesenheit gezählt und noch in 20 Jahren erwähnt. Danach Kaffeetafel im Gasthof, offenes Ende.',
  },
  {
    id: 'schwiegereltern-besuch',
    category: 'familie',
    durations: MULTI,
    text: 'Meine Schwiegereltern kommen für {tage} Tage zu Besuch. Angekündigt, bestätigt, Zugticket gebucht. Das ist kein Termin, den man verschiebt, das ist ein Naturereignis mit Ankunftszeit.',
  },
  {
    id: 'studentenwohnheim',
    category: 'familie',
    durations: MEDIUM,
    text: 'Meine Tochter zieht ins Studentenwohnheim: Zimmerübergabe, Möbelaufbau und die obligatorische Fahrt zum Möbelhaus, bei der wir feststellen werden, dass die Kommode drei Zentimeter zu breit ist.',
  },

  // ---------- Haus & Hof ----------
  {
    id: 'wasserschaden',
    category: 'haushalt',
    durations: MULTI,
    text: 'Wasserschaden. Das Eckventil unter der Spüle ist nachts abgerissen, die Küche ist aufgestemmt, zwei Bautrockner laufen. Der Sanierer rechnet mit {tage} Tagen, also von {start} bis {ende}, und die Geräte dürfen laut Versicherung nicht unbeaufsichtigt laufen.',
  },
  {
    id: 'schornsteinfeger',
    category: 'haushalt',
    durations: SHORT,
    text: 'Der Schornsteinfeger kommt zur Feuerstättenschau. Das ist ein hoheitlicher Zwangstermin, zweimal habe ich schon verschoben, und beim dritten Mal kommt er mit einer Anordnung der Behörde und ich zahle die Anfahrt.',
  },
  {
    id: 'kuechenmontage',
    category: 'haushalt',
    durations: SHORT,
    text: 'Die Küchenmontage wurde zweimal verschoben und liegt jetzt genau hier. Zeitfenster „zwischen 7 und 17 Uhr“, zwei Monteure, und wenn niemand aufmacht, ist der nächste freie Termin in elf Wochen.',
  },
  {
    id: 'heizungswartung',
    category: 'haushalt',
    durations: SHORT,
    text: 'Heizungswartung mit hydraulischem Abgleich. Der Handwerker braucht Zugang zu jedem einzelnen Heizkörper, ich laufe also von Zimmer zu Zimmer mit, und ohne den Abgleich verfällt mir die bewilligte Förderung.',
  },
  {
    id: 'glasfaser',
    category: 'haushalt',
    durations: SHORT,
    text: 'Der Tiefbautrupp legt den Glasfaser-Hausanschluss. Sie kommen bis in den Keller, ich muss die Hausanschlusstür öffnen und den Trupp einweisen, und diese Firma taucht bekanntlich genau einmal auf.',
  },
  {
    id: 'marder',
    category: 'haushalt',
    durations: MULTI,
    text: 'Wir haben einen Marder auf dem Dachboden. Der Kammerjäger hat Lebendfallen gestellt, und Lebendfallen müssen zweimal täglich kontrolliert werden. Ich bin die zuständige Person für morgens und abends.',
  },
  {
    id: 'laminat',
    category: 'haushalt',
    durations: MEDIUM,
    text: 'Ich verlege Laminat, 46 Quadratmeter in zwei Räumen. Das Material liegt seit 48 Stunden akklimatisiert im Zimmer, und wenn ich jetzt nicht anfange, steht die halbe Wohnung eine weitere Woche im Flur.',
  },
  {
    id: 'sturmbaum',
    category: 'haushalt',
    durations: ANY,
    text: 'Der Sturm hat unsere Birke angerissen, sie hängt über dem Gehweg und die Gemeinde hat uns eine Frist gesetzt. Die Fachfirma kommt mit Hebebühne, ich muss die Zufahrt freihalten und den Nachbarn Bescheid geben.',
  },
  {
    id: 'waschmaschine-nachbar',
    category: 'haushalt',
    durations: ANY,
    text: 'Meine Waschmaschine ist ausgelaufen, und der Nachbar unter mir hat jetzt Flecken an der Wohnzimmerdecke. Der Gutachter der Versicherung kommt vorbei, und bei genau diesem Termin möchte ich sehr gerne anwesend sein.',
  },
  {
    id: 'silberfische',
    category: 'haushalt',
    durations: MULTI,
    text: 'Wir haben Silberfischchen im Bad. Die Firma hat Kieselgur ausgebracht, und das Zeug muss 72 Stunden liegen bleiben: nicht wischen, nicht feucht werden lassen, nicht betreten. Wir wohnen derzeit um unser eigenes Bad herum.',
  },
  {
    id: 'hecke-frist',
    category: 'haushalt',
    durations: ANY,
    text: 'Ich muss die Hecke schneiden, bevor die Schonzeit nach Paragraf 39 Bundesnaturschutzgesetz beginnt. Danach ist bis Ende September nur noch Formschnitt erlaubt, und unsere Thuja ist von Form ungefähr so weit entfernt wie ich von Freizeit.',
  },
  {
    id: 'dachrinne',
    category: 'haushalt',
    durations: SHORT,
    text: 'Dachrinne reinigen. Der Nussbaum des Nachbarn hat sie komplett zugesetzt, beim letzten Starkregen stand das Wasser an der Kellertreppe, und der Nachbar hält die Leiter ausschließlich an diesem einen Tag.',
  },
  {
    id: 'starkstrom',
    category: 'haushalt',
    durations: SHORT,
    text: 'Der Elektriker legt Starkstrom für das neue Ceranfeld. Vier Stunden Zeitfenster, er muss den Zählerschrank öffnen und dafür die Wohnung stromlos schalten, und ohne mich kommt er nicht einmal ins Haus.',
  },
  {
    id: 'schimmel',
    category: 'haushalt',
    durations: MULTI,
    text: 'Hinter dem Schlafzimmerschrank ist Schimmel. Die Fachfirma arbeitet {tage} Tage mit Unterdruckhaltung und Staubschutzwand, das Zimmer ist gesperrt, und jemand muss die Leute jeden Morgen um 7 Uhr hereinlassen.',
  },
  {
    id: 'vertikutieren',
    category: 'haushalt',
    durations: ANY,
    text: 'Ich vertikutiere den Rasen und säe nach. Danach darf die Fläche 14 Tage nicht betreten werden und muss zweimal täglich gewässert werden, also muss es jetzt passieren, sonst wird das in dieser Saison nichts mehr.',
  },
  {
    id: 'estrich',
    category: 'haushalt',
    durations: MULTI,
    text: 'Bei uns trocknet der neue Estrich. Vorschrift ist Stoßlüften alle zwei Stunden über {tage} Tage, sonst schüsselt er und die Gewährleistung ist weg. Ich bin damit hauptberuflich Fensteröffner.',
  },
  {
    id: 'sperrmuell',
    category: 'haushalt',
    durations: SHORT,
    text: 'Ich habe einen Sperrmülltermin. Diese Stadt vergibt zwei pro Haushalt und Jahr, ich warte seit dem Frühjahr, und im Keller steht ein Sofa, das dort seit dem Einzug im Weg steht.',
  },
  {
    id: 'wespennest',
    category: 'haushalt',
    durations: ANY,
    text: 'Unter dem Dachfirst hängt ein Wespennest von der Größe eines Fußballs, direkt über der Terrassentür. Wespen stehen unter Schutz, es kommt also erst ein Berater und danach eventuell eine Umsiedlung, und beides geht nur mit Eigentümer vor Ort.',
  },
  {
    id: 'heizoel',
    category: 'haushalt',
    durations: SHORT,
    text: 'Der Tankwagen kommt und füllt 3000 Liter Heizöl. Ich muss den Zugang freimachen, beim Befüllen dabei sein und die Grenzwertgeberprüfung unterschreiben. Der Fahrer wartet nicht, der hat danach noch sechs Adressen.',
  },
  {
    id: 'wohnungsuebergabe',
    category: 'haushalt',
    durations: SHORT,
    text: 'Wohnungsübergabe der alten Wohnung: Protokoll, Zählerstände, Schlüsselzahl. Der Vermieter bringt seinen Sohn mit, der „sich auskennt“. Wenn ich nicht dabei bin, wird jede Schramme im Haus meine Schramme.',
  },

  // ---------- Tiere ----------
  {
    id: 'katze-frisst-nicht',
    category: 'tier',
    durations: ANY,
    text: 'Meine Katze frisst seit drei Tagen nicht. Die Tierärztin hat Aufbaupaste verordnet, die ich alle vier Stunden mit einer Spritze verabreiche, dazu Gewichtskontrolle morgens und abends. Sie wiegt 3,1 Kilo, und jedes Gramm zählt gerade.',
  },
  {
    id: 'hund-kreuzband',
    category: 'tier',
    durations: MULTI,
    text: 'Mein Hund ist am Kreuzband operiert. {tage} Tage nur Leinengänge von fünf Minuten, Treppen tragen, kein Springen, kein Toben. Er wiegt 34 Kilo, ich trage ihn also mehrmals täglich, und allein lassen darf ich ihn gar nicht.',
  },
  {
    id: 'meerschweinchen',
    category: 'tier',
    durations: ANY,
    text: 'Mein Meerschweinchenbock wird kastriert und muss danach sechs Wochen von den Weibchen getrennt bleiben, weil er noch zeugungsfähig ist. Ich baue also gerade ein zweites Gehege und kontrolliere täglich die Naht.',
  },
  {
    id: 'wellensittich',
    category: 'tier',
    durations: SHORT,
    text: 'Mein Wellensittich hat sich in der Gardine verheddert und humpelt seitdem. Der vogelkundige Tierarzt hat genau einen Termin frei, und vogelkundige Tierärzte sind in dieser Gegend seltener als der Vogel selbst.',
  },
  {
    id: 'aquarium-nitrit',
    category: 'tier',
    durations: MULTI,
    text: 'Mein Aquarium hat einen Nitritpeak. Täglich 30 Prozent Wasserwechsel, messen morgens und abends, und wenn ich zwei Tage aussetze, sind 40 Fische tot. Das ist keine Übertreibung, das ist schlicht Chemie.',
  },
  {
    id: 'bienenschwarm',
    category: 'tier',
    durations: ANY,
    text: 'Mein Bienenvolk ist in Schwarmstimmung. Ich muss alle sieben Tage die Weiselzellen kontrollieren, sonst hängt der halbe Schwarm im Kirschbaum des Nachbarn, und der Nachbar hat dazu bereits eine sehr ausgeprägte Meinung.',
  },
  {
    id: 'reitbeteiligung',
    category: 'tier',
    durations: MULTI,
    text: 'Meine Reitbeteiligung ist krank geworden, und ich habe die Stalldienste für {tage} Tage komplett übernommen: morgens füttern, misten, koppeln, abends dasselbe rückwärts. Ein Pferd interessiert sich nicht für Terminkollisionen.',
  },
  {
    id: 'begleithundpruefung',
    category: 'tier',
    durations: SHORT,
    text: 'Begleithundprüfung. Wir üben seit acht Monaten, die Prüfung gibt es zweimal im Jahr, das Startgeld ist bezahlt. Wenn mein Hund den Verkehrsteil besteht, ist das der emotionale Höhepunkt meines Jahres.',
  },
  {
    id: 'schildkroete',
    category: 'tier',
    durations: ANY,
    text: 'Ich bereite meine Griechische Landschildkröte auf die Winterstarre vor. Das ist ein Ablauf über mehrere Tage mit Fastenzeit, Bad und einem Kühlschrank, der konstant vier bis sechs Grad halten muss. Verpasse ich das Zeitfenster, wird das Tier krank.',
  },
  {
    id: 'kater-abszess',
    category: 'tier',
    durations: ANY,
    text: 'Mein Kater hatte Revierstreit und trägt jetzt eine Drainage am Hals. Die Wunde muss zweimal täglich gespült werden, und er hat dazu eine sehr klare Gegenmeinung. Ich brauche pro Spülung eine zweite Person und ein dickes Handtuch.',
  },
  {
    id: 'igel',
    category: 'tier',
    durations: ANY,
    text: 'Ich habe einen untergewichtigen Igel gefunden, 380 Gramm, viel zu leicht für den Winter. Die Auffangstation ist voll, ich bin jetzt Pflegestelle: wiegen, füttern, Kot kontrollieren, Zimmertemperatur halten.',
  },
  {
    id: 'huehner-fuchs',
    category: 'tier',
    durations: ANY,
    text: 'Ein Fuchs hat sich unter unseren Hühnerzaun gegraben und zwei Hennen geholt. Bis der Untergrabschutz liegt, sitze ich abends draußen und mache die Klappe von Hand zu. Die verbliebenen fünf Hühner sind bereits sehr nervös.',
  },
  {
    id: 'papagei',
    category: 'tier',
    durations: ANY,
    text: 'Mein Graupapagei rupft sich die Brustfedern. Die Verhaltenstherapeutin für Vögel kommt zur Hausanalyse, sie ist ein Jahr im Voraus ausgebucht, und der Termin gilt nur mit anwesendem Halter.',
  },
  {
    id: 'bartagame',
    category: 'tier',
    durations: ANY,
    text: 'Die Heizung im Terrarium ist ausgefallen. Meine Bartagame braucht einen Sonnenplatz mit 40 Grad, ich überbrücke gerade mit Baustrahler und Thermostat und kontrolliere stündlich, ob die Temperatur noch stimmt.',
  },
  {
    id: 'welpe',
    category: 'tier',
    durations: MEDIUM,
    text: 'Unser Welpe zieht genau an diesem Wochenende ein. Die ersten Tage entscheiden über Stubenreinheit, Alleinbleiben und ungefähr alles Weitere, und der Züchter hat den Übergabetermin seit acht Wochen festgelegt.',
  },

  // ---------- Behörde ----------
  {
    id: 'zeugenladung',
    category: 'amt',
    durations: SHORT,
    text: 'Ich bin als Zeuge geladen, Aktenzeichen 42 Ds 118 Js 2107/26, Amtsgericht, Saal 1.14. In der Ladung steht wörtlich, dass bei unentschuldigtem Ausbleiben ein Ordnungsgeld festgesetzt und die Vorführung angeordnet werden kann.',
  },
  {
    id: 'betriebspruefung',
    category: 'amt',
    durations: MEDIUM,
    text: 'Ich habe eine Betriebsprüfung im Haus. Der Prüfer sitzt bei mir am Tisch und arbeitet sich durch 2022 bis 2024, und er stellt Fragen, die nur ich beantworten kann. Verschieben darf man das genau einmal, und das habe ich bereits getan.',
  },
  {
    id: 'buergeramt',
    category: 'amt',
    durations: SHORT,
    text: 'Termin im Bürgeramt, gebucht vor elf Wochen, weil es früher schlicht keinen gab: Ummeldung und neuer Ausweis, Passbild ist gemacht. Platzt der Termin, bin ich im nächsten Quartal dran und fahre bis dahin mit einem abgelaufenen Dokument herum.',
  },
  {
    id: 'fuehrerschein-umtausch',
    category: 'amt',
    durations: SHORT,
    text: 'Pflichtumtausch meines Führerscheins. Die Frist läuft in wenigen Tagen ab, danach droht bei jeder Kontrolle ein Verwarnungsgeld, und die Behörde vergibt Termine ausschließlich online und ausschließlich dienstags ab 8 Uhr.',
  },
  {
    id: 'wahlhelfer',
    category: 'amt',
    durations: SHORT,
    text: 'Ich bin als Wahlhelfer berufen. Anwesenheit ab 7:30 Uhr, Auszählung bis in den Abend, und ablehnen kann man eine Berufung nur aus wichtigem Grund. „Ich hätte da etwas Schöneres vor“ steht nicht auf der Liste der wichtigen Gründe.',
  },
  {
    id: 'mikrozensus',
    category: 'amt',
    durations: SHORT,
    text: 'Ich bin für den Mikrozensus gezogen worden. Das ist eine gesetzliche Auskunftspflicht mit festem Termin, und im Schreiben steht ausdrücklich, dass bei Verweigerung ein Zwangsgeld festgesetzt werden kann. Ich habe es zweimal gelesen, es wird nicht freundlicher.',
  },
  {
    id: 'tuev-nachpruefung',
    category: 'amt',
    durations: SHORT,
    text: 'Hauptuntersuchung mit Nachprüfung. Die Bremsleitung hinten rechts ist beanstandet, ich habe vier Wochen Frist für die Nachprüfung, und ohne gültige Plakette sollte das Auto eigentlich gar nicht mehr bewegt werden.',
  },
  {
    id: 'thuja-prozess',
    category: 'amt',
    durations: SHORT,
    text: 'Gerichtstermin wegen unserer Grundstücksgrenze. Es geht um eine Thuja-Hecke von 2,10 Metern, ein Ortstermin mit Sachverständigem ist bereits gescheitert, und ich muss persönlich erscheinen.',
  },
  {
    id: 'bauamt-frist',
    category: 'amt',
    durations: ANY,
    text: 'Beim Bauamt läuft meine Widerspruchsfrist ab. Ich muss eine Stellungnahme mit drei Anlagen und einem Lageplan einreichen, und die Behörde nimmt das ausschließlich schriftlich und ausschließlich fristgerecht entgegen.',
  },
  {
    id: 'anhoerungsbogen',
    category: 'amt',
    durations: ANY,
    text: 'Ich habe einen Anhörungsbogen bekommen und gehe mit meinem Anwalt die Akteneinsicht durch. Es geht um eine Messung, die angeblich 31 km/h zu viel ergeben hat, und an dieser Sache hängt meine Fahrerlaubnis.',
  },
  {
    id: 'zoll',
    category: 'amt',
    durations: SHORT,
    text: 'Mein Paket liegt beim Zoll und wird nur persönlich, gegen Ausweis und mit Originalrechnung ausgehändigt. Die Abholstelle hat drei Stunden am Tag geöffnet, und nach 14 Tagen geht die Sendung zurück an den Absender.',
  },
  {
    id: 'schiessstand',
    category: 'amt',
    durations: SHORT,
    text: 'Pflichttermin auf dem Schießstand für meinen Jagdschein. Der Nachweis muss jährlich erbracht werden, sonst ist die Verlängerung weg, und der Verein bietet diesen Termin genau viermal im Jahr an.',
  },
  {
    id: 'nachlassgericht',
    category: 'amt',
    durations: SHORT,
    text: 'Termin beim Nachlassgericht zur Beantragung des Erbscheins. Alle Miterben müssen erscheinen oder beglaubigt vertreten sein, wir sind zu fünft, und drei davon haben Wochen gebraucht, um sich auf ein Datum zu einigen.',
  },
  {
    id: 'rentenberatung',
    category: 'amt',
    durations: SHORT,
    text: 'Beratungstermin bei der Rentenversicherung zur Kontenklärung. Zwölf Wochen Vorlauf, ich habe Unterlagen bis zurück ins Jahr 1998 herausgesucht, und wenn ich absage, ist der nächste Termin frühestens im nächsten Quartal.',
  },
  {
    id: 'atemschutz',
    category: 'amt',
    durations: SHORT,
    text: 'Ich bin in der Freiwilligen Feuerwehr und habe die Belastungsübung in der Atemschutzstrecke. Die ist jährlich Pflicht, sonst verliere ich die Atemschutztauglichkeit und darf ein Jahr lang nicht mehr unter Gerät.',
  },

  // ---------- Technik ----------
  {
    id: 'serverraum',
    category: 'technik',
    durations: MEDIUM,
    text: 'Der Verein zieht seinen Serverraum um. Wir fahren alles kontrolliert herunter, bauen zwei Racks ab, und die USV ist so alt, dass sie nach dem Abschalten möglicherweise nie wieder anspringt. Ich bin der Einzige mit den Passwörtern.',
  },
  {
    id: 'techniker-fenster',
    category: 'technik',
    durations: SHORT,
    text: 'Providerwechsel, der Techniker kommt zur Schaltung. Zeitfenster 8 bis 16 Uhr, und wenn niemand da ist, wird der Auftrag storniert und ich stehe mit einer gekündigten alten und einer nicht geschalteten neuen Leitung da.',
  },
  {
    id: 'raid-rebuild',
    category: 'technik',
    durations: MULTI,
    text: 'Mein NAS macht nach einem Plattenausfall einen RAID-Rebuild. Der läuft {tage} Tage, und wenn in dieser Zeit die zweite Platte aussteigt, sind 14 Jahre Fotos weg. Ich sitze daneben und beobachte einen Fortschrittsbalken.',
  },
  {
    id: 'nachbarin-rechner',
    category: 'technik',
    durations: ANY,
    text: 'Ich richte den neuen Rechner meiner Nachbarin ein. Sie hat 40.000 Fotos auf einer alten Platte, kein Backup und eine E-Mail-Adresse von einem Anbieter, den es fast nicht mehr gibt. Ich habe zugesagt, und sie hat es bereits weitererzählt.',
  },
  {
    id: 'rollladen',
    category: 'technik',
    durations: SHORT,
    text: 'Ein Update meiner Smart-Home-Zentrale hat sämtliche Rollläden geschlossen und mich aus der Steuerung ausgesperrt. Ich sitze im Dunkeln und lese Handbücher. Meine Wohnung ist bis auf Weiteres technisch gesehen ein Tresor.',
  },
  {
    id: 'backup-restore',
    category: 'technik',
    durations: MULTI,
    text: 'Ich spiele ein Backup zurück: 4,7 Terabyte über eine Leitung mit 40 Mbit. Die Software nennt eine Restlaufzeit von {tage} Tagen, der Rechner darf nicht in den Ruhezustand, und beim letzten Abbruch ging alles wieder von vorne los.',
  },
  {
    id: 'wallbox',
    category: 'technik',
    durations: MEDIUM,
    text: 'Meine Wallbox hat einen Fehler, ich lade übergangsweise über die Schuko-Steckdose mit 10 Ampere. Das sind 38 Stunden für eine volle Ladung, und ich brauche das Auto danach dringend. Ich hänge also buchstäblich am Kabel.',
  },
  {
    id: 'drucker-langlauf',
    category: 'technik',
    durations: MEDIUM,
    text: 'Auf meinem 3D-Drucker läuft ein Druck mit 61 Stunden Laufzeit. Er darf nicht abbrechen, das Filament reicht knapp, und laut Hersteller soll das Gerät nicht unbeaufsichtigt bleiben. Ich bin diese Aufsicht.',
  },
  {
    id: 'wechselrichter',
    category: 'technik',
    durations: SHORT,
    text: 'Der Wechselrichter meiner Photovoltaikanlage wird getauscht. Der Netzbetreiber gibt ein festes Zeitfenster vor, die Anlage wird dafür freigeschaltet, und ich muss als Anlagenbetreiber vor Ort unterschreiben.',
  },
  {
    id: 'displaytausch',
    category: 'technik',
    durations: MULTI,
    text: 'Mein Handy ist in der Reparatur, Displaytausch, die Werkstatt behält es {tage} Tage. Ich bin so lange nur über Festnetz erreichbar, und Kalender, Tickets und Bankfreigaben stecken alle in diesem Gerät.',
  },
  {
    id: 'bank-zweiter-faktor',
    category: 'technik',
    durations: SHORT,
    text: 'Meine Bank hat mich nach einem Gerätewechsel aus dem Online-Banking ausgesperrt. Die Freischaltung geht nur persönlich in der Filiale mit Ausweis, und die Filiale öffnet an drei Tagen die Woche bis 16 Uhr.',
  },
  {
    id: 'drohnenpruefung',
    category: 'technik',
    durations: SHORT,
    text: 'Prüfung für den EU-Drohnenführerschein A2. Termin und Prüfstelle sind fest gebunden, ich habe 40 Fragen vor mir, und ohne A2 darf ich beruflich nicht mehr fliegen.',
  },
  {
    id: 'videokassetten',
    category: 'technik',
    durations: LONG,
    text: 'Ich digitalisiere 46 alte Videokassetten. Das geht nur in Echtzeit, der Rekorder frisst gelegentlich ein Band, und ich muss daneben sitzen, um sofort stoppen zu können. Es sind Familienaufnahmen, die es genau einmal gibt.',
  },
  {
    id: 'datenschutzanfrage',
    category: 'technik',
    durations: ANY,
    text: 'Der Verein hat mich zum Datenschutzbeauftragten gemacht, und wir haben eine Betroffenenanfrage. Ab Eingang läuft eine Frist von einem Monat, wir sind in der letzten Woche, und das Löschkonzept muss vorher stehen.',
  },

  // ---------- Beruf ----------
  {
    id: 'rufbereitschaft',
    category: 'beruf',
    durations: DATED,
    text: 'Ich habe für {zeitraum} Rufbereitschaft mit 15 Minuten Reaktionszeit eingetragen. Es gibt keinen Tauschpartner, und 15 Minuten sind exakt so bemessen, dass man in dieser Zeit gar nichts unternehmen kann.',
  },
  {
    id: 'inventur',
    category: 'beruf',
    durations: SHORT,
    text: 'Inventur in der Filiale: Zählteams, Stichprobenprüfung durch die Revision, und niemand geht nach Hause, bevor die Differenzenliste unter einem Prozent liegt. Erfahrungsgemäß tut sie das gegen Mitternacht.',
  },
  {
    id: 'betriebsrat-schulung',
    category: 'beruf',
    durations: LONG,
    text: 'Betriebsratsschulung, {tage} Tage mit Anwesenheitspflicht und Teilnahmebestätigung. Die Freistellung ist beschlossen, das Seminar ist bezahlt, und wer nicht erscheint, verliert den Platz für zwei Jahre.',
  },
  {
    id: 'jahresabschluss',
    category: 'beruf',
    durations: MEDIUM,
    text: 'Der Wirtschaftsprüfer sitzt bei uns im Haus. Er stellt seine Fragen an genau eine Person, und das bin ich, weil ich die Buchungen der zweiten Jahreshälfte gemacht habe. An diesen Tagen hängt das Testat.',
  },
  {
    id: 'messeaufbau',
    category: 'beruf',
    durations: MEDIUM,
    text: 'Messeaufbau, Halle 6, Stand C41. Die Aufbauzeiten gibt der Veranstalter fest vor, die Standbaufirma arbeitet nach Plan, und ich muss die Technik abnehmen, bevor die Halle geschlossen wird.',
  },
  {
    id: 'ersthelfer',
    category: 'beruf',
    durations: SHORT,
    text: 'Ersthelfer-Auffrischung, neun Unterrichtseinheiten mit Anwesenheitsliste. Der Betrieb braucht eine Mindestzahl ausgebildeter Ersthelfer, und ich bin einer davon. Ohne die Auffrischung fällt der Nachweis für die Berufsgenossenschaft.',
  },
  {
    id: 'doppelschicht',
    category: 'beruf',
    durations: SHORT,
    text: 'Ein Kollege ist ausgefallen und ich habe seine Schicht übernommen. Das ergibt eine Doppelschicht von rund 16 Stunden, und ich werde danach ehrlicherweise zu überhaupt nichts mehr zu gebrauchen sein.',
  },
  {
    id: 'bueroumzug',
    category: 'beruf',
    durations: MEDIUM,
    text: 'Unser Büro zieht in den vierten Stock: Aktenvernichtung mit Protokoll, Server umziehen, und jede Kiste braucht ein Etikett mit Kostenstelle. Ich habe die Umzugsliste geschrieben und darf sie deshalb auch abarbeiten.',
  },
  {
    id: 'nachtschicht',
    category: 'beruf',
    durations: LONG,
    text: 'Ich habe {tage} Tage Nachtschicht, jeweils von 22 bis 6 Uhr. Ich schlafe tagsüber mit Ohrstöpseln und Verdunkelung, und wer mich in dieser Zeit weckt, bekommt einen sehr unfreundlichen Menschen zu sehen.',
  },
  {
    id: 'firmenjubilaeum',
    category: 'beruf',
    durations: SHORT,
    text: 'Firmenjubiläum, 25 Jahre. Die Teilnahme ist offiziell freiwillig, und wir alle wissen, was das bedeutet. Am Eingang liegt eine Anwesenheitsliste, und sie wird ausgewertet.',
  },
  {
    id: 'jahreshauptversammlung',
    category: 'beruf',
    durations: SHORT,
    text: 'Jahreshauptversammlung mit Kassenprüfung. Ich bin im Vorstand, muss den Bericht vortragen und mich entlasten lassen. Ohne Entlastung hafte ich weiter persönlich, und so viel ist mir kein Abend wert.',
  },
  {
    id: 'pruefungsaufsicht',
    category: 'beruf',
    durations: SHORT,
    text: 'Ich habe Prüfungsaufsicht bei der IHK. Die Zuteilung ist verbindlich, ich sitze fünf Stunden in einem Saal mit 120 Prüflingen und darf in dieser Zeit weder ans Handy noch aus dem Raum.',
  },
  {
    id: 'feuerwehr-uebung',
    category: 'beruf',
    durations: MEDIUM,
    text: 'Übungswochenende der Feuerwehr mit Einsatzübung, Fahrzeugkunde und Nachtalarm. Ich bin Maschinist, ohne mich fährt das Fahrzeug nicht, und der Übungsplan hängt seit Januar am schwarzen Brett.',
  },
  {
    id: 'zertifizierung',
    category: 'beruf',
    durations: MULTI,
    text: 'Pflichtfortbildung für meine Zertifizierung, mit Anwesenheitsliste und Abschlusstest. Mir fehlen in diesem Zyklus noch 16 Punkte, das ist die letzte Gelegenheit, und ohne die Punkte ruht die Zulassung.',
  },
  {
    id: 'verwendungsnachweis',
    category: 'beruf',
    durations: ANY,
    text: 'Für unser Förderprojekt läuft der Verwendungsnachweis. Alle Belege müssen eingereicht sein, und die Frist ist eine Ausschlussfrist: einen Tag zu spät, und wir zahlen 40.000 Euro zurück. Ich habe die Belege, also habe ich das Problem.',
  },

  // ---------- Höhere Gewalt ----------
  {
    id: 'steuerkette',
    category: 'schicksal',
    durations: MULTI,
    text: 'Die Steuerkette meines Autos ist gelängt, die Werkstatt behält den Wagen {tage} Tage. Der letzte Ersatzwagen war schon weg, und mit dem Bus bin ich für die Strecke drei Stunden pro Richtung unterwegs.',
  },
  {
    id: 'schienenersatz',
    category: 'schicksal',
    durations: SHORT,
    text: 'Meine Verbindung fällt aus, es gibt Schienenersatzverkehr mit zweimal Umsteigen und einer Umsteigezeit von vier Minuten, die selbst die Bahn als „nicht garantiert“ ausweist. Ich stünde mit hoher Wahrscheinlichkeit nachts in Fulda.',
  },
  {
    id: 'gully',
    category: 'schicksal',
    durations: SHORT,
    text: 'Mein Schlüsselbund ist beim Aussteigen in einen Gully gefallen. Der Schlüsseldienst kommt, die Stadtreinigung muss den Rost heben, und bis dahin komme ich in meine eigene Wohnung nicht hinein.',
  },
  {
    id: 'katzenwochenstube',
    category: 'schicksal',
    durations: ANY,
    text: 'Die Katze der Nachbarn hat sich in meinem Schlafzimmerschrank eingenistet und dort vier Junge bekommen. Die Tierärztin sagt, man darf sie in den ersten Tagen nicht bewegen. Mein Schlafzimmer ist bis auf Weiteres eine Wochenstube.',
  },
  {
    id: 'spedition-kommode',
    category: 'schicksal',
    durations: SHORT,
    text: 'Die Spedition hat mir die falsche Kommode geliefert: 214 Kilo Massivholz, mitten im Wohnzimmer. Abholung nur mit anwesendem Empfänger und nur an dem Tag, den die Spedition nennt, und die Spedition nennt genau diesen Tag.',
  },
  {
    id: 'sauerteig',
    category: 'schicksal',
    durations: ANY,
    text: 'Mein Sauerteig heißt Herbert, ist neun Jahre alt und muss alle zwölf Stunden gefüttert werden. Meine einzige zuverlässige Sitterin ist im Urlaub. Herbert hat zwei Umzüge und eine Trennung überlebt, an mir wird er nicht scheitern.',
  },
  {
    id: 'unfallzeuge',
    category: 'schicksal',
    durations: SHORT,
    text: 'Ich bin Zeuge eines Auffahrunfalls geworden und muss meine Aussage noch zu Protokoll geben. Die Dienststelle hat mir einen festen Termin gegeben, und ich bin der einzige unbeteiligte Zeuge.',
  },
  {
    id: 'altpapier',
    category: 'schicksal',
    durations: SHORT,
    text: 'Ich habe beim Aufräumen versehentlich meine Brieftasche mit Ausweis, Karten und Führerschein in den Altpapiercontainer geworfen. Die Entleerung ist erst am Donnerstag, und bis dahin bewache ich im Grunde einen Container.',
  },
  {
    id: 'strangsanierung',
    category: 'schicksal',
    durations: DATED,
    text: 'Der Vermieter hat für {zeitraum} das Wasser abgestellt, Strangsanierung. Die Handwerker brauchen Zugang zu Bad und Küche, und in der Ankündigung steht ausdrücklich, dass die Wohnung während der Arbeiten zugänglich sein muss.',
  },
  {
    id: 'sternwarte',
    category: 'schicksal',
    durations: SHORT,
    text: 'Unsere Astronomie-AG hat für diese Nacht die einzige klare Prognose des Quartals, und das Teleskop ist nur für diesen einen Termin reserviert. Ich beobachte seit 14 Monaten denselben Bedeckungsveränderlichen.',
  },
  {
    id: 'wohnungsbesichtigung',
    category: 'schicksal',
    durations: SHORT,
    text: 'Ich habe eine Einladung zur Wohnungsbesichtigung um 14 Uhr, gemeinsam mit 87 anderen Interessenten. Wer nicht erscheint, fällt raus, und ich suche seit sieben Monaten. Das ist mir gerade wichtiger als alles andere.',
  },
  {
    id: 'zug-gestrandet',
    category: 'schicksal',
    durations: ANY,
    text: 'Ich bin unterwegs gestrandet: Anschluss verpasst, Ersatzhotel, morgen früh Fahrgastrechteformular. Ich bin ungefähr 400 Kilometer von dort entfernt, wo ich sein wollte, und der nächste Zug fährt um 5:41 Uhr.',
  },
  {
    id: 'waschbaer',
    category: 'schicksal',
    durations: ANY,
    text: 'In unserem Kamin sitzt ein Waschbär. Er ist geschützt, wir dürfen ihn nicht vergrämen, solange Jungtiere möglich sind, und bis der Fachbetrieb kommt, darf niemand den Ofen anmachen und niemand die Klappe öffnen.',
  },
  {
    id: 'gasgeruch',
    category: 'schicksal',
    durations: SHORT,
    text: 'Die Feuerwehr hat unsere Straße wegen Gasgeruchs gesperrt. Niemand kommt raus, niemand kommt rein, und der Einsatzleiter sagt, es kann noch Stunden dauern. Ich sitze in meiner eigenen Wohnung fest.',
  },
  {
    id: 'notrufarmband',
    category: 'schicksal',
    durations: ANY,
    text: 'Meine Nachbarin ist 88, und ihr Notrufarmband hat den Geist aufgegeben. Bis der Dienst ein neues bringt, schaue ich dreimal täglich nach ihr: morgens, mittags, abends. Sie zählt mit.',
  },
]);

const PLACEHOLDER_PATTERN = /\{(tage|zeitraum|start|ende)\}/g;

function localDayStart(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// The visible German day count, not the raw duration: a LAN from Friday
// evening to Sunday morning is "3 Tage" to everyone involved, and that is the
// number an excuse has to cover. Mirrors what eventDateRange() prints.
function calendarDaySpan(startsAt, endsAt) {
  return Math.round((localDayStart(endsAt) - localDayStart(startsAt)) / DAY_MS) + 1;
}

function shortDate(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`;
}

// Everything an excuse text may need about the absence it has to cover.
// An event whose date is still being polled has no period at all, which is
// exactly what the `unknown` bucket exists for.
export function eventExcuseProfile(event) {
  const startsAt = Number(event?.startsAt);
  const endsAt = Number(event?.endsAt);
  const dated =
    event?.startsAt != null &&
    event?.endsAt != null &&
    Number.isFinite(startsAt) &&
    Number.isFinite(endsAt) &&
    endsAt > startsAt;
  if (!dated) return { duration: 'unknown', days: null, start: null, end: null, range: null };

  const days = calendarDaySpan(startsAt, endsAt);
  // Under 24 hours is an evening even when it crosses midnight; from there the
  // German day count decides between a weekend and a genuinely long absence.
  const duration = endsAt - startsAt < DAY_MS ? 'short' : days <= 3 ? 'medium' : 'long';
  const start = shortDate(startsAt);
  const end = shortDate(endsAt);
  // A single-day event would otherwise print "12.09. – 12.09.", which reads as
  // a copy-paste mistake in the middle of an excuse that is supposed to sound
  // like it was written by a person.
  return { duration, days, start, end, range: start === end ? start : `${start} – ${end}` };
}

export function excuseCategoryLabel(categoryId) {
  return EXCUSE_CATEGORIES.find((category) => category.id === categoryId)?.label ?? 'Sonstiges';
}

function hasDatePlaceholder(text) {
  PLACEHOLDER_PATTERN.lastIndex = 0;
  return PLACEHOLDER_PATTERN.test(text);
}

// The pool for one event. `unknown` is not a declared bucket: without a period
// no placeholder can be filled honestly, so that case offers every entry whose
// text works without dates at all.
export function eventExcusePool(event, { category = 'alle' } = {}) {
  const { duration } = eventExcuseProfile(event);
  return EVENT_EXCUSES.filter((entry) => {
    if (category !== 'alle' && entry.category !== category) return false;
    return duration === 'unknown' ? !hasDatePlaceholder(entry.text) : entry.durations.includes(duration);
  });
}

export function fillExcuseText(text, profile) {
  return String(text).replace(PLACEHOLDER_PATTERN, (_match, name) => {
    if (name === 'tage') return profile?.days == null ? 'mehrere' : String(profile.days);
    if (name === 'zeitraum') return profile?.range ?? 'diesen Zeitraum';
    if (name === 'start') return profile?.start ?? 'jetzt';
    return profile?.end ?? 'auf Weiteres';
  });
}

// The gag's own logic, and the user-facing promise of the dialog: length plus
// concrete numbers (dosages, file numbers, times) are what make an excuse
// sound true, so that is literally what gets scored. 1 to 5.
export function excuseCredibility(text) {
  const value = String(text ?? '');
  const numbers = value.match(/\d+/g)?.length ?? 0;
  return Math.min(5, Math.max(1, Math.round(value.length / 70 + numbers * 0.6)));
}

// Draws one excuse, avoiding the ids in `recentIds` while the remaining pool
// still offers an alternative — pressing "Neue Ausrede" twice should not
// return the same story. `random` is injectable so tests stay deterministic.
export function pickEventExcuse(event, { category = 'alle', recentIds = [], random = Math.random } = {}) {
  const pool = eventExcusePool(event, { category });
  if (pool.length === 0) return null;
  const unseen = pool.filter((entry) => !recentIds.includes(entry.id));
  const candidates = unseen.length > 0 ? unseen : pool;
  const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)));
  const entry = candidates[index];
  const text = fillExcuseText(entry.text, eventExcuseProfile(event));
  return { id: entry.id, category: entry.category, text, credibility: excuseCredibility(text) };
}
