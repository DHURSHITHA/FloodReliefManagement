import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { listNotificationsHandler, markReadHandler } from './notifications.controller.js';

export const notificationsRouter = Router();
notificationsRouter.get('/notifications', authenticate, listNotificationsHandler);
notificationsRouter.post('/notifications/:id/read', authenticate, markReadHandler);
