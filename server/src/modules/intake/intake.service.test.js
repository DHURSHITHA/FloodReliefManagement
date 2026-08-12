import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import * as intakeService from './intake.service.js';
import * as campsService from '../camps/camps.service.js';
import { Beneficiary } from './beneficiary.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const baseCampInput = (over = {}) => ({
  name: 'Riverside Community Hall', camp_type: 'community_hall',
  address: '12 River Road', area: 'Ward 12', district: 'North District', state: 'Assam', pincode: '781001',
  latitude: 26.2, longitude: 91.7, flood_severity: 'high',
  beneficiary_capacity: 10, volunteer_capacity: 5, duration_days: 14,
  nearest_hospital_name: 'District Hospital', nearest_hospital_contact: '0484-2000000',
  nearest_police_name: 'Ward 12 Police Station', nearest_police_contact: '0484-2100000',
  ...over,
});
const actor = () => ({ actorId: new mongoose.Types.ObjectId(), actorRole: 'admin', ip: '127.0.0.1' });
// Real Verhoeff-valid Aadhaar numbers, distinct per test to avoid dedup collisions.
const applicant = (over = {}) => ({
  name: 'Meena Devi', age: 34, gender: 'female', aadhaar: '234567890107',
  mobile: '9876543210', address: '12 River Road', is_pregnant: false, has_disability: false,
  wants_to_volunteer: false, ...over,
});

describe('submitRegistration', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('creates a beneficiary with a BEN- code and marks the applicant primary', async () => {
    const camp = await campsService.createCamp(baseCampInput(), actor());
    const { beneficiary, members } = await intakeService.submitRegistration(
      { camp_id: camp._id, members: [applicant()] },
      actor()
    );
    expect(beneficiary.beneficiary_code).toMatch(/^BEN-\d+$/);
    expect(members).toHaveLength(1);
    expect(members[0].is_primary).toBe(true);
  });

  it('increases the camp beneficiary count by the family size', async () => {
    const camp = await campsService.createCamp(baseCampInput(), actor());
    await intakeService.submitRegistration(
      {
        camp_id: camp._id,
        members: [
          applicant(),
          applicant({ name: 'Raju', age: 8, aadhaar: '234567890111', mobile: undefined, address: undefined, relation_to_applicant: 'child' }),
        ],
      },
      actor()
    );
    const updated = await campsService.getCampById(camp._id);
    expect(updated.beneficiaries_accepted).toBe(2);
  });

  it('blocks a second active registration with the same Aadhaar and rolls back everything', async () => {
    const camp = await campsService.createCamp(baseCampInput(), actor());
    await intakeService.submitRegistration({ camp_id: camp._id, members: [applicant()] }, actor());

    await expect(
      intakeService.submitRegistration(
        { camp_id: camp._id, members: [applicant({ name: 'Meena Duplicate', mobile: '9800000000', address: 'Elsewhere' })] },
        actor()
      )
    ).rejects.toMatchObject({ code: 'DUPLICATE_AADHAAR' });

    const updated = await campsService.getCampById(camp._id);
    expect(updated.beneficiaries_accepted).toBe(1); // not 2 — the second attempt's capacity reservation never happened
    expect(await Beneficiary.countDocuments()).toBe(1);
  });

  it('refuses registration once the camp is full', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 1 }), actor());
    await intakeService.submitRegistration({ camp_id: camp._id, members: [applicant()] }, actor());

    await expect(
      intakeService.submitRegistration(
        { camp_id: camp._id, members: [applicant({ name: 'Someone Else', aadhaar: '234567890124', mobile: '9800000001' })] },
        actor()
      )
    ).rejects.toMatchObject({ code: 'CAMP_FULL' });
  });

  it('sets duplicate_warning when name and mobile fuzzy-match an existing active registration', async () => {
    const camp = await campsService.createCamp(baseCampInput(), actor());
    await intakeService.submitRegistration({ camp_id: camp._id, members: [applicant()] }, actor());

    const { beneficiary } = await intakeService.submitRegistration(
      {
        camp_id: camp._id,
        members: [applicant({ name: 'Meena Devi', aadhaar: '234567890130' })], // same name+mobile, different Aadhaar
      },
      actor()
    );
    expect(beneficiary.duplicate_warning).toBe(true);
  });

  it('never overshoots capacity under two concurrent registrations for the last bed', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 1 }), actor());

    const results = await Promise.allSettled([
      intakeService.submitRegistration({ camp_id: camp._id, members: [applicant({ aadhaar: '234567890148' })] }, actor()),
      intakeService.submitRegistration({ camp_id: camp._id, members: [applicant({ aadhaar: '234567890153', mobile: '9876500000' })] }, actor()),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const updated = await campsService.getCampById(camp._id);
    expect(updated.beneficiaries_accepted).toBe(1);
  });
});

describe('volunteer FCFS during registration', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('accepts exactly as many opted-in members as slots remain, in submission order', async () => {
    const camp = await campsService.createCamp(baseCampInput({ volunteer_capacity: 2, beneficiary_capacity: 10 }), actor());
    const { members } = await intakeService.submitRegistration(
      {
        camp_id: camp._id,
        members: [
          applicant({ aadhaar: '234567890169', wants_to_volunteer: true }),
          applicant({ name: 'A', aadhaar: '234567890176', mobile: undefined, address: undefined, relation_to_applicant: 'sibling', wants_to_volunteer: true }),
          applicant({ name: 'B', aadhaar: '234567890182', mobile: undefined, address: undefined, relation_to_applicant: 'sibling', wants_to_volunteer: true }),
        ],
      },
      actor()
    );
    expect(members[0].volunteer_status).toBe('accepted');
    expect(members[1].volunteer_status).toBe('accepted');
    expect(members[2].volunteer_status).toBe('not_accepted_slots_full');
  });

  it('leaves volunteer_status not_requested for members who did not opt in', async () => {
    const camp = await campsService.createCamp(baseCampInput({ beneficiary_capacity: 10 }), actor());
    const { members } = await intakeService.submitRegistration(
      { camp_id: camp._id, members: [applicant({ aadhaar: '234567890195', wants_to_volunteer: false })] },
      actor()
    );
    expect(members[0].volunteer_status).toBe('not_requested');
  });
});
