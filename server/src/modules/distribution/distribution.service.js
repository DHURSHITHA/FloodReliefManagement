import { calcRation, computePeriodKey, isLowStock } from '@frp/shared';
import { DistributionRecord } from './distributionRecord.model.js';
import { DistributionRule } from '../resources/distributionRule.model.js';
import { Inventory } from '../resources/inventory.model.js';
import { announceLowStock } from '../resources/resources.service.js';
import { Beneficiary } from '../intake/beneficiary.model.js';
import { RegistrationMember } from '../intake/registrationMember.model.js';
import { withTransaction } from '../../core/transaction.js';
import { AppError } from '../../core/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { emitInventoryChanged } from '../../core/socket.js';

/**
 * The distribution transaction. Spec section 5.4, verbatim order: insert
 * the record FIRST — its unique index on {beneficiary, item, period}
 * catches a repeat atomically, before anything touches stock — then
 * deduct stock with the same conditional guard Plan 2 used for camp
 * capacity. A null result means insufficient stock, which aborts the
 * whole transaction.
 *
 * Verification policy (spec sections 5.4, 7): a beneficiary with no
 * checked-in members is blocked by default, but an official may override
 * with a recorded reason. A database constraint must never be the thing
 * that refuses a starving, unverified family.
 */
export async function distributeItem({ beneficiary_id, item_id, override_reason }, { actorId, actorRole, ip }) {
  const result = await withTransaction(async (session) => {
    const beneficiary = await Beneficiary.findById(beneficiary_id).session(session);
    if (!beneficiary) throw AppError.notFound('No beneficiary with that id.');

    const members = await RegistrationMember.find({ beneficiary_id }).session(session);
    if (members.length === 0) throw AppError.notFound('That registration has no members.');

    const checkedIn = members.filter((m) => m.checkin_status === 'checked_in');
    if (checkedIn.length === 0 && !override_reason) {
      throw AppError.conflict(
        'NOT_VERIFIED',
        'This beneficiary has no checked-in members. Provide an override reason to distribute anyway.',
        [{ path: 'override_reason', message: 'An override reason is required for an unverified beneficiary.' }]
      );
    }
    // Ration the people actually present when anyone is checked in; fall
    // back to the whole family only under an explicit override.
    const rationBasis = checkedIn.length > 0 ? checkedIn : members;

    const rule =
      (await DistributionRule.findOne({ item_id, camp_id: beneficiary.camp_id, active: true }).session(session)) ||
      (await DistributionRule.findOne({ item_id, camp_id: null, active: true }).session(session));
    if (!rule) throw AppError.notFound('No active distribution rule for this item.');

    const quantity = calcRation(rule, rationBasis);
    if (quantity <= 0) {
      throw AppError.conflict('NOT_ELIGIBLE', 'This beneficiary is not eligible for this item under the active rule.');
    }

    const period_key = computePeriodKey(rule.period);

    let record;
    try {
      [record] = await DistributionRecord.create(
        [{
          beneficiary_id, camp_id: beneficiary.camp_id, item_id, quantity, period_key,
          distributed_by: actorId, override_reason: override_reason ?? null,
        }],
        { session }
      );
    } catch (err) {
      if (err?.code === 11000) {
        throw AppError.conflict('ALREADY_DISTRIBUTED', 'Already distributed for this period.');
      }
      throw err;
    }

    const updatedInventory = await Inventory.findOneAndUpdate(
      { camp_id: beneficiary.camp_id, item_id, remaining_qty: { $gte: quantity } },
      { $inc: { remaining_qty: -quantity, distributed_qty: quantity } },
      { new: true, session }
    );
    if (!updatedInventory) {
      throw AppError.conflict('INSUFFICIENT_STOCK', 'Not enough stock remaining for this item.');
    }

    await recordAudit({
      actor_id: actorId, actor_role: actorRole, action: 'distribution.create',
      module: 'distribution', record_id: record._id,
      after: {
        beneficiary_code: beneficiary.beneficiary_code, item_id: String(item_id),
        quantity, period_key, override_reason: override_reason ?? null,
      },
      ip, session,
    });

    return { record, inventory: updatedInventory, campId: beneficiary.camp_id };
  });

  // Broadcast only after the transaction commits — a rolled-back attempt
  // must never leave clients showing stock that was never actually spent.
  emitInventoryChanged(result.campId, {
    itemId: String(item_id),
    remaining_qty: result.inventory.remaining_qty,
  });
  if (isLowStock(result.inventory)) await announceLowStock(result.inventory);

  return result.record;
}

export async function listDistributions({ beneficiary, camp, date } = {}) {
  const filter = {};
  if (beneficiary) filter.beneficiary_id = beneficiary;
  if (camp) filter.camp_id = camp;
  if (date) {
    const start = new Date(date);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    filter.distributed_at = { $gte: start, $lt: end };
  }
  return DistributionRecord.find(filter).sort({ distributed_at: -1 }).limit(100);
}
