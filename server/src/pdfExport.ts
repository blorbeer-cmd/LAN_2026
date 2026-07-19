// Renders the "Export als Andenken" snapshot as a designed PDF keepsake
// instead of raw JSON. Dark-themed to match the app (this is a memento
// people look at on a screen, not something anyone prints), built with
// pdfkit's drawing primitives — no headless browser needed just to make a
// PDF, keeping the server a plain, lightweight Node process.

import type { ExportSnapshot } from './routes/export';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const COLOR = {
  bg: '#0f1420',
  card: '#171e2e',
  cardAlt: '#1b2338',
  border: '#2a3350',
  text: '#eef1f8',
  muted: '#8b93a7',
  accent: '#5b8cff',
  accent2: '#9163f5',
  accent3: '#ef5da8',
  gold: '#ffd166',
} as const;

const PAGE_WIDTH = 595.28; // A4 pt
const PAGE_HEIGHT = 841.89;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_HEIGHT = 30;

// Standard PDF fonts (Helvetica) only cover WinAnsi/Latin-1 — no emoji
// glyphs — so any emoji from game icons/award icons would render as an
// invisible/broken glyph. Strip them; German umlauts (ä ö ü ß) are Latin-1
// and unaffected.
function stripEmoji(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fillPage(doc: PDFKit.PDFDocument): void {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR.bg);
}

function drawBadge(doc: PDFKit.PDFDocument, x: number, y: number, size: number): void {
  const gradient = doc.linearGradient(x, y, x + size, y + size);
  gradient.stop(0, COLOR.accent).stop(0.55, COLOR.accent2).stop(1, COLOR.accent3);
  doc.roundedRect(x, y, size, size, size * 0.28).fill(gradient);
  // Two descending chevrons, echoing the app's logo mark.
  doc
    .save()
    .translate(x, y)
    .path(
      `M${size * 0.28},${size * 0.32} L${size * 0.5},${size * 0.44} L${size * 0.72},${size * 0.32} ` +
        `L${size * 0.72},${size * 0.4} L${size * 0.5},${size * 0.52} L${size * 0.28},${size * 0.4} Z`
    )
    .fillOpacity(0.55)
    .fill('#ffffff')
    .fillOpacity(1)
    .path(
      `M${size * 0.32},${size * 0.48} L${size * 0.5},${size * 0.6} L${size * 0.68},${size * 0.48} ` +
        `L${size * 0.68},${size * 0.56} L${size * 0.5},${size * 0.68} L${size * 0.32},${size * 0.56} Z`
    )
    .fill('#ffffff')
    .restore();
}

interface Cursor {
  y: number;
}

// Adds a new (dark-filled) page if the next chunk of content wouldn't fit
// above the footer, keeping every section from ever being cut mid-row.
function ensureSpace(doc: PDFKit.PDFDocument, cursor: Cursor, needed: number): void {
  if (cursor.y + needed <= PAGE_HEIGHT - FOOTER_HEIGHT - MARGIN) return;
  doc.addPage({ size: 'A4', margin: 0 });
  fillPage(doc);
  cursor.y = MARGIN;
}

function sectionTitle(doc: PDFKit.PDFDocument, cursor: Cursor, label: string, accent: string): void {
  ensureSpace(doc, cursor, 34);
  cursor.y += 18;
  doc.rect(MARGIN, cursor.y, 4, 12).fill(accent);
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLOR.muted)
    .text(stripEmoji(label).toUpperCase(), MARGIN + 12, cursor.y - 1, { characterSpacing: 0.6 });
  cursor.y += 20;
}

function emptyNote(doc: PDFKit.PDFDocument, cursor: Cursor, text: string): void {
  ensureSpace(doc, cursor, 24);
  doc.font('Helvetica').fontSize(10).fillColor(COLOR.muted).text(text, MARGIN, cursor.y);
  cursor.y += 24;
}

