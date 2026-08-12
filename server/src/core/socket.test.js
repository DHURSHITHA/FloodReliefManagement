import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { io as ioClient } from 'socket.io-client';
import { createApp } from '../app.js';
import { initSocket, emitCampOccupancy } from './socket.js';

let httpServer, port, client;

beforeAll(async () => {
  const app = createApp();
  httpServer = http.createServer(app);
  initSocket(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});

afterAll(async () => {
  client?.close();
  await new Promise((resolve) => httpServer.close(resolve));
});

describe('emitCampOccupancy', () => {
  it('broadcasts a camp:occupancy event to connected clients', async () => {
    client = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
    await new Promise((resolve) => client.on('connect', resolve));

    const received = new Promise((resolve) => client.once('camp:occupancy', resolve));
    emitCampOccupancy('camp123', { beneficiaries_accepted: 5, status: 'open' });

    const event = await received;
    expect(event).toEqual({ campId: 'camp123', beneficiaries_accepted: 5, status: 'open' });
  });

  it('is safe to call with no connected clients', () => {
    expect(() => emitCampOccupancy('nobody-listening', { status: 'open' })).not.toThrow();
  });
});
