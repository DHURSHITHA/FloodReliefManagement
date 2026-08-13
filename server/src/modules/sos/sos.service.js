import { CLOSED_SOS_STATUSES, bySosPriority } from '@frp/shared';
import { SosRequest } from './sos.model.js';
import { User } from '../auth/user.model.js';
import { AppError } from '../../core/errors.js';
import { nextSosCode } from '../../core/idGenerator.js';
import { recordAudit } from '../audit/audit.service.js';
import { createNotification } from '../notifications/notifications.service.js';
import { resolveCampScope } from '../intake/intake.service.js';
import { getCampById } from '../camps/camps.service.js';
import { emitSosUpdate } from '../../core/socket.js';

/**
 * SOS / Emergency management, requirements §6.11.
 *
 * Hospital and police accounts do not exist (out of scope permanently, per
 * requirements §3.2), so "route to the hospital/police contact" cannot mean
 * notifying a login. It means: resolve that camp's linked contact, stamp it
 * onto the record so whoever picks this up sees a name and a number to call,
 * and track what happens next to resolution.
 */
function resolveRouting(camp, category) {
  if (category === 'medical') {
    return {
      routed_to_type: 'hospital',
      routed_to_name: camp.nearest_hospital_name,
      routed_to_contact: camp.nearest_hospital_contact,
    };
  }
  if (category === 'security') {
    return {
      routed_to_type: 'police',
      routed_to_name: camp.nearest_police_name,
      routed_to_contact: camp.nearest_police_contact,
    };
  }
  return {
    routed_to_type: 'camp_admin',
    routed_to_name: `${camp.name} camp administration`,
    routed_to_contact: camp.official_contact_number || 'Not on file — contact the camp directly.',
  };
}

export async function raiseSos({ camp_id, category, urgency, description, location }, { actorId, actorRole, ip }) {
  const camp = await getCampById(camp_id);
  const routing = resolveRouting(camp, category);
  const now = new Date();

  const sos = await SosRequest.create({
    sos_code: await nextSosCode(),
    reported_by: actorId,
    reporter_role: actorRole,
    camp_id,
    category,
    urgency,
    description,
    location,
    ...routing,
    timeline: [{ status: 'open', actor_id: actorId, note: '', at: now }],
  });

  await notifyOnRaise(sos);
  emitSosUpdate(sos.camp_id, { sosId: sos._id.toString(), status: sos.status, urgency: sos.urgency });

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'sos.create',
    module: 'sos', record_id: sos._id,
    after: { sos_code: sos.sos_code, category, urgency, routed_to_type: routing.routed_to_type }, ip,
  });

  return sos;
}

/**
 * §14: admins hear about every SOS; camp officials hear about emergencies at
 * their own camp. Both — an SOS is not routine traffic the way a complaint
 * is, and §6.11 asks for it on the admin dashboard "immediately".
 */
async function notifyOnRaise(sos) {
  const [admins, officials] = await Promise.all([
    User.find({ role: 'admin', status: 'active' }),
    User.find({ role: 'camp_official', status: 'active', assigned_camp_ids: sos.camp_id }),
  ]);

  const message = `${sos.sos_code}: a ${sos.urgency} ${sos.category.replace('_', ' ')} emergency was raised, routed to ${sos.routed_to_name}.`;

  await Promise.all(
    [...admins, ...officials].map((u) => createNotification({
      user_id: u._id, type: 'sos', ref_id: sos._id, message,
    }))
  );
}

/**
 * What the reporter sees: their own SOS requests, most urgent-and-open
 * first. Not `.limit()`ed before the sort — a person reports few enough of
 * these that truncation risk does not apply, and correctness (nothing
 * urgent silently missing) matters more here than anywhere else in the app.
 */
export async function listMySos(actorId) {
  const mine = await SosRequest.find({ reported_by: actorId });
  return mine.sort(bySosPriority);
}

/** The Emergency dashboard: camp-scoped for officials, all camps for admins. */
export async function listSos({ actorRole, actorCampIds, selectedCampId, status }) {
  const filter = { ...resolveCampScope({ actorRole, actorCampIds, selectedCampId }).filter };
  if (status) filter.status = status;
  const requests = await SosRequest.find(filter);
  return requests.sort(bySosPriority);
}

export async function transitionSos(sosId, { status, note }, { actorId, actorRole, actorCampIds, ip }) {
  const scope = resolveCampScope({ actorRole, actorCampIds });

  const sos = await SosRequest.findById(sosId);
  if (!sos) throw AppError.notFound('No SOS request with that id.');
  if (!scope.allows(sos.camp_id)) {
    throw AppError.forbidden('That SOS request is at a camp you are not assigned to.');
  }

  const before = { status: sos.status };
  const now = new Date();
  sos.status = status;
  if (CLOSED_SOS_STATUSES.includes(status) && note) sos.resolution = note;
  sos.resolved_at = CLOSED_SOS_STATUSES.includes(status) ? now : null;
  sos.timeline.push({ status, actor_id: actorId, note: note ?? '', at: now });
  await sos.save();

  // Tell the person who raised it — the same reasoning as complaints: an
  // emergency nobody hears back on reads as one nobody is handling.
  await createNotification({
    user_id: sos.reported_by,
    type: 'sos_update',
    ref_id: sos._id,
    message: `${sos.sos_code} is now ${status.replace('_', ' ')}.`,
  });
  emitSosUpdate(sos.camp_id, { sosId: sos._id.toString(), status: sos.status, urgency: sos.urgency });

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'sos.transition',
    module: 'sos', record_id: sos._id,
    before, after: { status: sos.status }, ip,
  });

  return sos;
}

/** Requirements §6.16 Emergency dashboard area: open, medical, security, resolved. */
export async function getSosDashboardCounts() {
  const [open, medical, security, resolved] = await Promise.all([
    SosRequest.countDocuments({ status: { $nin: CLOSED_SOS_STATUSES } }),
    SosRequest.countDocuments({ category: 'medical', status: { $nin: CLOSED_SOS_STATUSES } }),
    SosRequest.countDocuments({ category: 'security', status: { $nin: CLOSED_SOS_STATUSES } }),
    SosRequest.countDocuments({ status: 'resolved' }),
  ]);
  return { open, medical, security, resolved };
}
