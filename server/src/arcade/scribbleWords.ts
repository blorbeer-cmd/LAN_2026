export interface ScribbleWordSeed {
  word: string;
  difficulty: 'leicht' | 'mittel' | 'schwer';
}

const words = (difficulty: ScribbleWordSeed['difficulty'], list: string[]): ScribbleWordSeed[] =>
  list.map((word) => ({ word, difficulty }));

export const DEFAULT_SCRIBBLE_WORDS: ScribbleWordSeed[] = [
  ...words('leicht', [
    'Maus', 'Tastatur', 'Headset', 'Bildschirm', 'Pizza', 'Cola', 'Chips', 'Controller',
    'Sonne', 'Mond', 'Stern', 'Baum', 'Haus', 'Auto', 'Fahrrad', 'Katze', 'Hund', 'Fisch',
    'Vogel', 'Blume', 'Apfel', 'Banane', 'Pilz', 'Roboter', 'Rakete', 'Ballon', 'Regenschirm',
    'Brille', 'Hut', 'Schuh', 'Uhr', 'Herz', 'Krone', 'Schwert', 'Schild', 'Burg', 'Drache',
    'Gespenst', 'Kürbis', 'Schneemann', 'Regenbogen', 'Wolke', 'Blitz', 'Feuer', 'Wasser',
    'Berg', 'Insel', 'Boot', 'Flugzeug', 'Zug', 'Ampel', 'Brücke', 'Leiter', 'Zelt', 'Lagerfeuer',
  ]),
  ...words('mittel', [
    'Respawn', 'Lootbox', 'Ladebildschirm', 'Netzwerkkabel', 'Grafikkarte', 'Bluescreen',
    'Energydrink', 'Gamepad', 'Sitzsack', 'Verlängerungskabel', 'Mehrfachsteckdose',
    'Router', 'Headset-Mikrofon', 'Joystick', 'Würfel', 'Schachbrett', 'Vogelscheuche',
    'Windmühle', 'Leuchtturm', 'Vulkan', 'Gletscher', 'Wüste', 'Dschungel', 'Piratenschiff',
    'Schatzkarte', 'Zauberstab', 'Kristallkugel', 'Teppich', 'Kronleuchter', 'Spinnennetz',
    'Fallschirm', 'Astronaut', 'Satellit', 'Teleskop', 'Kompass', 'Anker', 'Handschellen',
    'Skateboard', 'Trampolin', 'Karussell', 'Achterbahn', 'Zirkuszelt', 'Jongleur',
  ]),
  ...words('schwer', [
    'Tellerrand', 'Lagspike', 'Cooldown', 'Frame-Drop', 'Serverabsturz', 'Tastenkombination',
    'Bildwiederholrate', 'Latenzzeit', 'Übertaktung', 'Wasserkühlung', 'Netzteilkabel',
    'Sanduhr-Symbol', 'Optische Täuschung', 'Perpetuum Mobile', 'Zeitzone', 'Sonnenfinsternis',
    'Nordlicht', 'Fata Morgana', 'Echo', 'Schwerelosigkeit', 'Zentrifugalkraft', 'Marionette',
    'Scherenschnitt', 'Schattentheater', 'Wasserwaage', 'Stimmgabel', 'Wetterhahn',
    'Sanduhrfigur', 'Sternschnuppe', 'Morsecode', 'Rauchzeichen', 'Flaschenpost',
  ]),
];
