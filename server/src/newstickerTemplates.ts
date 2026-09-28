// Text building blocks for the Broadcast newsticker (see newsticker.ts).
// Every line is a friendly, obviously exaggerated joke about the party
// itself: no remarks about looks, weak skill, health or private life, since
// the ticker names real people on a shared screen. Templates only receive
// display names and game names; they never see other personal data.

export interface NewsRandom {
  /** Uniform float in [0, 1). */
  next(): number;
}

export function pick<T>(rng: NewsRandom, list: readonly T[]): T {
  return list[Math.floor(rng.next() * list.length)];
}

export function between(rng: NewsRandom, min: number, max: number): number {
  return min + Math.floor(rng.next() * (max - min + 1));
}

// Things a player can supposedly have collected, built or consumed.
export const THINGS = [
  'Energydrinks',
  'Tüten Chips',
  'Pizzastücke',
  'Gummibärchen',
  'Kaffeetassen',
  'Rage-Quits',
  'Headshots',
  'Mausklicks',
  'Taktikbesprechungen',
  'Pausen „nur kurz“',
  'Screenshots',
  'Lobby-Neustarts',
  'Kabelsalate',
  'Siegerposen',
  'Revanche-Anfragen',
  'Tastatur-Schläge',
  'Lüfter-Umdrehungen',
  'Ausreden',
  'Strategiewechsel',
  'Spielstände',
  'Mikrofon-Checks',
  'Treppenwitze',
  'Tabs im Browser',
  'Patchnotes',
  'Nachladepausen',
  'Siegerlächeln',
  'Nachschlag-Pizzen',
  'Ersatzbatterien',
  'Controller-Wechsel',
  'Teamrufe',
  'Strategiezettel',
  'Mauspad-Wischer',
  'Lobby-Einladungen',
  'Glückssocken',
  'Replays',
] as const;

// Closing remarks appended to an otherwise plain statement.
export const PUNCHLINES = [
  'Experten sprechen von einer neuen Ära.',
  'Die Konkurrenz fordert eine Dopingkontrolle.',
  'Die Nachbarn am Tisch sind beeindruckt.',
  'Ein Statement wird noch erwartet.',
  'Die Orga prüft eine Ehrenurkunde.',
  'Augenzeugen berichten von Gänsehaut.',
  'Das Internet ist schuld, sagt die Person selbst.',
  'Ein Denkmal ist in Planung.',
  'Die Schiedsrichter schauen sich die Wiederholung an.',
  'Fans fordern eine Autogrammstunde.',
  'Die Statistikabteilung rechnet noch nach.',
  'Niemand hat damit gerechnet, außer der Person selbst.',
  'Das Headset hat angeblich alles gehört.',
  'Die Chips-Vorräte sinken bedenklich.',
  'Historiker werden davon erzählen.',
  'Die Stimmung im Raum: elektrisiert.',
  'Die Revanche ist bereits angekündigt.',
  'Es war laut Aussage „alles geplant“.',
  'Der Lüfter des Rechners applaudiert.',
  'Die Kaffeemaschine läuft auf Hochtouren.',
  'Die Pressestelle bittet um Geduld.',
  'Beobachter sprechen von purer Eleganz.',
  'Eine Dokumentation ist in Arbeit.',
  'Die Ranglisten zittern.',
  'Es soll eine Taktik aus dem Jahr 2004 gewesen sein.',
  'Die Pizza wurde vor Aufregung kalt.',
  'Kommentatoren sind sprachlos.',
  'Der Tisch vibriert noch immer.',
  'Man munkelt von einem Geheimtraining.',
  'Die Sitznachbarn verlangen Unterricht.',
  'Die Sitzplatzordnung wird überdacht.',
  'Ein Fanschal ist bereits in Arbeit.',
  'Die Konkurrenz trainiert jetzt heimlich nachts.',
  'Der Router zeigt sich unbeeindruckt.',
  'Selbst die Kaffeetasse nickt anerkennend.',
  'Die Orga prüft, ob das erlaubt war.',
  'Ein Sonderapplaus liegt in der Luft.',
  'Die Chips wurden sicherheitshalber nachgefüllt.',
  'Das Publikum verlangt eine Zugabe.',
  'Die Nachbartische recken die Hälse.',
  'Es riecht nach einem neuen Spitznamen.',
  'Der Moment wurde natürlich nicht aufgenommen.',
  'Die Legende wächst mit jeder Runde.',
  'Die Taktikabteilung macht sich Notizen.',
  'Man spricht bereits von einer Trilogie.',
] as const;

