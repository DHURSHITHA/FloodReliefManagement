import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withIdempotency } from './idempotency.js';
import { clearDatabase } from '../test/helpers.js';

describe('withIdempotency', () => {
  beforeEach(async () => { await clearDatabase(); });

  it('runs fn when no key is given', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true });
    await withIdempotency(undefined, fn);
    await withIdempotency(undefined, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('runs fn once and returns the cached result on a repeated key', async () => {
    const fn = vi.fn().mockResolvedValue({ value: 42 });
    const first = await withIdempotency('key-1', fn);
    const second = await withIdempotency('key-1', fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ value: 42 });
    expect(second).toEqual({ value: 42 });
  });

  it('treats different keys independently', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true });
    await withIdempotency('key-a', fn);
    await withIdempotency('key-b', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
