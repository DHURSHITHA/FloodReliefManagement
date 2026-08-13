import * as sosService from './sos.service.js';

export async function raiseSosHandler(req, res) {
  const sos = await sosService.raiseSos(req.body, {
    actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
  });
  res.status(201).json({ sos: sos.toSafeJSON() });
}

export async function listMySosHandler(req, res) {
  const requests = await sosService.listMySos(req.user.id);
  res.json({ sos_requests: requests.map((s) => s.toSafeJSON()) });
}

export async function listSosHandler(req, res) {
  const requests = await sosService.listSos({
    actorRole: req.user.role,
    actorCampIds: req.user.camp_ids,
    selectedCampId: req.validatedQuery?.camp_id,
    status: req.validatedQuery?.status,
  });
  res.json({ sos_requests: requests.map((s) => s.toSafeJSON()) });
}

export async function transitionSosHandler(req, res) {
  const sos = await sosService.transitionSos(req.params.id, req.body, {
    actorId: req.user.id, actorRole: req.user.role, actorCampIds: req.user.camp_ids, ip: req.ip,
  });
  res.json({ sos: sos.toSafeJSON() });
}
