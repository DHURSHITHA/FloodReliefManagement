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

  // listen() reports failure through an 'error' event, not the promise chain,
  // so without this the usual cause -- a previous dev server still holding the
  // port -- surfaces as a raw unhandled-event stack trace, and the browser is
  // left saying "could not reach the server" with no clue why.
  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(
        `Port ${env.PORT} is already in use -- another server is still running.\n` +
          `  Stop it, then start again:\n` +
          `    Windows: npx kill-port ${env.PORT}\n` +
          `    macOS/Linux: lsof -ti:${env.PORT} | xargs kill`
      );
    } else {
      logger.error({ err }, 'http server error');
    }
    process.exit(1);
  });

  httpServer.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
}

start().catch((err) => {
  logger.error({ err }, 'failed to start server');
  process.exit(1);
});
