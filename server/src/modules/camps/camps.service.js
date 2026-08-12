import mongoose from 'mongoose';
import { Camp } from './camp.model.js';
import { deriveCampStatus } from './camp.status.js';
import { AppError } from '../../core/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { emitCampOccupancy } from '../../core/socket.js';

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

export async function createCamp(input, { actorId, actorRole, ip }) {
  const { latitude, longitude, ...rest } = input;
  const camp = new Camp({
    ...rest,
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
