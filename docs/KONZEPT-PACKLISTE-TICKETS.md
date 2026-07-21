# Konzept: Packliste & To-Dos

Stand: Juli 2026 · Status: **in Umsetzung** (Rev. 2 – Benennung „To-Do“ statt „Ticket“, Entscheidungen
aus Rev. 1 übernommen)

Dieses Dokument beschreibt das Zielbild für den heutigen Bereich „Packliste“: eine stimmige,
leichtgewichtige To-Do-Verwaltung statt zweier unverbundener Listen. Ziel ist, dass jede Person
Aufgaben und Anfragen erstellen, verteilen und annehmen kann und dabei jederzeit einen klaren
Überblick über die **eigene Packliste** und die **eigenen Aufgaben** behält – ohne das Ganze zu
überladen.

Rev. 1 war ein reiner Konzeptentwurf mit vier offenen Entscheidungen (siehe Abschnitt 9). Der Nutzer
hat die Benennung „Ticket“ → „To-Do“ korrigiert und für den Rest grünes Licht zur Umsetzung gegeben;
Abschnitt 9 hält fest, wie die übrigen drei Punkte dabei entschieden wurden.

---

## 1. Ausgangslage (Ist-Zustand)

Der Bereich „Packliste“ (Views `checklist.js`, Routen `routes/checklist.ts`) vermischt heute zwei
sehr unterschiedliche Dinge unter einem Namen:

1. **Meine Packliste** (`checklist_items`) – private Geräteliste pro Person und Event. Grundstock
   wird einmalig materialisiert, danach frei abhakbar, ergänz- und kürzbar. Rein persönlich.
2. **Aufgaben & Anfragen** (`checklist_tasks`) – ein gemeinsamer Pool mit zwei Typen:
   - `todo`: **nur Orga (Owner/Admin)** darf sie anlegen – offen im Pool oder direkt an eine/mehrere
     Personen zugewiesen (`batch_id`).
   - `item_request`: jede Person darf eine „Kann mir jemand X mitnehmen?“-Anfrage stellen; startet
     immer offen.
   - Lebenszyklus: `open` → `taken` → `done`, plus `cancelled` als Rückzug.
   - Übernehmen ist sofort verbindlich (erste Übernahme gewinnt, sonst 409), optionaler Kommentar.

### 1.1 Was daran heute hakt

- **Ein Name für zwei Welten.** „Packliste“ verspricht eine Checkliste, enthält aber zusätzlich ein
  vollwertiges Aufgabenbrett. Das mentale Modell ist unklar.
- **Kein Überblick über die eigenen Aufgaben.** Alles liegt flach in „Offen / Unterwegs / Historie“.
  Wer drei zugewiesene Dinge hat, muss die Liste absuchen. Es gibt keine Sicht „was liegt bei mir?“.
- **Aufgaben verteilen ist Orga-Privileg.** Normale Mitglieder können nur eine Mitbring-Anfrage
  stellen, aber keine Aufgabe anlegen oder jemandem geben. Das passt nicht zu einer Freundesgruppe,
  in der jede/r mal etwas organisiert.
- **Der Typ wird über den Button bestimmt** („Anfrage stellen“ vs. „Aufgabe verteilen“) statt bewusst
  im Formular gewählt.
- **Keine Terminierung.** „Bring das bis Freitag mit“ lässt sich nicht abbilden; nichts sortiert nach
  Dringlichkeit.

---

## 2. Zielbild in einem Satz

> Eine Person erstellt ein **To-Do**, wählt dessen **Art**, weist es **sich selbst, niemandem
> (offen) oder anderen** zu – und sieht in **„Mir zugewiesen“** sofort, was bei ihr liegt, getrennt
> von der privaten **Packliste**.

Leitplanken (aus `DEVELOPMENT_GUIDELINES.md`, Abschnitt 3, in dieser Reihenfolge): zuverlässig,
einfach und schnell bedienbar, modern, schlank wartbar. Für ~15 Teilnehmende bauen, **nicht** für
Enterprise-Ticketing. Im Zweifel weglassen.

---

## 3. Kernidee: To-Do statt „Aufgabe vs. Anfrage“

