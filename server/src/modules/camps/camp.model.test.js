import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Camp } from './camp.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const validAttrs = () => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  location: { type: 'Point', coordinates: [91.7, 26.2] },
  flood_severity: 'high',
  beneficiary_capacity: 400, volunteer_capacity: 30, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  created_by: new mongoose.Types.ObjectId(),
});

describe('Camp model', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('creates a camp with occupancy counters defaulted to zero', async () => {
    const camp = await Camp.create(validAttrs());
    expect(camp.beneficiaries_accepted).toBe(0);
    expect(camp.volunteers_accepted).toBe(0);
  });

  it('defaults status to open', async () => {
    const camp = await Camp.create(validAttrs());
    expect(camp.status).toBe('open');
  });

  it('rejects a camp missing an emergency contact', async () => {
    const attrs = validAttrs();
    delete attrs.nearest_police_contact;
    await expect(Camp.create(attrs)).rejects.toThrow();
  });

  it('serializes latitude/longitude back out of the GeoJSON point', async () => {
    const camp = await Camp.create(validAttrs());
    const json = camp.toSafeJSON();
    expect(json.latitude).toBe(26.2);
    expect(json.longitude).toBe(91.7);
  });

  it('exposes the full facilities object with defaults', async () => {
    const camp = await Camp.create(validAttrs());
    expect(camp.toSafeJSON().facilities).toMatchObject({ food: false, toilets_count: 0 });
  });
});
