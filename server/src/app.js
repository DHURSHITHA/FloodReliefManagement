import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, isProd } from './config/env.js';
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

// The built SPA, served from this same origin in production.
const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          // The areas map fetches its tiles straight from OpenStreetMap, and
          // helmet's default img-src of "'self' data:" would block them,
          // leaving a blank grey square where the map should be.
          'img-src': ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
        },
      },
    })
  );
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

  // In production the API and the site share one origin, so the refresh
  // cookie's sameSite:'strict' keeps working with no CORS exemption -- the
  // same arrangement the Vite dev proxy gives us locally.
  if (isProd) {
    app.use(express.static(clientDist));
    // Deep links such as /camps/123 are React Router paths, not files on disk,
    // so hand them index.html and let the router resolve them. Unmatched /api
    // paths must fall through to notFoundHandler and answer as JSON.
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
