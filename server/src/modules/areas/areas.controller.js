import * as areasService from './areas.service.js';

export async function createAreaHandler(req, res) {
  const area = await areasService.createArea(req.body, { actorId: req.user.id, actorRole: req.user.role, ip: req.ip });
  res.status(201).json({ area: area.toSafeJSON() });
}

export async function listAreasHandler(req, res) {
  const areas = await areasService.listAreas();
  res.json({ areas });
}

export async function createAlertHandler(req, res) {
  const { alert } = await areasService.createAlert(req.params.areaId, req.body, {
    actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
  });
  res.status(201).json({
    alert: { id: alert._id.toString(), message: alert.message, severity: alert.severity, status: alert.status, area_id: alert.area_id.toString() },
  });
}

export async function listActiveAlertsHandler(req, res) {
  const alerts = await areasService.listActiveAlerts();
  res.json({ alerts });
}
