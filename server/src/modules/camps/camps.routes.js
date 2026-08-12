import { Router } from 'express';
import { createCampSchema, updateCampSchema, nearestCampQuerySchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  createCampHandler, listCampsHandler, getCampHandler, updateCampHandler, nearestCampsHandler,
} from './camps.controller.js';

export const campsRouter = Router();

// /nearest before /:id — Express matches in declaration order and :id would
// otherwise swallow the literal "nearest" segment.
campsRouter.get('/camps/nearest', authenticate, validate(nearestCampQuerySchema, 'query'), nearestCampsHandler);
campsRouter.post('/camps', authenticate, authorize('admin'), validate(createCampSchema), createCampHandler);
campsRouter.get('/camps', authenticate, listCampsHandler);
campsRouter.get('/camps/:id', authenticate, getCampHandler);
campsRouter.patch('/camps/:id', authenticate, authorize('admin'), validate(updateCampSchema), updateCampHandler);
