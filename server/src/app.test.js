import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';

describe('app', () => {
  const app = createApp();

  it('reports health without touching the database', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns the uniform error envelope for an unknown route', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String), details: [] },
    });
  });

  it('never leaks a stack trace to the client', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js:\d+/);
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers).toHaveProperty('x-content-type-options', 'nosniff');
  });

  // helmet's default Referrer-Policy is 'no-referrer', which makes the browser
  // strip the Referer from the areas map's tile requests. OpenStreetMap then
  // answers every tile with its "Access blocked" image and the header
  // "x-blocked: No referer sent" -- served as HTTP 200, so Leaflet paints the
  // rejection notice across the map instead of failing visibly.
  it('sends an origin on cross-origin requests so OSM serves map tiles', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});