Der gemeinsame Pool wird konzeptionell zu **To-Dos** vereinheitlicht. Ein To-Do ist alles, was
zwischen mehreren Personen koordiniert wird. Beim Erstellen wählt man die **Art**:

| Art | Bedeutung | Beispiel |
| --- | --- | --- |
| **Aufgabe** | Etwas ist zu erledigen/zu organisieren. | „Tische im Saal aufbauen“, „Getränke besorgen“ |
| **Mitbring-Anfrage** | „Kann jemand X mitbringen?“ / „Wer hat ein X übrig?“ | „Kann jemand einen zweiten Beamer mitbringen?“ |

Bewusst **nur zwei Arten** zum Start – sie decken alles ab, was heute existiert. Das Enum bleibt
erweiterbar (z. B. später „Einkauf“ oder „Frage“), aber ohne konkreten Bedarf fügen wir nichts hinzu.

Der bestehende **Lebenszyklus bleibt unverändert** und trägt das To-Do-Modell 1:1:

```
offen ──übernehmen/zuweisen──▶ übernommen ──erledigt──▶ erledigt
  │                                  │
  └──────────── zurückgezogen ◀──────┘   (freigeben führt zurück nach „offen“)
```

Anzeigenamen werden geschärft: `taken` → **„In Arbeit“/„Übernommen“**, `open` → **„Offen“**. Keine
neuen Zustände, keine Statusmaschine erweitern.

---

## 4. Wer darf was (bewusste Lockerung)

Die wichtigste Verhaltensänderung: **jedes aktive Gruppenmitglied darf To-Dos jeder Art erstellen,
sich selbst zuweisen oder anderen zuweisen.** Das Orga-Monopol auf Aufgaben entfällt.

| Aktion | Heute | Vorschlag |
| --- | --- | --- |
| Mitbring-Anfrage erstellen | jedes Mitglied | jedes Mitglied |
| Aufgabe erstellen | **nur Owner/Admin** | **jedes Mitglied** |
| Sich selbst zuweisen / offenes To-Do übernehmen | jedes Mitglied | jedes Mitglied |
| Anderen Personen zuweisen | nur Orga (bei `todo`) | **jedes Mitglied** |
| Freigeben (zurück in den Pool) | Zugewiesene/r | Zugewiesene/r |
| Als erledigt markieren | Zugewiesene/r, Ersteller, Orga | unverändert |
| Zurückziehen/Löschen | Ersteller oder Orga | unverändert |

Warum unbedenklich: Eine Zuweisung an andere ist **nicht bindend** – die Person wird benachrichtigt
und kann jederzeit **freigeben**. Für eine 15-köpfige Freundesgruppe ist das der natürliche Umgang und
genau das, was gewünscht ist („man kann sich selber assignen oder assigned werden“). Owner/Admin
behalten ihre Moderationsrechte (fremde To-Dos zurückziehen).

---

## 5. Informationsarchitektur & Bedienung

Ein Bereich, klar in Sichten getrennt statt in einer flachen Liste. Empfehlung: **Segmented Control**
oben mit zwei Tabs plus einer Zählmarke:

```
┌───────────────────────────────────────────────┐
│   Meine Packliste        To-Dos ( 3 )          │   ← Zähler = mir zugewiesen & offen für mich
├───────────────────────────────────────────────┤
```

### 5.1 Tab „Meine Packliste“
Bleibt inhaltlich **wie heute**: privater Grundstock + eigene Positionen, abhaken/ergänzen/entfernen.
Kein To-Do, keine Zuweisung – ein Solo-Werkzeug. Nur visuell in den neuen Bereich eingebettet.

### 5.2 Tab „To-Dos“
Von oben nach unten, damit das Persönliche zuerst kommt:

1. **`+ To-Do erstellen`** – ein einziger Button (ersetzt „Anfrage stellen“ + „Aufgabe verteilen“).
2. **Mir zugewiesen (N)** – die eigenen offenen/übernommenen To-Dos, **nach Fälligkeit sortiert**,
   Überfälliges hervorgehoben. Das ist der zentrale „Überblick über meine Aufgaben“. Freundliche
   Leerseite, wenn nichts anliegt.
