import { Router } from 'express';
import { createResourceItemSchema, createInventorySchema, adjustInventorySchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  createResourceItemHandler, listResourceItemsHandler,
  createInventoryHandler, listInventoryHandler, adjustInventoryHandler,
} from './resources.controller.js';

export const resourcesRouter = Router();

resourcesRouter.post('/resources', authenticate, authorize('admin'), validate(createResourceItemSchema), createResourceItemHandler);
resourcesRouter.get('/resources', authenticate, listResourceItemsHandler);
resourcesRouter.post('/inventory', authenticate, authorize('admin'), validate(createInventorySchema), createInventoryHandler);
resourcesRouter.get('/inventory', authenticate, listInventoryHandler);
resourcesRouter.patch('/inventory/:id', authenticate, authorize('admin'), validate(adjustInventorySchema), adjustInventoryHandler);
