import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { recordAudit } from './audit.service.js';
import { AuditLog } from './audit.model.js';
import { withTransaction } from '../../core/transaction.js';
import { clearDatabase, syncIndexes } from '../../test/helpers.js';

describe('recordAudit', () => {
  beforeEach(async () => { await clearDatabase(); await syncIndexes(); });

  const base = () => ({
    actor_id: new mongoose.Types.ObjectId(),
    actor_role: 'admin',
    action: 'camp.create',
    module: 'camps',
    record_id: new mongoose.Types.ObjectId(),
  });

  it('stores every field required by requirements section 15', async () => {
    const input = { ...base(), before: null, after: { name: 'Camp A', capacity: 100 } };
    const saved = await recordAudit(input);

    expect(saved.actor_id.toString()).toBe(input.actor_id.toString());
    expect(saved.actor_role).toBe('admin');
    expect(saved.action).toBe('camp.create');
    expect(saved.module).toBe('camps');
    expect(saved.record_id.toString()).toBe(input.record_id.toString());
    expect(saved.after).toEqual({ name: 'Camp A', capacity: 100 });
    expect(saved.createdAt).toBeInstanceOf(Date);
  });

  it('records previous and new values for an update', async () => {
    const saved = await recordAudit({
      ...base(),
      action: 'camp.update',
      before: { beneficiary_capacity: 100 },
      after: { beneficiary_capacity: 250 },
    });
    expect(saved.before).toEqual({ beneficiary_capacity: 100 });
    expect(saved.after).toEqual({ beneficiary_capacity: 250 });
  });

  it('joins an enclosing transaction and rolls back with it', async () => {
    await expect(
      withTransaction(async (session) => {
        await recordAudit({ ...base(), session });
        throw new Error('caller failed');
      })
    ).rejects.toThrow('caller failed');

    // An audit entry for an action that never happened would be a lie.
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('strips sensitive keys from recorded values', async () => {
    const saved = await recordAudit({
      ...base(),
      after: { email: 'a@b.com', password: 'hunter2', password_hash: '$2a$12$x', aadhaar: '234567890124' },
    });
    expect(saved.after).toEqual({ email: 'a@b.com' });
  });

  it('rejects an entry missing its actor', async () => {
    await expect(recordAudit({ ...base(), actor_id: undefined })).rejects.toThrow();
  });
});
