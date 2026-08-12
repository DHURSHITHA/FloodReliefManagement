import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Beneficiary } from './beneficiary.model.js';
import { RegistrationMember } from './registrationMember.model.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

const validMember = (over = {}) => ({
  beneficiary_id: new mongoose.Types.ObjectId(),
  is_primary: true,
  name: 'Meena Devi', age: 34, gender: 'female',
  mobile: '9876543210', address: '12 River Road',
  aadhaar_hash: 'hash-a', aadhaar_enc: 'enc-a', aadhaar_last4: '0123',
  is_active_registration: true,
  ...over,
});

describe('RegistrationMember', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('computes priority_level high for a senior citizen', async () => {
    const m = await RegistrationMember.create(validMember({ age: 65 }));
    expect(m.priority_tags).toContain('senior_citizen');
    expect(m.priority_level).toBe('high');
  });

  it('computes priority_level normal for a non-vulnerable adult', async () => {
    const m = await RegistrationMember.create(validMember({ age: 34 }));
    expect(m.priority_tags).toEqual([]);
    expect(m.priority_level).toBe('normal');
  });

  it('ignores a priority_level supplied directly, computing it instead', async () => {
    const m = await RegistrationMember.create(validMember({ age: 65, priority_level: 'normal' }));
    expect(m.priority_level).toBe('high');
  });

  it('rejects a second active registration with the same aadhaar_hash', async () => {
    await RegistrationMember.create(validMember({ aadhaar_hash: 'dup-hash' }));
    await expect(RegistrationMember.create(validMember({ aadhaar_hash: 'dup-hash' }))).rejects.toThrow();
  });

  it('allows the same aadhaar_hash again once the earlier registration is inactive', async () => {
    await RegistrationMember.create(validMember({ aadhaar_hash: 'dup-hash', is_active_registration: false }));
    await expect(
      RegistrationMember.create(validMember({ aadhaar_hash: 'dup-hash', is_active_registration: true }))
    ).resolves.toBeTruthy();
  });

  it('toSafeJSON never exposes aadhaar_enc', async () => {
    const m = await RegistrationMember.create(validMember());
    expect(JSON.stringify(m.toSafeJSON())).not.toContain('enc-a');
  });
});

describe('Beneficiary', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  it('defaults status to applied', async () => {
    const b = await Beneficiary.create({
      beneficiary_code: 'BEN-1001', user_id: new mongoose.Types.ObjectId(), camp_id: new mongoose.Types.ObjectId(),
    });
    expect(b.status).toBe('applied');
  });
});
