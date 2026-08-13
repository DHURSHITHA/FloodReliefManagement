import { AffectedArea } from './affectedArea.model.js';
import { FloodAlert } from './floodAlert.model.js';
// Read-only cross-module model access for aggregation, the same precedent
// dashboard.service.js and distribution.service.js already establish (M1
// spec section 3.2) — this module still owns every write to `camps`
// through camps.service.js; it only ever reads camps here, to compute
// has_camp below.
import { Camp } from '../camps/camp.model.js';
import { AppError } from '../../core/errors.js';
import { recordAudit } from '../audit/audit.service.js';

export async function createArea(input, { actorId, actorRole, ip }) {
  const { latitude, longitude, ...rest } = input;
  const area = await AffectedArea.create({
    ...rest,
    location: { type: 'Point', coordinates: [longitude, latitude] },
    recorded_by: actorId,
  });

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'area.create',
    module: 'areas', record_id: area._id, after: area.toSafeJSON(), ip,
  });

  return area;
}

export async function getAreaById(areaId) {
  const area = await AffectedArea.findById(areaId);
  if (!area) throw AppError.notFound('No affected area with that id.');
  return area;
}

/**
 * Every area, each flagged with whether a camp has actually been built
 * there yet — the flag the Areas map's "camp created / no camp yet" filter
 * reads. Derived at read time from `camps.linked_area_id`, never stored on
 * the area itself (this codebase's standing rule against denormalised
 * totals, applied here to a boolean instead of a sum).
 */
export async function listAreas() {
  const [areas, linkedAreaIds] = await Promise.all([
    AffectedArea.find().sort({ createdAt: -1 }),
    Camp.distinct('linked_area_id', { linked_area_id: { $ne: null } }),
  ]);
  const linked = new Set(linkedAreaIds.map(String));
  return areas.map((area) => ({ ...area.toSafeJSON(), has_camp: linked.has(area.id) }));
}

export async function createAlert(areaId, input, { actorId, actorRole, ip }) {
  const area = await AffectedArea.findById(areaId);
  if (!area) throw AppError.notFound('No affected area with that id.');

  const alert = await FloodAlert.create({ ...input, area_id: area._id, raised_by: actorId });

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'alert.create',
    module: 'areas', record_id: alert._id,
    after: { area_id: area._id.toString(), message: alert.message, severity: alert.severity }, ip,
  });

  return { alert, area };
}

export async function listActiveAlerts() {
  const alerts = await FloodAlert.find({ status: 'active' }).sort({ createdAt: -1 }).populate('area_id', 'name district');
  return alerts.map((a) => ({
    id: a._id.toString(),
    message: a.message,
    severity: a.severity,
    area_id: a.area_id._id.toString(),
    area_name: a.area_id.name,
    area_district: a.area_id.district,
    createdAt: a.createdAt,
  }));
}