// One alternating-shade row with a left label and a right-aligned value —
// the workhorse for every table in this document.
function row(
  doc: PDFKit.PDFDocument,
  cursor: Cursor,
  index: number,
  left: string,
  right: string,
  opts: { leftBold?: boolean; leftColor?: string; sub?: string } = {}
): void {
  const height = opts.sub ? 30 : 22;
  ensureSpace(doc, cursor, height);
  if (index % 2 === 0) {
    doc.rect(MARGIN, cursor.y, CONTENT_WIDTH, height).fill(COLOR.cardAlt);
  }
  doc
    .font(opts.leftBold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(10.5)
    .fillColor(opts.leftColor ?? COLOR.text)
    .text(stripEmoji(left), MARGIN + 10, cursor.y + 5, { width: CONTENT_WIDTH - 140, lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .fillColor(COLOR.text)
    .text(stripEmoji(right), MARGIN + CONTENT_WIDTH - 140, cursor.y + 5, { width: 130, align: 'right' });
  if (opts.sub) {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLOR.muted)
      .text(stripEmoji(opts.sub), MARGIN + 10, cursor.y + 17, { width: CONTENT_WIDTH - 150, lineBreak: false });
  }
  cursor.y += height;
}

export function renderExportPdf(doc: PDFKit.PDFDocument, snapshot: ExportSnapshot): void {
  fillPage(doc);
  const cursor: Cursor = { y: MARGIN };

  // ---------- Header ----------
  drawBadge(doc, MARGIN, cursor.y, 34);
  doc
    .font('Helvetica-Bold')
    .fontSize(15)
    .fillColor(COLOR.text)
    .text('Respawn', MARGIN + 44, cursor.y + 9);
  cursor.y += 34 + 20;

  doc.font('Helvetica-Bold').fontSize(24).fillColor(COLOR.text).text(stripEmoji(snapshot.event.name), MARGIN, cursor.y, {
    width: CONTENT_WIDTH,
  });
  cursor.y += 32;

  const dateRange = snapshot.event.endsAt
    ? `${formatDate(snapshot.event.startsAt)} – ${formatDate(snapshot.event.endsAt)}`
    : `seit ${formatDate(snapshot.event.startsAt)}`;
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(COLOR.muted)
    .text(`${dateRange} · Exportiert am ${formatDateTime(snapshot.exportedAt)}`, MARGIN, cursor.y);
  cursor.y += 18;

  // Gradient rule under the header, echoing the app's topbar stripe.
  const rule = doc.linearGradient(MARGIN, cursor.y, MARGIN + CONTENT_WIDTH, cursor.y);
  rule.stop(0, COLOR.accent).stop(0.55, COLOR.accent2).stop(1, COLOR.accent3);
  doc.rect(MARGIN, cursor.y, CONTENT_WIDTH, 2).fill(rule);
  cursor.y += 24;

  // ---------- Rangliste ----------
  sectionTitle(doc, cursor, 'Rangliste', COLOR.accent);
  if (snapshot.leaderboard.length === 0) {
    emptyNote(doc, cursor, 'Noch keine Ergebnisse.');
  } else {
    snapshot.leaderboard.forEach((s, i) => {
      row(doc, cursor, i, `${i + 1}.  ${s.name}`, `${s.points} P`, {
        leftBold: i === 0,
        leftColor: i === 0 ? COLOR.gold : COLOR.text,
        sub: `${s.wins} Siege · ${s.matchesPlayed} Matches`,
      });
    });
  }

  // ---------- Spielzeit ----------
  cursor.y += 10;
  sectionTitle(doc, cursor, 'Spielzeit pro Spieler', COLOR.accent2);
  if (snapshot.playtimeByPlayer.length === 0) {
    emptyNote(doc, cursor, 'Noch keine erfasste Spielzeit.');
  } else {
    snapshot.playtimeByPlayer.forEach((p, i) => row(doc, cursor, i, p.name, p.totalFormatted));
  }

  cursor.y += 10;
  sectionTitle(doc, cursor, 'Spielzeit pro Spiel', COLOR.accent2);
  if (snapshot.playtimeByGame.length === 0) {
    emptyNote(doc, cursor, 'Noch keine erfasste Spielzeit.');
  } else {
    snapshot.playtimeByGame.forEach((g, i) => row(doc, cursor, i, g.gameName, g.totalFormatted));
  }

  // ---------- Awards ----------
  cursor.y += 10;
  sectionTitle(doc, cursor, 'Awards', COLOR.accent3);
  if (snapshot.awards.length === 0) {
    emptyNote(doc, cursor, 'Noch keine Awards.');
  } else {
    snapshot.awards.forEach((a, i) =>
      row(doc, cursor, i, `${stripEmoji(a.title)} — ${a.playerName}`, a.value, { sub: stripEmoji(a.description) })
    );
  }

  // ---------- Turnier-Champions ----------
  cursor.y += 10;
  sectionTitle(doc, cursor, 'Turnier-Champions', COLOR.gold);
  if (snapshot.tournaments.length === 0) {
    emptyNote(doc, cursor, 'Noch keine abgeschlossenen Turniere.');
  } else {
    snapshot.tournaments.forEach((t, i) =>
      row(doc, cursor, i, `${stripEmoji(t.gameName)} — ${t.name}`, t.championTeamName ?? '–', {
        sub: t.championPlayers.join(', '),
      })
    );
  }

  // ---------- Footer on every page ----------
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLOR.muted)
      .text(`Respawn · Seite ${i + 1} von ${pageCount}`, MARGIN, PAGE_HEIGHT - MARGIN, {
        width: CONTENT_WIDTH,
        align: 'center',
      });
  }
}
