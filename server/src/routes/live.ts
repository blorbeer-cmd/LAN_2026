// Browser-facing live-status board (FR-13). Sits behind the shared UI access
// token, unlike the agent's own report endpoint.

import { Router } from 'express';
import { getLiveBoard } from '../liveStatus';

export const liveRouter = Router();

liveRouter.get('/', (_req, res) => {
  res.json(getLiveBoard());
});
