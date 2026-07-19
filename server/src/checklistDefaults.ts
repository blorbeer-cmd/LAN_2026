// Grundstock for the personal packing checklist (Packliste): materialized
// once per player/event the first time GET /api/checklist/items is called
// (see routes/checklist.ts). Editing this list only changes what future
// materializations seed - it never retroactively touches rows a player
// already has, so removing an entry here can't silently delete something
// someone already checked off.
export interface ChecklistDefaultItem {
  key: string;
  label: string;
}

export const DEFAULT_CHECKLIST_ITEMS: ChecklistDefaultItem[] = [
  { key: 'pc', label: 'PC / Laptop' },
  { key: 'monitor', label: 'Monitor' },
  { key: 'keyboard', label: 'Tastatur' },
  { key: 'mouse', label: 'Maus' },
  { key: 'headset', label: 'Headset / Kopfhörer' },
  { key: 'power-cables', label: 'Netzkabel (PC + Monitor)' },
  { key: 'video-cable', label: 'Bildschirmkabel (HDMI/DP)' },
  { key: 'usb-cables', label: 'USB- / Ladekabel' },
  { key: 'power-strip', label: 'Mehrfachsteckdose / Verlängerungskabel' },
  { key: 'network-cable', label: 'Netzwerkkabel (LAN)' },
  { key: 'controller', label: 'Controller' },
  { key: 'id-card', label: 'Ausweis' },
  { key: 'money', label: 'Bargeld / Karte' },
  { key: 'hygiene', label: 'Zahnbürste & Hygieneartikel' },
  { key: 'sleeping', label: 'Schlafsack / Isomatte / Kissen' },
  { key: 'towel', label: 'Handtuch' },
  { key: 'medication', label: 'Medikamente' },
  { key: 'snacks', label: 'Snacks & Getränke' },
  { key: 'earplugs', label: 'Ohrstöpsel' },
];
