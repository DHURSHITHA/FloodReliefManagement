import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { ResourceItem } from './resourceItem.model.js';
import { Inventory } from './inventory.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

describe('ResourceItem', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('creates an item with the given category and unit', async () => {
    const item = await ResourceItem.create({ name: 'Rice', category: 'food', unit: 'kg', created_by: new mongoose.Types.ObjectId() });
    expect(item.toSafeJSON()).toMatchObject({ name: 'Rice', category: 'food', unit: 'kg' });
  });
});

describe('Inventory', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('defaults distributed_qty to zero', async () => {
    const item = await ResourceItem.create({ name: 'Rice', category: 'food', unit: 'kg', created_by: new mongoose.Types.ObjectId() });
    const inv = await Inventory.create({
      camp_id: new mongoose.Types.ObjectId(), item_id: item._id,
      remaining_qty: 500, reorder_threshold: 50, created_by: new mongoose.Types.ObjectId(),
    });
    expect(inv.distributed_qty).toBe(0);
  });

  it('toSafeJSON exposes remaining_qty and reorder_threshold', async () => {
    const item = await ResourceItem.create({ name: 'Rice', category: 'food', unit: 'kg', created_by: new mongoose.Types.ObjectId() });
    const inv = await Inventory.create({
      camp_id: new mongoose.Types.ObjectId(), item_id: item._id,
      remaining_qty: 500, reorder_threshold: 50, created_by: new mongoose.Types.ObjectId(),
    });
    expect(inv.toSafeJSON()).toMatchObject({ remaining_qty: 500, reorder_threshold: 50, distributed_qty: 0 });
  });
});
