import mongoose from 'mongoose';
import { Camp } from './camp.model.js';
import { deriveCampStatus } from './camp.status.js';
import { AppError } from '../../core/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { emitCampOccupancy } from '../../core/socket.js';
// Writes to `affected_areas` go through areas.service.js, never straight to
// its model — the M1 spec section 3.2 module-ownership rule, the same
// discipline donations.service.js follows when it posts stock through
// resources.service.js's receiveStock rather than the Inventory model.
import { createArea, getAreaById } from '../areas/areas.service.js';

function recomputeStatus(camp) {
  camp.status = deriveCampStatus({
    beneficiaries_accepted: camp.beneficiaries_accepted,
    beneficiary_capacity: camp.beneficiary_capacity,
    admin_override: camp.admin_override,
  });
}

function broadcastOccupancy(camp) {
  emitCampOccupancy(camp._id, {
    beneficiaries_accepted: camp.beneficiaries_accepted,
    beneficiary_capacity: camp.beneficiary_capacity,
    volunteers_accepted: camp.volunteers_accepted,
    volunteer_capacity: camp.volunteer_capacity,
    status: camp.status,
  });
}

/**
 * Every camp is linked to an affected area — chosen or, if none was chosen,
 * created here from the camp's own location fields. This is what makes the
 * Areas map's "camp created" filter trustworthy: an area only ever appears
 * unlinked because no camp has genuinely been built there yet, never
 * because a camp forgot to say so.
 */
async function resolveLinkedArea(input, { actorId, actorRole, ip }) {
  if (input.linked_area_id) {
    // A bad reference inside a create payload is the caller's mistake, not
    // a missing resource — 400, not 404, the same convention
    // donations.service.js uses for an unknown resource_item_id.
    try {
      const area = await getAreaById(input.linked_area_id);
      return area._id;
    } catch {
      throw AppError.badRequest(
        'Choose a valid affected area.',
        [{ path: 'linked_area_id', message: 'That area no longer exists.' }]
      );
    }
  }
  const area = await createArea(
    {
      name: input.area, district: input.district, state: input.state, address: input.address,
      latitude: input.latitude, longitude: input.longitude, severity: input.flood_severity,
      source: `Auto-created when camp "${input.name}" was registered`,
    },
    { actorId, actorRole, ip }
  );
  return area._id;
}

export async function createCamp(input, { actorId, actorRole, ip }) {
  const { latitude, longitude, ...rest } = input;
  const linked_area_id = await resolveLinkedArea(input, { actorId, actorRole, ip });
  const camp = new Camp({
    ...rest,
    linked_area_id,
    location: { type: 'Point', coordinates: [longitude, latitude] },
    created_by: actorId,
  });
  recomputeStatus(camp);
  await camp.save();

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'camp.create',
    module: 'camps', record_id: camp._id, after: camp.toSafeJSON(), ip,
  });

  broadcastOccupancy(camp);
  return camp;
}

export async function listCamps({ status, district } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (district) filter.district = district;
  return Camp.find(filter).sort({ createdAt: -1 });
}

export async function getCampById(campId) {
  const camp = await Camp.findById(campId);
  if (!camp) throw AppError.notFound('No camp with that id.');
  return camp;
}

export async function updateCamp(campId, input, { actorId, actorRole, ip }) {
  const camp = await getCampById(campId);
  const before = camp.toSafeJSON();

  const { latitude, longitude, ...rest } = input;
  Object.assign(camp, rest);
  if (latitude !== undefined && longitude !== undefined) {
    camp.location = { type: 'Point', coordinates: [longitude, latitude] };
  }
  recomputeStatus(camp);
  await camp.save();

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'camp.update',
    module: 'camps', record_id: camp._id, before, after: camp.toSafeJSON(), ip,
  });

  broadcastOccupancy(camp);
  return camp;
}

/**
 * Reserve N beneficiary slots atomically. Returns the updated camp, or
 * `null` if reserving N more would exceed capacity — the compare-and-swap
 * spec section 5.3 requires so two concurrent registrations for the last
 * bed cannot both succeed. Accepts an optional session so an enclosing
 * transaction (Plan 3's registration flow) rolls this back together with
 * everything else if a later step fails.
 */
export async function reserveBeneficiarySlots(campId, n, session) {
  const camp = await Camp.findOneAndUpdate(
    {
      _id: campId,
      $expr: { $lte: [{ $add: ['$beneficiaries_accepted', n] }, '$beneficiary_capacity'] },
    },
    { $inc: { beneficiaries_accepted: n } },
    { new: true, session }
  );
  if (!camp) return null;

  recomputeStatus(camp);
  await camp.save({ session });
  broadcastOccupancy(camp);
  return camp;
}

/**
 * Grant up to `requestedCount` volunteer slots, first-come-first-served.
 * Returns the number actually granted (0..requestedCount) — a partial
 * grant is expected, not an error (spec section 5.3): if three opt in
 * against two remaining slots, exactly two are granted.
 *
 * Classic compare-and-swap: read the current count, compute the grant that
 * fits, then write conditioned on that exact count still holding. If
 * another write landed in between, the conditional update matches nothing
 * and this retries with a fresh read — spec section 5.3's "compare-and-swap
 * guarded on the value observed... bounded retry on conflict", verbatim.
 * (A pipeline-only `$min` update was tried first and rejected: two
 * concurrent callers each computing their own before/after delta from
 * separate reads double-counts the grant even though the stored count
 * itself never overshoots — the return value, not the data, was wrong.)
 */
export async function reserveVolunteerSlots(campId, requestedCount, session, attempt = 0) {
  if (requestedCount <= 0) return 0;
  if (attempt >= 10) return 0; // heavy contention — give up rather than loop forever

  const camp = await Camp.findById(campId).session(session);
  if (!camp) return 0;

  const room = Math.max(0, camp.volunteer_capacity - camp.volunteers_accepted);
  const grant = Math.min(requestedCount, room);
  if (grant === 0) return 0;

  const updated = await Camp.findOneAndUpdate(
    { _id: campId, volunteers_accepted: camp.volunteers_accepted },
    { $inc: { volunteers_accepted: grant } },
    { new: true, session }
  );

  if (!updated) {
    // Someone else changed volunteers_accepted between our read and write — retry.
    return reserveVolunteerSlots(campId, requestedCount, session, attempt + 1);
  }

  recomputeStatus(updated);
  await updated.save({ session });
  broadcastOccupancy(updated);
  return grant;
}

/**
 * Camps with remaining beneficiary capacity, closest to the given point
 * first. Feeds both the landing page and, from Plan 3 onward, the 409
 * "nearest camp" recommendation when a chosen camp is full (spec §5.3).
 */
export async function findNearestOpenCamps({ latitude, longitude, excludeCampId, limit = 5 }) {
  const query = {
    $expr: { $lt: ['$beneficiaries_accepted', '$beneficiary_capacity'] },
    status: { $in: ['open', 'nearly_full'] },
  };
  if (excludeCampId) query._id = { $ne: new mongoose.Types.ObjectId(excludeCampId) };

  return Camp.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [longitude, latitude] },
        distanceField: 'distance_meters',
        spherical: true,
        query,
      },
    },
    { $limit: limit },
  ]);
}
