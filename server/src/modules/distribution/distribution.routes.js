import { Router } from 'express';
import { distributeItemSchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { createDistributionHandler, listDistributionsHandler } from './distribution.controller.js';

export const distributionRouter = Router();
distributionRouter.post('/distributions', authenticate, authorize('admin', 'camp_official'), validate(distributeItemSchema), createDistributionHandler);
distributionRouter.get('/distributions', authenticate, authorize('admin', 'camp_official'), listDistributionsHandler);
