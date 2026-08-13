import { Donor } from './donor.model.js';

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