// Adverbs and settings that color a fallback statement.
export const MANNERS = [
  'mit geschlossenen Augen',
  'nur mit der linken Hand',
  'während eines Snacks',
  'ohne ein einziges Wort',
  'mit beeindruckender Ruhe',
  'im Stehen',
  'mit einer Hand am Kaffee',
  'kurz nach dem Aufwachen',
  'unter lautem Jubel',
  'mit voller Konzentration',
  'nebenbei beim Musik-Wünschen',
  'in Rekordzeit',
  'mit einem Lächeln',
  'streng nach Plan',
  'völlig unerwartet',
  'mit Sonnenbrille',
  'im Halbschlaf',
  'mit einem Keks im Mund',
  'ganz ohne Kopfhörer',
  'während eines Telefonats',
  'mit maximaler Lässigkeit',
  'unter den Augen der Orga',
  'nach einer kurzen Dehnübung',
] as const;

// Fake achievement titles for the headline form.
export const TITLES = [
  'Taktik-Legende',
  'Snack-Stratege',
  'Comeback-König',
  'Lobby-Diplomat',
  'Headshot-Poet',
  'Nachtschicht-Held',
  'Ruhepol des Tisches',
  'Meister der Revanche',
  'Pausen-Philosoph',
  'Joker der Runde',
  'Sieger der Herzen',
  'Kabel-Magier',
  'Pizza-Diplomat',
  'Lag-Überlebender',
  'Chips-Botschafter',
  'Stratege der Nacht',
  'Held der Hinterbank',
  'Meister des Timings',
] as const;

// Used only when the event has no catalog games at all.
export const FALLBACK_GAMES = [
  'Counter-Strike 2',
  'Age of Empires II',
  'Rocket League',
  'Warcraft III',
  'Trackmania',
  'Minecraft',
  'Mario Kart',
  'StarCraft II',
] as const;

export interface FallbackContext {
  player: string;
  other: string;
  game: string;
  rng: NewsRandom;
}

export interface NewsTemplate<C> {
  id: string;
  icon: string;
  render(ctx: C): string;
}

const n = (rng: NewsRandom, min: number, max: number) => between(rng, min, max);

