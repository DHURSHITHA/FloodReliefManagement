import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { receiveStock } from './resources.service.js';
import { Inventory } from './inventory.model.js';
import { User, hashPassword } from '../auth/user.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

async function makeUser(role, over = {}) {
  return User.create({
    name: 'Test', mobile: String(9600000000 + Math.floor(Math.random() * 99999999)),
    password_hash: await hashPassword('correct horse battery'), role, status: 'active', ...over,
  });
}

describe('receiveStock', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('creates a new inventory lot when this camp has never held the item', async () => {
    const admin = await makeUser('admin');
    const campId = new mongoose.Types.ObjectId();
    const itemId = new mongoose.Types.ObjectId();

    const inv = await receiveStock({ camp_id: campId, item_id: itemId, quantity: 100 }, { actorId: admin._id });

    expect(inv.remaining_qty).toBe(100);
    expect(inv.reorder_threshold).toBe(0);
    expect(await Inventory.countDocuments({ camp_id: campId, item_id: itemId })).toBe(1);
  });

  it('adds to the existing lot rather than creating a second one', async () => {
    const admin = await makeUser('admin');
    const campId = new mongoose.Types.ObjectId();
    const itemId = new mongoose.Types.ObjectId();

    await receiveStock({ camp_id: campId, item_id: itemId, quantity: 100 }, { actorId: admin._id });
    const second = await receiveStock({ camp_id: campId, item_id: itemId, quantity: 40 }, { actorId: admin._id });

    expect(second.remaining_qty).toBe(140);
    expect(await Inventory.countDocuments({ camp_id: campId, item_id: itemId })).toBe(1);
  });

  it('never issues two lots under concurrent first-time receipt', async () => {
    const admin = await makeUser('admin');
    const campId = new mongoose.Types.ObjectId();
    const itemId = new mongoose.Types.ObjectId();

    await Promise.all(
      Array.from({ length: 5 }, () => receiveStock({ camp_id: campId, item_id: itemId, quantity: 10 }, { actorId: admin._id }))
    );

    expect(await Inventory.countDocuments({ camp_id: campId, item_id: itemId })).toBe(1);
    const inv = await Inventory.findOne({ camp_id: campId, item_id: itemId });
    expect(inv.remaining_qty).toBe(50);
  });
});
