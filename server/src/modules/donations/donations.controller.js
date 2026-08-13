import * as donationsService from './donations.service.js';

/** Shapes a {donation, materials, donor?} result into the flat JSON the client reads. */
function toDonationJSON({ donation, materials = [], donor = null }) {
  return {
    ...donation.toSafeJSON(),
    materials: materials.map((m) => m.toSafeJSON()),
    donor_name: donor ? donor.name : null,
    donor_type: donor ? donor.donor_type : null,
  };
}

export async function upsertMyDonorProfileHandler(req, res) {
  const donor = await donationsService.upsertMyDonorProfile(req.body, { actorId: req.user.id });
  res.json({ donor: donor.toSafeJSON() });
}

export async function getMyDonorProfileHandler(req, res) {
  const donor = await donationsService.getMyDonorProfile(req.user.id);
  res.json({ donor: donor ? donor.toSafeJSON() : null });
}

export async function raiseDonationHandler(req, res) {
  const result = await donationsService.raiseDonation(req.body, {
    actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
  });
  res.status(201).json({ donation: toDonationJSON(result) });
}