// Fallback lines combine a real participant with a catalog game. Each has
// its own id so the ticker can keep recently used forms out of rotation.
export const FALLBACK_TEMPLATES: readonly NewsTemplate<FallbackContext>[] = [
  { id: 'fb-things', icon: 'gamepad', render: ({ player, game, rng }) => `${player} hat in ${game} ${n(rng, 3, 99)} ${pick(rng, THINGS)} gesammelt. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-manner', icon: 'sparkles', render: ({ player, game, rng }) => `${player} gewinnt eine Runde ${game} ${pick(rng, MANNERS)}. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-title', icon: 'award', render: ({ player, game, rng }) => `${player} trägt ab sofort den Titel „${pick(rng, TITLES)}“ in ${game}. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-duel', icon: 'swords', render: ({ player, other, game, rng }) => `${player} fordert ${other} zu einem Duell in ${game} heraus. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-rematch', icon: 'swords', render: ({ player, other, game, rng }) => `${other} verlangt nach der letzten Runde ${game} eine Revanche von ${player}. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-training', icon: 'activity', render: ({ player, game, rng }) => `Insider berichten: ${player} trainiert ${game} seit ${n(rng, 2, 9)} Wochen heimlich im Keller. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-strategy', icon: 'lightbulb', render: ({ player, game, rng }) => `${player} hat in ${game} eine völlig neue Strategie erfunden und nennt sie „Plan ${pick(rng, ['B', 'C', 'Z', 'Omega', 'Pizza'])}“. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-snack', icon: 'pizza', render: ({ player, game, rng }) => `${player} spielt ${game} angeblich besser mit ${pick(rng, ['Chips', 'Gummibärchen', 'Pizza', 'Kaffee', 'Keksen'])} in Reichweite. Eine Studie ist beantragt.` },
  { id: 'fb-coach', icon: 'users', render: ({ player, other, game, rng }) => `${other} nimmt bei ${player} Nachhilfe in ${game}. Der Stundensatz: ${n(rng, 1, 5)} ${pick(rng, ['Tüten Chips', 'Energydrinks', 'Pizzastücke', 'Kekse'])}.` },
  { id: 'fb-record', icon: 'flame', render: ({ player, game, rng }) => `Neuer inoffizieller Rekord: ${player} schafft in ${game} ${n(rng, 7, 250)} ${pick(rng, THINGS)} in einer Runde. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-comeback', icon: 'sparkles', render: ({ player, game, rng }) => `${player} dreht in ${game} ein fast verlorenes Spiel ${pick(rng, MANNERS)}. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-alliance', icon: 'users', render: ({ player, other, game, rng }) => `${player} und ${other} schmieden in ${game} eine Allianz. Beobachter rechnen mit Verrat vor ${pick(rng, ['Mitternacht', 'dem Frühstück', 'der nächsten Pizza', 'Sonnenaufgang', 'der nächsten Pause'])}.` },
  { id: 'fb-interview', icon: 'messageSquare', render: ({ player, game, rng }) => `Im Interview über ${game} sagt ${player}: „${pick(rng, ['Ich habe nur auf die Minimap geschaut.', 'Das war reine Übung.', 'Ehrlich gesagt, ich weiß es selbst nicht.', 'Kein Kommentar, erst nach der Pizza.', 'Man muss einfach an sich glauben.'])}“` },
  { id: 'fb-lag', icon: 'globe', render: ({ player, game, rng }) => `${player} erklärt die letzte Runde ${game} offiziell zum Lag. ${pick(rng, ['Das WLAN weist alle Vorwürfe zurück.', 'Der Router schweigt.', 'Die Technik-Abteilung ermittelt.', 'Das Netzwerkkabel bestreitet alles.'])}` },
  { id: 'fb-setup', icon: 'monitor', render: ({ player, game, rng }) => `${player} hat für ${game} den Monitor um ${n(rng, 2, 15)} Grad gedreht. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-crowd', icon: 'megaphone', render: ({ player, game, rng }) => `Am Tisch bildet sich eine Traube: Alle wollen sehen, wie ${player} ${game} spielt. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-legend', icon: 'crown', render: ({ player, game, rng }) => `Legende besagt: Wer ${player} in ${game} schlägt, bekommt ${n(rng, 1, 3)} ${pick(rng, ['Ehrenrunden', 'Pizzastücke', 'Gummibärchen', 'Sonderapplaus'])}. Bisher hat es niemand versucht.` },
  { id: 'fb-prediction', icon: 'eye', render: ({ player, other, game, rng }) => `Die Glaskugel der Orga sagt voraus: ${player} schlägt ${other} heute noch in ${game}. Trefferquote der Kugel: ${n(rng, 12, 97)} Prozent.` },
  { id: 'fb-soundtrack', icon: 'music', render: ({ player, game, rng }) => `${player} spielt ${game} nur noch mit epischer Filmmusik im Ohr. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-rules', icon: 'clipboard', render: ({ player, game, rng }) => `${player} schlägt eine neue Hausregel für ${game} vor: ${pick(rng, ['Wer verliert, holt Getränke.', 'Jeder Sieg braucht eine Siegerpose.', 'Pause nur nach drei Runden.', 'Der Sieger wählt die Musik.'])} Die Orga berät.` },
  { id: 'fb-scout', icon: 'search', render: ({ player, game, rng }) => `Profi-Scouts wurden gesichtet, als ${player} ${game} spielte. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-debate', icon: 'messageSquare', render: ({ player, other, game, rng }) => `${player} und ${other} streiten seit ${between(rng, 10, 90)} Minuten über die beste Taktik in ${game}. Ein Ende ist nicht in Sicht.` },
  { id: 'fb-calm', icon: 'shield', render: ({ player, game, rng }) => `${player} bleibt in ${game} selbst in der hektischsten Situation völlig ruhig. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-marathon', icon: 'timer', render: ({ player, game, rng }) => `${player} kündigt einen ${game}-Marathon über ${n(rng, 2, 12)} Stunden an. Die Snackabteilung ist informiert.` },
  { id: 'fb-mvp', icon: 'trophy', render: ({ player, game, rng }) => `Die Jury kürt ${player} zum MVP der letzten Runde ${game}. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-secret', icon: 'key', render: ({ player, game, rng }) => `${player} verrät das Geheimnis zum Erfolg in ${game}: „${pick(rng, ['Einfach nicht verlieren.', 'Immer genug Snacks.', 'Nie ohne Plan B.', 'Ruhig bleiben, dann angreifen.', 'Die Minimap ist dein Freund.'])}“ Die Fachwelt ist gespalten.` },
  { id: 'fb-team', icon: 'users', render: ({ player, other, game, rng }) => `${player} will für ${game} nur noch mit ${other} ins Team. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-tutorial', icon: 'library', render: ({ player, game, rng }) => `${player} hat das Tutorial von ${game} ${n(rng, 2, 6)} Mal gespielt. Aus Respekt, sagt die Person.` },
  { id: 'fb-breaking', icon: 'radioTower', render: ({ player, game, rng }) => `Breaking: ${player} startet ${game} und alle Lüfter im Raum werden ${pick(rng, ['leiser', 'lauter', 'nervös', 'ehrfürchtig'])}.` },
  { id: 'fb-fanclub', icon: 'thumbsUp', render: ({ player, game, rng }) => `Ein ${game}-Fanclub für ${player} wurde gegründet. Mitglieder: ${n(rng, 2, 14)}. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-weather', icon: 'globe', render: ({ player, game, rng }) => `Wetterbericht vom Tisch: Bei ${player} gibt es heute ${pick(rng, ['Siegesserien', 'leichte Comebacks', 'starke Taktikfronten', 'vereinzelte Headshots'])} in ${game}.` },
  { id: 'fb-hardware', icon: 'laptop', render: ({ player, game, rng }) => `${player} schwört, ${pick(rng, ['die neue Maus', 'das Glücks-Headset', 'der neue Stuhl', 'die Tastatur mit RGB'])} bringe in ${game} mindestens ${between(rng, 2, 30)} Prozent mehr Glück.` },
  { id: 'fb-nap', icon: 'clock', render: ({ player, game, rng }) => `${player} hat nach ${n(rng, 2, 7)} Runden ${game} ein Powernap angekündigt. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-challenge', icon: 'flag', render: ({ player, other, game, rng }) => `Offene Herausforderung: ${other} will ${player} in ${game} vor ${pick(rng, ['Mitternacht', 'dem Frühstück', 'der nächsten Pizza', 'Sonnenaufgang'])} besiegen.` },
  { id: 'fb-history', icon: 'calendar', render: ({ player, game, rng }) => `Heute vor ${n(rng, 3, 20)} Jahren hat ${player} zum ersten Mal ${game} gespielt, behauptet die Person jedenfalls.` },
  { id: 'fb-applause', icon: 'megaphone', render: ({ player, game, rng }) => `Applaus am Tisch: ${player} gelingt in ${game} ein Zug ${pick(rng, MANNERS)}.` },
  { id: 'fb-dice', icon: 'dice', render: ({ player, other, game, rng }) => `Beim Würfeln um die Teamwahl in ${game} gewinnt ${player} gegen ${other} mit einer ${n(rng, 4, 6)}. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-quote', icon: 'messageSquare', render: ({ player, other, game, rng }) => `Zitat des Tages von ${other} über ${player} in ${game}: „${pick(rng, ['Das habe ich so noch nie gesehen.', 'Wie hat das funktioniert?', 'Ich will das auch können.', 'Das war einfach Kunst.', 'Bitte nochmal in Zeitlupe.'])}“` },
  { id: 'fb-routine', icon: 'listChecks', render: ({ player, game, rng }) => `${player} verrät die Routine vor jeder Runde ${game}: ${pick(rng, ['Dehnen, Snack, Fokus.', 'Einmal tief durchatmen.', 'Glücks-Headset aufsetzen.', 'Kurz die Playlist wechseln.'])} ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-stream', icon: 'monitorPlay', render: ({ player, game, rng }) => `Zuschauer am Nachbartisch schauen ${player} bei ${game} zu wie bei einem Livestream. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-anthem', icon: 'music', render: ({ player, game, rng }) => `Für ${player} läuft ab sofort eine eigene Hymne, sobald ${game} startet. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-bet', icon: 'dice', render: ({ player, other, game, rng }) => `${other} wettet ${n(rng, 1, 5)} ${pick(rng, ['Gummibärchen', 'Pizzastücke', 'Energydrinks', 'Kekse'])}, dass ${player} die nächste Runde ${game} gewinnt. Die Quoten schwanken.` },
  { id: 'fb-bodyguard', icon: 'shield', render: ({ player, other, game }) => `${other} bewacht in ${game} ab sofort ausschließlich ${player}. Die Gegner sind verwirrt.` },
  { id: 'fb-cheer', icon: 'megaphone', render: ({ player, game, rng }) => `Sprechchöre am Tisch: „${player}! ${player}!“ Grund ist eine Szene in ${game} ${pick(rng, MANNERS)}.` },
  { id: 'fb-coffee', icon: 'clock', render: ({ player, game, rng }) => `${player} hat vor der nächsten Runde ${game} die ${n(rng, 2, 7)}. Tasse Kaffee geholt. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-commentary', icon: 'radioTower', render: ({ player, game, rng }) => `Live-Kommentar aus ${game}: „${player} ${pick(rng, ['greift an', 'wartet ab', 'täuscht links an', 'plant etwas Großes', 'ist nicht zu stoppen'])}!“ ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-delegation', icon: 'users', render: ({ player, other, game, rng }) => `Eine Delegation um ${other} besucht ${player}, um die ${game}-Taktik zu studieren. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-doc', icon: 'monitorPlay', render: ({ player, game, rng }) => `Arbeitstitel der geplanten Doku: „${player} und das Geheimnis von ${game}“. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-exam', icon: 'clipboard', render: ({ player, game, rng }) => `${player} besteht die inoffizielle ${game}-Prüfung mit der Note ${pick(rng, ['1+', '1', 'Eins mit Sternchen', 'ausgezeichnet'])}. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-fanmail', icon: 'messageSquare', render: ({ player, game, rng }) => `${player} hat nach der letzten Runde ${game} ${n(rng, 2, 25)} Nachrichten von Fans bekommen. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-handshake', icon: 'thumbsUp', render: ({ player, other, game, rng }) => `Fairplay-Moment in ${game}: ${player} und ${other} geben sich nach der Runde die Hand. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-headline', icon: 'flame', render: ({ player, game, rng }) => `Schlagzeile des Abends: „${player} ${pick(rng, ['überrascht alle', 'bleibt unbesiegbar', 'dreht auf', 'zeigt Nerven aus Stahl'])} in ${game}“. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-hydrate', icon: 'timer', render: ({ player, game }) => `Service-Meldung: ${player} erinnert nach einer Runde ${game} alle ans Wassertrinken. Die Orga ist gerührt.` },
  { id: 'fb-mentor', icon: 'library', render: ({ player, other, game, rng }) => `${player} wird offiziell ${game}-Mentor von ${other}. Erste Lektion: ${pick(rng, ['Ruhe bewahren.', 'Immer Snacks bereithalten.', 'Nie ohne Plan.', 'Die Karte lesen.'])}` },
  { id: 'fb-mystery', icon: 'eye', render: ({ player, game, rng }) => `Rätsel des Abends: Wie macht ${player} das in ${game} nur? ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-poll', icon: 'chart', render: ({ player, game, rng }) => `Blitzumfrage am Tisch: ${n(rng, 51, 99)} Prozent halten ${player} für den Geheimfavoriten in ${game}.` },
  { id: 'fb-promise', icon: 'flag', render: ({ player, game, rng }) => `${player} verspricht für die nächste Runde ${game} ${pick(rng, ['eine Überraschung', 'volle Offensive', 'absolute Ruhe', 'eine neue Taktik'])}. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-rivalry', icon: 'swords', render: ({ player, other, game, rng }) => `Die große Rivalität ${player} gegen ${other} in ${game} geht in Runde ${n(rng, 2, 12)}. ${pick(rng, PUNCHLINES)}` },
  { id: 'fb-snackdeal', icon: 'pizza', render: ({ player, other, game }) => `${player} tauscht mit ${other} ein Pizzastück gegen einen ${game}-Tipp. Beide halten den Deal für gewonnen.` },
  { id: 'fb-warmup', icon: 'activity', render: ({ player, game, rng }) => `${player} macht vor ${game} ${n(rng, 3, 20)} Minuten Aufwärmübungen für die Finger. ${pick(rng, PUNCHLINES)}` },
];

export interface MatchContext {
  winners: string;
  losers: string;
  game: string;
  score: string | null;
  rng: NewsRandom;
}

export const MATCH_TEMPLATES: readonly NewsTemplate<MatchContext>[] = [
  { id: 'match-win', icon: 'swords', render: ({ winners, losers, game, rng }) => `${winners} gewinnt ${game} gegen ${losers}. ${pick(rng, PUNCHLINES)}` },
  { id: 'match-score', icon: 'swords', render: ({ winners, losers, game, score, rng }) => `${score ? `${score} in ${game}` : `Sieg in ${game}`}: ${winners} lässt ${losers} keine Chance. ${pick(rng, PUNCHLINES)}` },
  { id: 'match-revenge', icon: 'flag', render: ({ winners, losers, game }) => `${losers} kündigt nach der Niederlage in ${game} gegen ${winners} bereits die Revanche an.` },
  { id: 'match-celebrate', icon: 'sparkles', render: ({ winners, game, rng }) => `${winners} feiert den Sieg in ${game} ${pick(rng, ['mit einer Runde Chips', 'mit einer Siegerpose', 'mit lautem Jubel', 'ganz bescheiden'])}. ${pick(rng, PUNCHLINES)}` },
  { id: 'match-report', icon: 'radioTower', render: ({ winners, losers, game, rng }) => `Spielbericht ${game}: ${winners} setzt sich gegen ${losers} durch. ${pick(rng, PUNCHLINES)}` },
  { id: 'match-underdog', icon: 'sparkles', render: ({ winners, losers, game, rng }) => `Überraschung in ${game}: ${winners} schlägt ${losers}. ${pick(rng, PUNCHLINES)}` },
  { id: 'match-clean', icon: 'shield', render: ({ winners, losers, game }) => `${winners} spielt ${game} souverän zu Ende. ${losers} nimmt es sportlich und plant die Revanche.` },
  { id: 'match-crowd', icon: 'megaphone', render: ({ winners, game, rng }) => `Jubel am Tisch: ${winners} holt den Sieg in ${game}. ${pick(rng, PUNCHLINES)}` },
];

export interface DrawContext {
  teams: string;
  game: string;
  rng: NewsRandom;
}

export const DRAW_TEMPLATES: readonly NewsTemplate<DrawContext>[] = [
  { id: 'draw-even', icon: 'scale', render: ({ teams, game }) => `Remis in ${game}: ${teams} trennen sich unentschieden. Die Revanche wird bereits geplant.` },
  { id: 'draw-report', icon: 'scale', render: ({ teams, game, rng }) => `Kein Sieger in ${game}: ${teams} sind exakt gleich stark. ${pick(rng, PUNCHLINES)}` },
  { id: 'draw-friends', icon: 'scale', render: ({ teams, game, rng }) => `Punktgleich in ${game}: ${teams} teilen sich den Ruhm. ${pick(rng, PUNCHLINES)}` },
];

export interface TournamentMatchContext {
  tournament: string;
  winner: string;
  loser: string;
  score: string | null;
  rng: NewsRandom;
}

export const TOURNAMENT_MATCH_TEMPLATES: readonly NewsTemplate<TournamentMatchContext>[] = [
  { id: 'tm-advance', icon: 'trophy', render: ({ tournament, winner, loser, rng }) => `${tournament}: ${winner} schlägt ${loser} und ist eine Runde weiter. ${pick(rng, PUNCHLINES)}` },
  { id: 'tm-score', icon: 'trophy', render: ({ tournament, winner, loser, score }) => `${tournament}: ${winner} gewinnt ${score ? `${score} ` : ''}gegen ${loser}. Die Konkurrenz ist gewarnt.` },
  { id: 'tm-drama', icon: 'flame', render: ({ tournament, winner, loser, rng }) => `Drama im ${tournament}: ${loser} kämpft, aber ${winner} behält die Nerven. ${pick(rng, PUNCHLINES)}` },
  { id: 'tm-bracket', icon: 'trophy', render: ({ tournament, winner, loser, rng }) => `Die Turnierbaum-Experten staunen: ${winner} setzt sich im ${tournament} gegen ${loser} durch. ${pick(rng, PUNCHLINES)}` },
  { id: 'tm-next', icon: 'flag', render: ({ tournament, winner, loser }) => `${tournament}: ${winner} zieht weiter, ${loser} ist raus und feuert jetzt die anderen an.` },
];

export interface PlayingContext {
  player: string;
  game: string;
  duration: string;
  rng: NewsRandom;
}

// Only used when the event tracks play time; the facts come from real
// ongoing sessions, the joke part stays invented.
export const PLAYING_TEMPLATES: readonly NewsTemplate<PlayingContext>[] = [
  { id: 'play-now', icon: 'gamepad', render: ({ player, game, duration, rng }) => `${player} spielt seit ${duration} ${game}. ${pick(rng, PUNCHLINES)}` },
  { id: 'play-focus', icon: 'timer', render: ({ player, game, duration }) => `Volle Konzentration: ${player} ist seit ${duration} in ${game} versunken. Bitte nicht stören.` },
  { id: 'play-marathon', icon: 'flame', render: ({ player, game, duration, rng }) => `${duration} ${game} am Stück: ${player} ist im Tunnel. ${pick(rng, PUNCHLINES)}` },
  { id: 'play-session', icon: 'monitor', render: ({ player, game, duration, rng }) => `Laufende Session: ${player} hält ${game} seit ${duration} die Treue. ${pick(rng, PUNCHLINES)}` },
  { id: 'play-quiet', icon: 'clock', render: ({ player, game, duration }) => `Seit ${duration} hört man von ${player} nur noch ${game}-Geräusche. Alle anderen genießen die Ruhe.` },
];

export interface PlaytimeContext {
  player: string;
  game: string;
  hours: number;
  rng: NewsRandom;
}

export const PLAYTIME_TEMPLATES: readonly NewsTemplate<PlaytimeContext>[] = [
  { id: 'time-milestone', icon: 'clock', render: ({ player, game, hours, rng }) => `${player} knackt heute die ${hours}-Stunden-Marke in ${game}. ${pick(rng, PUNCHLINES)}` },
  { id: 'time-devotion', icon: 'clock', render: ({ player, game, hours }) => `Schon ${hours} Stunden ${game} heute: ${player} zeigt echte Hingabe.` },
  { id: 'time-badge', icon: 'award', render: ({ player, game, hours, rng }) => `Abzeichen freigeschaltet: ${hours} Stunden ${game} für ${player} heute. ${pick(rng, PUNCHLINES)}` },
  { id: 'time-stats', icon: 'chart', render: ({ player, game, hours }) => `Die Statistik meldet: ${player} verbringt heute schon ${hours} Stunden mit ${game}. Respekt vom ganzen Tisch.` },
];
