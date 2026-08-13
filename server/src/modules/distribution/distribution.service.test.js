import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import * as distributionService from './distribution.service.js';
import { DistributionRule } from '../resources/distributionRule.model.js';
import { ResourceItem } from '../resources/resourceItem.model.js';
import { Inventory } from '../resources/inventory.model.js';
import { Beneficiary } from '../intake/beneficiary.model.js';
import { RegistrationMember } from '../intake/registrationMember.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const actor = () => ({ actorId: new mongoose.Types.ObjectId(), actorRole: 'admin', ip: '127.0.0.1' });

async function setup({ checkedIn = true, capacity = 500, threshold = 50, ruleOver = {} } = {}) {
  const campId = new mongoose.Types.ObjectId();
  const item = await ResourceItem.create({ name: 'Rice', category: 'food', unit: 'kg', created_by: new mongoose.Types.ObjectId() });
  await Inventory.create({
    camp_id: campId, item_id: item._id, remaining_qty: capacity, reorder_threshold: threshold,
    created_by: new mongoose.Types.ObjectId(),
  });
  await DistributionRule.create({
    item_id: item._id, mode: 'fixed', period: 'daily', fixed_qty: 5, active: true,
    created_by: new mongoose.Types.ObjectId(), ...ruleOver,
  });
  const beneficiary = await Beneficiary.create({
    beneficiary_code: `BEN-${9000 + Math.floor(Math.random() * 999)}`,
    user_id: new mongoose.Types.ObjectId(), camp_id: campId,
    status: checkedIn ? 'active' : 'applied',
  });
  await RegistrationMember.create({
    beneficiary_id: beneficiary._id, is_primary: true, name: 'Meena Devi', age: 34, gender: 'female',
    aadhaar_hash: `hash-${beneficiary._id}`, aadhaar_enc: 'enc-1', aadhaar_last4: '0001',
    checkin_status: checkedIn ? 'checked_in' : 'pending', is_active_registration: true,
  });
  return { item, beneficiary, campId };
}

describe('distributeItem', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('records a distribution and deducts stock by the ration amount', async () => {
    const { item, beneficiary } = await setup();
    const record = await distributionService.distributeItem({ beneficiary_id: beneficiary._id, item_id: item._id }, actor());
    expect(record.quantity).toBe(5);

    const inv = await Inventory.findOne({ item_id: item._id });
    expect(inv.remaining_qty).toBe(495);
    expect(inv.distributed_qty).toBe(5);
  });

  it('blocks a same-day repeat for the same beneficiary and item', async () => {
    const { item, beneficiary } = await setup();
    await distributionService.distributeItem({ beneficiary_id: beneficiary._id, item_id: item._id }, actor());
    await expect(
      distributionService.distributeItem({ beneficiary_id: beneficiary._id, item_id: item._id }, actor())
    ).rejects.toMatchObject({ code: 'ALREADY_DISTRIBUTED' });
  });

  it('leaves stock untouched when the duplicate is blocked', async () => {
    const { item, beneficiary } = await setup();
    await distributionService.distributeItem({ beneficiary_id: beneficiary._id, item_id: item._id }, actor());
    await distributionService.distributeItem({ beneficiary_id: beneficiary._id, item_id: item._id }, actor()).catch(() => {});

    const inv = await Inventory.findOne({ item_id: item._id });
    expect(inv.remaining_qty).toBe(495); // deducted once, not twice
  });

  it('refuses when stock is insufficient, leaving inventory unchanged', async () => {
    const { item, beneficiary } = await setup({ capacity: 3 });
    await expect(
      distributionService.distributeItem({ beneficiary_id: beneficiary._id, item_id: item._id }, actor())
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    const inv = await Inventory.findOne({ item_id: item._id });
    expect(inv.remaining_qty).toBe(3);
  });

  it('rolls the distribution record back when stock runs out', async () => {
    const { item, beneficiary } = await setup({ capacity: 3 });
    await distributionService.distributeItem({ beneficiary_id: beneficiary._id, item_id: item._id }, actor()).catch(() => {});
    const { DistributionRecord } = await import('./distributionRecord.model.js');
    expect(await DistributionRecord.countDocuments()).toBe(0);
  });

  it('blocks distribution to a beneficiary with no checked-in members, without an override', async () => {
    const { item, beneficiary } = await setup({ checkedIn: false });
    await expect(
      distributionService.distributeItem({ beneficiary_id: beneficiary._id, item_id: item._id }, actor())
    ).rejects.toMatchObject({ code: 'NOT_VERIFIED' });
  });

  it('allows distribution to an unverified beneficiary with a recorded override reason', async () => {
    const { item, beneficiary } = await setup({ checkedIn: false });
    const record = await distributionService.distributeItem(
      { beneficiary_id: beneficiary._id, item_id: item._id, override_reason: 'Family arrived injured, distributing before formal check-in.' },
      actor()
    );
    expect(record.override_reason).toBeTruthy();
  });

  it('prefers a camp-specific rule over the global default for that item', async () => {
    const { item, beneficiary, campId } = await setup({ ruleOver: { fixed_qty: 5 } }); // global default, 5/head
    await DistributionRule.create({
      item_id: item._id, camp_id: campId, mode: 'fixed', period: 'daily', fixed_qty: 9, active: true,
      created_by: new mongoose.Types.ObjectId(),
    });
    const record = await distributionService.distributeItem({ beneficiary_id: beneficiary._id, item_id: item._id }, actor());
    expect(record.quantity).toBe(9);
  });

  it('refuses when no member satisfies the rule eligibility', async () => {
    const { item, beneficiary } = await setup({ ruleOver: { eligibility: ['has_child'] } });
    await expect(
      distributionService.distributeItem({ beneficiary_id: beneficiary._id, item_id: item._id }, actor())
    ).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' });
  });

  it('never overshoots stock under two concurrent distributions for different beneficiaries', async () => {
    const { item, beneficiary: b1, campId } = await setup({ capacity: 8 });
    const b2 = await Beneficiary.create({
      beneficiary_code: 'BEN-9500', user_id: new mongoose.Types.ObjectId(), camp_id: campId, status: 'active',
    });
    await RegistrationMember.create({
      beneficiary_id: b2._id, is_primary: true, name: 'Raju', age: 40, gender: 'male',
      aadhaar_hash: 'hash-b2', aadhaar_enc: 'enc-2', aadhaar_last4: '0002',
      checkin_status: 'checked_in', is_active_registration: true,
    });

    const results = await Promise.allSettled([
      distributionService.distributeItem({ beneficiary_id: b1._id, item_id: item._id }, actor()),
      distributionService.distributeItem({ beneficiary_id: b2._id, item_id: item._id }, actor()),
    ]);
    // The rule gives 5 per beneficiary against 8 in stock — only one can fit.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const inv = await Inventory.findOne({ item_id: item._id });
    expect(inv.remaining_qty).toBe(3);
  });
});
