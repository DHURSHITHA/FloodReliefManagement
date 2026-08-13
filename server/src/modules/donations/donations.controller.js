import * as donationsService from './donations.service.js';

export async function upsertMyDonorProfileHandler(req, res) {
  const donor = await donationsService.upsertMyDonorProfile(req.body, { actorId: req.user.id });
  res.json({ donor: donor.toSafeJSON() });
}

export async function getMyDonorProfileHandler(req, res) {
  const donor = await donationsService.getMyDonorProfile(req.user.id);
  res.json({ donor: donor ? donor.toSafeJSON() : null });
}
