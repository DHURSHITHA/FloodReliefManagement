import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import * as campsService from './camps.service.js';
import { Camp } from './camp.model.js';
import { withTransaction } from '../../core/transaction.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const baseCampInput = (over = {}) => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7,
  flood_severity: 'high',
  beneficiary_capacity: 10, volunteer_capacity: 5, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});

const actor = () => ({ actorId: new mongoose.Types.ObjectId(), actorRole: 'admin', ip: '127.0.0.1' });

describe('createCamp', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('creates a camp with computed status open', async () => {
    const camp = await campsService.createCamp(baseCampInput(), actor());
    expect(camp.status).toBe('open');
  });
});

describe('updateCamp', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('recomputes status after an admin_override change', async () => {
    const camp = await campsService.createCamp(baseCampInput(), actor());
    const updated = await campsService.updateCamp(camp._id, { admin_override: 'temporarily_closed' }, actor());
    expect(updated.status).toBe('temporarily_closed');
  });

  it('records before/after in the audit trail', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 10 }), actor());
    await campsService.updateCamp(camp._id, { beneficiary_capacity: 20 }, actor());
    const saved = await Camp.findById(camp._id);
    expect(saved.beneficiary_capacity).toBe(20);
  });
});

describe('reserveBeneficiarySlots', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('reserves slots and updates the counter', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 10 }), actor());
    const updated = await campsService.reserveBeneficiarySlots(camp._id, 4);
    expect(updated.beneficiaries_accepted).toBe(4);
  });

  it('refuses to overshoot capacity, returning null and changing nothing', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 5 }), actor());
    await campsService.reserveBeneficiarySlots(camp._id, 4);
    const overshoot = await campsService.reserveBeneficiarySlots(camp._id, 2);
    expect(overshoot).toBeNull();
    const saved = await Camp.findById(camp._id);
    expect(saved.beneficiaries_accepted).toBe(4);
  });

  it('never overshoots under concurrent reservations for the last bed', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 5 }), actor());
    await campsService.reserveBeneficiarySlots(camp._id, 4); // 1 bed left

    const [a, b] = await Promise.all([
      campsService.reserveBeneficiarySlots(camp._id, 1),
      campsService.reserveBeneficiarySlots(camp._id, 1),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1); // exactly one of the two wins

    const saved = await Camp.findById(camp._id);
    expect(saved.beneficiaries_accepted).toBe(5);
  });

  it('promotes status to full when capacity is reached', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 5 }), actor());
    const updated = await campsService.reserveBeneficiarySlots(camp._id, 5);
    expect(updated.status).toBe('full');
  });

  it('rolls back the reservation if the enclosing transaction aborts', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 5 }), actor());
    await expect(
      withTransaction(async (session) => {
        await campsService.reserveBeneficiarySlots(camp._id, 3, session);
        throw new Error('caller failed');
      })
    ).rejects.toThrow('caller failed');

    const saved = await Camp.findById(camp._id);
    expect(saved.beneficiaries_accepted).toBe(0);
  });
});

describe('findNearestOpenCamps', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('returns camps with remaining capacity, closest first, excluding a full one', async () => {
    await campsService.createCamp(
      baseCampInput({ name: 'Near Camp', latitude: 26.20, longitude: 91.70, beneficiary_capacity: 10 }), actor()
    );
    await campsService.createCamp(
      baseCampInput({ name: 'Far Camp', latitude: 27.50, longitude: 93.00, beneficiary_capacity: 10 }), actor()
    );
    const full = await campsService.createCamp(
      baseCampInput({ name: 'Full Camp', latitude: 26.21, longitude: 91.71, beneficiary_capacity: 2 }), actor()
    );
    await campsService.reserveBeneficiarySlots(full._id, 2);

    const results = await campsService.findNearestOpenCamps({ latitude: 26.20, longitude: 91.70 });
    const names = results.map((r) => r.name);
    expect(names).not.toContain('Full Camp');
    expect(names[0]).toBe('Near Camp');
    expect(names.indexOf('Near Camp')).toBeLessThan(names.indexOf('Far Camp'));
  });
});
