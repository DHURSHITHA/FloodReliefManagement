import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { areasRouter } from './modules/areas/areas.routes.js';
import { campsRouter } from './modules/camps/camps.routes.js';
import { intakeRouter } from './modules/intake/intake.routes.js';
import { resourcesRouter } from './modules/resources/resources.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { distributionRouter } from './modules/distribution/distribution.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { complaintsRouter } from './modules/complaints/complaints.routes.js';
import { sosRouter } from './modules/sos/sos.routes.js';
import { donationsRouter } from './modules/donations/donations.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', env: env.NODE_ENV });
  });

  app.use('/api/auth', authRouter);
  app.use('/api', areasRouter);
  app.use('/api', campsRouter);
  app.use('/api', intakeRouter);
  app.use('/api', resourcesRouter);
  app.use('/api', notificationsRouter);
  app.use('/api', distributionRouter);
  app.use('/api', dashboardRouter);
  app.use('/api', complaintsRouter);
  app.use('/api', sosRouter);
  app.use('/api', donationsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
