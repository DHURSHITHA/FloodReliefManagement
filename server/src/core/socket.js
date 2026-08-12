import { Server } from 'socket.io';
import { env } from '../config/env.js';

let io = null;

/** Attach Socket.IO to the given http.Server. Call once, from server.js. */
export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
  });
  return io;
}

/**
 * Emit a camp occupancy change to every connected client. A no-op, not a
 * throw, when no server has been attached — the seed script and one-off
 * scripts create camps too, and an occupancy change must never fail just
 * because nothing happens to be listening.
 */
export function emitCampOccupancy(campId, payload) {
  if (!io) return;
  io.emit('camp:occupancy', { campId: String(campId), ...payload });
}

export function getIO() {
  return io;
}
