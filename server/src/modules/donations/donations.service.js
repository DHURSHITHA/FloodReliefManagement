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
