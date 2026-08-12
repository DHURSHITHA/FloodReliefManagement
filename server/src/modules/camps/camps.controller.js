import * as campsService from './camps.service.js';

export async function createCampHandler(req, res) {
  const camp = await campsService.createCamp(req.body, { actorId: req.user.id, actorRole: req.user.role, ip: req.ip });
  res.status(201).json({ camp: camp.toSafeJSON() });
}

export async function listCampsHandler(req, res) {
  const { status, district } = req.query;
  const camps = await campsService.listCamps({ status, district });
  res.json({ camps: camps.map((c) => c.toSafeJSON()) });
}

export async function getCampHandler(req, res) {
  const camp = await campsService.getCampById(req.params.id);
  res.json({ camp: camp.toSafeJSON() });
}

export async function updateCampHandler(req, res) {
  const camp = await campsService.updateCamp(req.params.id, req.body, {
    actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
  });
  res.json({ camp: camp.toSafeJSON() });
}

export async function nearestCampsHandler(req, res) {
  const { latitude, longitude, excludeCampId } = req.validatedQuery;
  const results = await campsService.findNearestOpenCamps({ latitude, longitude, excludeCampId });
  res.json({
    camps: results.map((c) => ({
      id: c._id.toString(), name: c.name, district: c.district, status: c.status,
      beneficiary_capacity: c.beneficiary_capacity, beneficiaries_accepted: c.beneficiaries_accepted,
      distance_meters: Math.round(c.distance_meters),
    })),
  });
}