3. **Offen (Pool)** – nicht zugewiesene To-Dos, die jede/r übernehmen kann. Filter-Chips nach Art
   (Alle / Aufgaben / Mitbring-Anfragen).
4. **Unterwegs** – von anderen übernommen (Transparenz, wer sich um was kümmert).
5. **Historie** – erledigt, eingeklappt wie heute.

Optionaler leichter Filter „**Von mir erstellt**“ (als Chip), damit man selbst gestellte Anfragen
nachverfolgen kann – kein eigener schwerer Abschnitt.

### 5.3 Namensgebung des Bereichs
Zurückgestellt (siehe Abschnitt 9, Entscheidung 1): Der Nav-Eintrag heißt vorerst weiter
**„Packliste“**; nur der gemeinsame Pool darin heißt „To-Dos“. Eine spätere Umbenennung des ganzen
Bereichs (z. B. „Orga“) bleibt eine separate, leicht nachrüstbare Änderung.

---

## 6. To-Do erstellen – ein Formular

Ein einziger Dialog „To-Do erstellen“ ersetzt die zwei heutigen Buttons:

- **Art** (Segmented: *Aufgabe* / *Mitbring-Anfrage*) – ändert nur Beschriftung/Platzhalter.
- **Titel** (Pflicht, ≤ 80 Zeichen – wie heute).
- **Beschreibung** (optional, ≤ 300 Zeichen – wie heute).
- **Zuweisen an**: `Niemand (offen)` · `Ich` · `Personen wählen…` (Mehrfachauswahl wie heute die
  Orga-Verteilung, aber für alle verfügbar).
- **Fällig bis** (optional, nur Datum) – siehe Feld-Bewertung unten.

Damit sind alle Wünsche in einem Fluss abgedeckt: To-Do anlegen, Art wählen, sich selbst oder andere
zuweisen oder offen lassen.

---

## 7. Zusätzliche Felder – bewusst geprüft

Der Auftrag bittet ausdrücklich zu prüfen, welche weiteren Felder sinnvoll sind. Bewertung gegen
„nicht over-engineered“:

| Feld | Urteil | Begründung |
| --- | --- | --- |
| **Fällig bis (Due Date)** | ✅ **aufnehmen** | Echter Nutzen: „bis Donnerstag besorgen“, „vor der LAN mitbringen“. Nur Datum, optional. Ermöglicht Sortierung in „Mir zugewiesen“ und ein **„überfällig“**-Badge. Eine neue Spalte `due_at`. |
| **Art / Typ** | ✅ **explizit machen** | Existiert implizit; wird zur bewussten Auswahl. Enum bleibt erweiterbar. |
| **Mehrere Zugewiesene** | ✅ **behalten** | Gibt es bereits über `batch_id`. |
| **Priorität** | ⚠️ **vorerst weglassen** | Bei ~15 Personen erschlägt „Fällig bis“ die Dringlichkeit. Falls überhaupt: ein einzelnes **„Wichtig“**-Flag (Stern) statt Skala. Defer. |
| **Menge/Anzahl** (z. B. „3× Verlängerung“) | ⚠️ **weglassen** | Beschreibung deckt das ab; strukturierte Menge lohnt den Aufwand nicht. |
| **Kommentare/Diskussion** | ⚠️ **minimal halten** | Der bestehende einzelne Übernahme-Kommentar reicht. Ein Thread wäre over-engineered. |
| **Anhänge/Links** | ❌ **nein** | Link passt in die Beschreibung; kein Upload-Feature nötig. |
| **Erinnerung/Reminder-Push** | 🔭 **später** | „Fällig bis“ + vorhandene Push-Infrastruktur könnten später eine Erinnerung auslösen. Nicht Teil des ersten Wurfs. |
| **Packliste ↔ Mitbring-Anfrage koppeln** | 🔭 **später** | Idee: Wird eine Mitbring-Anfrage übernommen, könnte der Gegenstand automatisch in die Packliste der übernehmenden Person wandern. Charmant, aber Zusatzkomplexität – als spätere Option notieren. |

**Fazit Felder:** Nur **ein** neues strukturiertes Feld (`due_at`). Alles andere bleibt oder wird
bewusst zurückgestellt. Das hält das System schlank.

---

## 8. Datenmodell & API – Auswirkungen

