// Grundstock for the personal packing checklist (Packliste): materialized
// once per player/event the first time GET /api/checklist/items is called
// (see routes/checklist.ts). Editing this list changes future materializations;
// one-time cleanup migrations handle intentional removals from already
// materialized default rows.
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
  { key: 'money', label: 'Bargeld / Karte' },
  { key: 'hygiene', label: 'Zahnbürste & Hygieneartikel' },
  { key: 'sleeping', label: 'Schlafsack / Isomatte / Kissen' },
  { key: 'towel', label: 'Handtuch' },
  { key: 'medication', label: 'Medikamente' },
  { key: 'snacks', label: 'Snacks & Getränke' },
  { key: 'earplugs', label: 'Ohrstöpsel' },
];
