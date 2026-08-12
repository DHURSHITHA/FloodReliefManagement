import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { withTransaction } from './transaction.js';
import { clearDatabase } from '../test/helpers.js';

const Widget = mongoose.model(
  'Widget',
  new mongoose.Schema({ name: String, count: Number }, { collection: 'widgets' })
);

describe('withTransaction', () => {
  beforeEach(async () => { await clearDatabase(); });

  it('commits every write when the callback resolves', async () => {
    await withTransaction(async (session) => {
      await Widget.create([{ name: 'a', count: 1 }], { session });
      await Widget.create([{ name: 'b', count: 2 }], { session });
    });
    expect(await Widget.countDocuments()).toBe(2);
  });

  it('rolls back every write when the callback throws', async () => {
    await expect(
      withTransaction(async (session) => {
        await Widget.create([{ name: 'a', count: 1 }], { session });
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    // Proves transactions are genuinely active. On a standalone mongod the
    // first write would have persisted and this would be 1.
    expect(await Widget.countDocuments()).toBe(0);
  });

  it('returns the callback result', async () => {
    const result = await withTransaction(async () => 'done');
    expect(result).toBe('done');
  });
});
