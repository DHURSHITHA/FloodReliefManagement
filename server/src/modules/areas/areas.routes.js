import { Router } from 'express';
import { createAreaSchema, createAlertSchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  createAreaHandler, listAreasHandler, createAlertHandler, listActiveAlertsHandler,
} from './areas.controller.js';

export const areasRouter = Router();
areasRouter.post('/areas', authenticate, authorize('admin'), validate(createAreaSchema), createAreaHandler);
areasRouter.get('/areas', authenticate, listAreasHandler);
areasRouter.post('/areas/:areaId/alerts', authenticate, authorize('admin'), validate(createAlertSchema), createAlertHandler);
areasRouter.get('/alerts/active', authenticate, listActiveAlertsHandler);
