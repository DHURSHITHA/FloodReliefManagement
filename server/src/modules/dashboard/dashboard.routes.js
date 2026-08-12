import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { getDashboardSummary } from './dashboard.service.js';

export const dashboardRouter = Router();

dashboardRouter.get('/dashboard/summary', authenticate, authorize('admin'), async (req, res) => {
  res.json(await getDashboardSummary());
});