- **`checklist_items`**: unverändert (private Packliste bleibt wie sie ist).
- **`checklist_tasks`**: neue Spalte `due_at INTEGER NULL` (Migration). Kein Statuswechsel, keine
  neuen Tabellen. Serialisierung ergänzt `dueAt`.
- **Erstellen**: die beiden bestehenden Endpunkte (`POST /tasks` für Mitbring-Anfragen,
  `POST /tasks/todo` für Aufgaben, optional mit `assigneePlayerIds`) bleiben als zwei Routen
  bestehen – nur der Rollen-Gate auf `POST /tasks/todo` fällt von „nur Owner/Admin“ auf „jedes aktive
  Mitglied“ (`requireGroupRole('member')` statt `'admin'`). Beide Endpunkte akzeptieren neu ein
  optionales `dueAt`.
- **Sichten** („Mir zugewiesen“, „Offen“, „Unterwegs“, „Historie“) sind reine Client-Filter über die
  ohnehin gelieferte Liste, wie bisher.
- **Validierung**: `dueAt` muss, falls gesetzt, eine gültige Zahl (Epoch-Millisekunden) sein;
  erwartbare Fehler lösen keine ungefangene Exception aus.
- **Realtime/Push**: bestehende `checklist:changed`-Broadcasts und Push-Topics greifen weiter;
  Zuweisung an andere nutzt den vorhandenen „direct“-Benachrichtigungspfad.
- **Tests**: Happy Path je Art, Validierungsfehler (`dueAt`, leerer Titel), das gelockerte
  Rollen-Verhalten (Mitglied darf jetzt anlegen+zuweisen), Zuständigkeits-/Zustandskonflikte
  (Übernahme-Race, Freigabe durch Nicht-Zugewiesene) – unverändert aus Rev. 1 übernommen.

---

## 9. Entscheidungen

Rev. 1 hatte vier offene Punkte. Der Nutzer hat Punkt 0 (Benennung „Ticket“) korrigiert und für den
Rest die Umsetzung freigegeben; die Standardentscheidungen aus Rev. 1 gelten damit wie folgt:

0. **Benennung der Entität:** ~~„Ticket“~~ → **„To-Do“** (Nutzerentscheidung, umgesetzt).
1. **Bereichsname:** **zurückgestellt** – Nav-Eintrag bleibt vorerst „Packliste“, nicht „Orga“. Kann
   separat nachgezogen werden, sollte sich das nach dem Testen als nötig erweisen.
2. **Zuweisung an andere für alle:** **umgesetzt wie empfohlen** – jedes Mitglied darf zuweisen,
   Freigabe bleibt jederzeit möglich.
3. **„Wichtig“-Flag:** **weiterhin weggelassen**, wie empfohlen.
4. **To-Do-Arten:** **bei zwei belassen** (Aufgabe / Mitbring-Anfrage), wie empfohlen.

---

## 10. Nicht-Ziele

- Kein Rollen-/Rechte-Ausbau über die eine beschriebene Lockerung hinaus.
- Keine Kommentarthreads, Anhänge, Zeiterfassung, Sub-To-Dos oder Boards mit frei definierbaren
  Spalten.
- Keine Änderung an der privaten Packliste außer der visuellen Einbettung.
- Keine externen Abhängigkeiten oder neuen Frameworks.

---

## 11. Umsetzungspaket (dieser Branch)

1. `due_at`-Migration auf `checklist_tasks`.
2. Rollen-Gate auf `POST /tasks/todo` von `admin` auf `member` gesenkt; `dueAt` auf beiden
   Erstellen-Routen ergänzt und validiert.
3. Zwei-Tab-UI (`Meine Packliste` / `To-Dos`) mit „Mir zugewiesen“, Fälligkeits-Badges
   (überfällig/bald fällig), Art-Filtern und „Nur von mir erstellt“.
4. Tests (Integration, gelockerte Rolle, `dueAt`-Validierung) und ein neuer E2E-Happy-Path.
5. `DESIGN_SYSTEM.md`-Abschnitt „Packliste“ entsprechend nachgeführt.

Dieses Dokument bleibt die fachliche Referenz und wird bei Abweichungen mit dem Code in Einklang
gehalten (Guideline 1).
