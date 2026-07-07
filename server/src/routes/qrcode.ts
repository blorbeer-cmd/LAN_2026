// QR code generation for the invite link (FR extension): rendered
// server-side so the link — which carries the shared access token — never
// gets sent to a third-party "free QR code" API. Behind the same
// requireAccess gate as every other /api route.

import { Router } from 'express';
import QRCode from 'qrcode';

export const qrcodeRouter = Router();

const MAX_TEXT_LENGTH = 2000;

qrcodeRouter.get('/', async (req, res) => {
  const { text } = req.query;
  if (typeof text !== 'string' || !text || text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `text ist erforderlich (max. ${MAX_TEXT_LENGTH} Zeichen).` });
  }

  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, width: 260 });
    res.type('image/svg+xml').send(svg);
  } catch {
    res.status(500).json({ error: 'QR-Code konnte nicht erzeugt werden.' });
  }
});
