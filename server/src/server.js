import http from 'node:http';
import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { initSocket } from './core/socket.js';

async function start() {
  await connectDb();
  const app = createApp();
  const httpServer = http.createServer(app);
  initSocket(httpServer);
  httpServer.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
}

start().catch((err) => {
  logger.error({ err }, 'failed to start server');
  process.exit(1);
});
