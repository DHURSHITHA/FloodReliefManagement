import { Donor } from './donor.model.js';
import { Donation } from './donation.model.js';
import { DonationMaterial } from './donationMaterial.model.js';
import { ResourceItem } from '../resources/resourceItem.model.js';
import { User } from '../auth/user.model.js';
import { AppError } from '../../core/errors.js';
import { withTransaction } from '../../core/transaction.js';
import { nextDonationCode } from '../../core/idGenerator.js';
import { recordAudit } from '../audit/audit.service.js';
import { createNotification } from '../notifications/notifications.service.js';
import { getCampById } from '../camps/camps.service.js';
import { receiveStock, announceLowStock } from '../resources/resources.service.js';
import { emitInventoryChanged } from '../../core/socket.js';
import { isLowStock } from '@frp/shared';

/** Create or update the caller's own donor profile — one profile per account. */
export async function upsertMyDonorProfile(input, { actorId }) {
  return Donor.findOneAndUpdate(
    { user_id: actorId },
    { $set: { ...input, user_id: actorId } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

export async function getMyDonorProfile(actorId) {
  return Donor.findOne({ user_id: actorId });
}

/**
 * §7 of the M2 design: an admin may record a donation on a donor's behalf
 * (a cheque phoned in, say), supplying donor_id. A donor's own submission
 * ignores any donor_id in the body and is always resolved from their own
 * account — nobody may donate as somebody else.
 */
async function resolveDonor(input, { actorId, actorRole }) {
  if (actorRole === 'admin') {
    if (!input.donor_id) {
      throw AppError.badRequest(
        'Choose which donor this is for.',
        [{ path: 'donor_id', message: 'Required when an admin records a donation.' }]
      );
    }
    const donor = await Donor.findById(input.donor_id);
    if (!donor) throw AppError.notFound('No donor with that id.');
    return donor;
  }
  const donor = await Donor.findOne({ user_id: actorId });
  if (!donor) throw AppError.badRequest('Create your donor profile before recording a donation.');
  return donor;
}

export async function raiseDonation(input, { actorId, actorRole, ip }) {
  const donor = await resolveDonor(input, { actorId, actorRole });
  if (input.target_camp_id) await getCampById(input.target_camp_id);

  const { donation, materials } = await withTransaction(async (session) => {
    const [donation] = await Donation.create([{
      donation_code: await nextDonationCode(session),
      donor_id: donor._id,
      donation_type: input.donation_type,
      target_camp_id: input.target_camp_id ?? null,
      purpose: input.purpose ?? '',
      amount: input.amount ?? null,
      payment_method: input.payment_method ?? '',
      payment_reference: input.payment_reference ?? '',
      recorded_by: actorId,
    }], { session });

    let materials = [];
    if (input.donation_type === 'material') {
      const lines = [];
      for (const line of input.materials) {
        const item = await ResourceItem.findById(line.resource_item_id).session(session);
        if (!item) {
          throw AppError.badRequest(
            'One of the donated items does not exist.',
            [{ path: 'materials', message: 'Choose a valid item.' }]
          );
        }
        lines.push({
          donation_id: donation._id, resource_item_id: item._id, item_label: item.name, category: item.category,
          quantity: line.quantity, unit: line.unit, estimated_value: line.estimated_value ?? 0, remarks: line.remarks ?? '',
        });
      }
      materials = await DonationMaterial.create(lines, { session });
    }

    await recordAudit({
      actor_id: actorId, actor_role: actorRole, action: 'donation.create',
      module: 'donations', record_id: donation._id,
      after: { donation_code: donation.donation_code, donation_type: donation.donation_type }, ip, session,
    });

    return { donation, materials };
  });

  await notifyAdminsOfNewDonation(donation, donor);

  return { donation, materials, donor };
}

async function notifyAdminsOfNewDonation(donation, donor) {
  const admins = await User.find({ role: 'admin', status: 'active' });
  const label = donation.donation_type === 'financial' ? `₹${donation.amount}` : 'a material donation';
  const message = `${donation.donation_code}: ${donor.name} recorded ${label}, awaiting confirmation.`;
  await Promise.all(admins.map((a) => createNotification({ user_id: a._id, type: 'donation', ref_id: donation._id, message })));
}

async function loadPendingDonation(donationId, session) {
  const donation = session ? await Donation.findById(donationId).session(session) : await Donation.findById(donationId);
  if (!donation) throw AppError.notFound('No donation with that id.');
  if (donation.status !== 'pending') {
    throw AppError.conflict('ALREADY_DECIDED', 'This donation has already been decided.');
  }
  return donation;
}

async function notifyDonorOfDecision(donation) {
  const donor = await Donor.findById(donation.donor_id);
  if (!donor) return;
  const message = donation.status === 'confirmed'
    ? `${donation.donation_code} has been confirmed. Thank you.`
    : `${donation.donation_code} was not accepted: ${donation.rejection_reason}`;
  await createNotification({ user_id: donor.user_id, type: 'donation_update', ref_id: donation._id, message });
}

async function rejectDonation(donationId, rejection_reason, { actorId, actorRole, ip }) {
  const donation = await loadPendingDonation(donationId);
  const before = { status: donation.status };
  donation.status = 'rejected';
  donation.rejection_reason = rejection_reason;
  donation.confirmed_by = actorId;
  donation.confirmed_at = new Date();
  await donation.save();

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'donation.reject',
    module: 'donations', record_id: donation._id, before, after: { status: 'rejected', rejection_reason }, ip,
  });
  await notifyDonorOfDecision(donation);
  return donation;
}

/**
 * Confirmation, spec section 4.1-4.2 of the M2 design: a material donation
 * with no target camp is refused (stock has to land somewhere). Stock
 * posting happens for every line inside the same transaction as the status
 * change, sequentially -- a session must not run concurrent operations.
 * Low-stock announcements and socket emits fire only after commit, the
 * same discipline distribution.service.js applies to a rolled-back attempt.
 */
async function confirmDonation(donationId, { actorId, actorRole, ip }) {
  const { donation, updatedLots } = await withTransaction(async (session) => {
    const donation = await loadPendingDonation(donationId, session);

    const updatedLots = [];
    if (donation.donation_type === 'material') {
      if (!donation.target_camp_id) {
        throw AppError.badRequest(
          'A material donation needs a target camp before it can be confirmed.',
          [{ path: 'target_camp_id', message: 'Choose which camp receives this.' }]
        );
      }
      const lines = await DonationMaterial.find({ donation_id: donation._id }).session(session);
      for (const line of lines) {
        const inv = await receiveStock(
          { camp_id: donation.target_camp_id, item_id: line.resource_item_id, quantity: line.quantity },
          { actorId, session }
        );
        updatedLots.push(inv);
      }
    }

    const before = { status: donation.status };
    donation.status = 'confirmed';
    donation.confirmed_by = actorId;
    donation.confirmed_at = new Date();
    await donation.save({ session });

    await recordAudit({
      actor_id: actorId, actor_role: actorRole, action: 'donation.confirm',
      module: 'donations', record_id: donation._id, before, after: { status: 'confirmed' }, ip, session,
    });

    return { donation, updatedLots };
  });

  updatedLots.forEach((inv) => {
    emitInventoryChanged(inv.camp_id, { itemId: String(inv.item_id), remaining_qty: inv.remaining_qty });
  });
  for (const inv of updatedLots) {
    if (isLowStock(inv)) await announceLowStock(inv);
  }

  await notifyDonorOfDecision(donation);
  return donation;
}

export async function decideDonation(donationId, { action, rejection_reason }, { actorId, actorRole, ip }) {
  return action === 'reject'
    ? rejectDonation(donationId, rejection_reason, { actorId, actorRole, ip })
    : confirmDonation(donationId, { actorId, actorRole, ip });
}
