# Product

<!-- impeccable:product-schema 1 -->

Kurzer Produktkontext für Design- und UX-Entscheidungen. Verbindlich bleiben die Produktziele in
[`DEVELOPMENT_GUIDELINES.md`](DEVELOPMENT_GUIDELINES.md), das Designsystem in
[`server/DESIGN_SYSTEM.md`](server/DESIGN_SYSTEM.md) und die Fachregeln unter
[`docs/product/`](docs/product/README.md). Diese Datei wiederholt davon nur, was für
Designentscheidungen gebraucht wird.

## Platform

web

## Users

- **LAN-Gäste:** rund 15 Freundinnen und Freunde auf einer jährlichen, dreitägigen LAN-Party. Sie
  nutzen Respawn **hauptsächlich am eigenen Rechner am LAN-Platz**, meist zwischen zwei Runden oder
  nebenher. Das Handy wird zwischendurch genutzt, ist aber nachrangig.
- **Orga/Admin:** eine bis wenige Personen, die Event, Teilnehmende, Spiele und Einstellungen
  vorbereiten und während der LAN betreuen.
- **Kiosk:** ein großer Bildschirm im Raum zeigt Live-Status, Ergebnisse und Newsticker ohne
  eigene Bedienung.

## Product Purpose

Alles Wichtige der LAN an einem Ort: Teams auslosen, abstimmen was als Nächstes gespielt wird,
live sehen wer was spielt, Turniere, Punkte und Wetten, Essensbestellungen, Umfragen, An- und
Abreise, Packliste, Arcade-Minispiele und Musik. Erfolg heißt: Die Gruppe organisiert sich drei
Tage lang ohne Zettel, Chat-Chaos oder Erklärungen, und das System läuft ohne Neustart durch.

## Operating Context

- Am Rechner läuft der Browser im Vollbild oder als Fenster neben dem Spiel, oft auf einem
  Zweitmonitor. Bedienung mit Maus und Tastatur; Aufmerksamkeit ist kurz, weil das Spiel
  weiterläuft.
- Lokales WLAN beziehungsweise LAN; Verbindungsaussetzer kommen vor und werden automatisch
  aufgefangen.
- Der Windows-Agent meldet laufende Spiele automatisch; Spielzeit muss niemand von Hand eintragen.

## Capabilities and Constraints

- Statische Single-Page-App ohne Framework und Build-Schritt; UI-Texte auf Deutsch.
- Dunkles Farbschema als einziges Theme.
- Eine Instanz bedient eine Gruppe; Events sind der Arbeitskontext.

## Brand Commitments

- Name „Respawn“ mit Verlaufs-Wortmarke und Maskottchen (`server/public/img/`).
- Ton: kurz, locker, mit echten LAN-Begriffen („Bock-Level“, „Captain Draft“, „Sitznachbarn“);
  der Newsticker darf frech sein.

## Product Principles

1. Zuverlässigkeit vor allem anderen: Ein fehlerhafter Client darf niemanden sonst stören.
2. Rechner zuerst: Breite Bildschirme werden genutzt, nicht nur gestreckt; Maus und Tastatur sind
   der Normalfall.
3. Was gerade eine Reaktion braucht (offene Bestellung, laufender Vote, eigenes Match), ist ohne
   Suchen sichtbar.
4. Schlank bleiben: gebaut für etwa 15 Leute, nicht für Enterprise-Skalierung.

## Accessibility & Inclusion

WCAG 2.2 AA für Kontrast, Tastaturbedienung, sichtbaren Fokus und `prefers-reduced-motion`;
Zustände nie nur über Farbe. Details in `server/DESIGN_SYSTEM.md`.
