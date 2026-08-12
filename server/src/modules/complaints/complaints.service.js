import { CLOSED_COMPLAINT_STATUSES } from '@frp/shared';
import { Complaint } from './complaint.model.js';
import { User } from '../auth/user.model.js';
import { AppError } from '../../core/errors.js';
import { nextComplaintCode } from '../../core/idGenerator.js';
import { recordAudit } from '../audit/audit.service.js';
import { createNotification } from '../notifications/notifications.service.js';
import { resolveCampScope } from '../intake/intake.service.js';

/**
 * Complaint management, requirements §6.10.
 *
 * A complaint belongs to a camp, and that is what routes it: the officials
 * assigned to that camp are the ones notified and the only ones who see it.
 * Admins see every camp's.
 */
export async function raiseComplaint({ camp_id, category, description, priority }, { actorId, actorRole, ip }) {
  const complaint = await Complaint.create({
    complaint_code: await nextComplaintCode(),
    reporter_id: actorId,
    reporter_role: actorRole,
    camp_id,
    category,
    description,
    priority,
  });

  await notifyCampOfficials(complaint);

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'complaint.create',
    module: 'complaints', record_id: complaint._id,
    after: { complaint_code: complaint.complaint_code, category, priority }, ip,
  });

  return complaint;
}

/**
 * Routing, per the user's own words: the query "reaches the respective camp
 * official". Anyone assigned to that camp is notified; admins are not, because
 * they have the dashboard and would otherwise get every camp's traffic.
 */
async function notifyCampOfficials(complaint) {
  const officials = await User.find({
    role: 'camp_official',
    status: 'active',
    assigned_camp_ids: complaint.camp_id,
  });

  await Promise.all(officials.map((o) => createNotification({
    user_id: o._id,
    type: 'complaint',
    ref_id: complaint._id,
    message: `${complaint.complaint_code}: a new ${complaint.category} complaint was raised.`,
  })));
}

/** What the reporter sees: their own complaints, newest first, at any camp. */
export async function listMyComplaints(actorId) {
  return Complaint.find({ reporter_id: actorId }).sort({ createdAt: -1 }).limit(100);
}

/** What an official sees: the camps they run, narrowed by the camp bar. */
export async function listComplaints({ actorRole, actorCampIds, selectedCampId, status }) {
  const filter = { ...resolveCampScope({ actorRole, actorCampIds, selectedCampId }).filter };
  if (status) filter.status = status;
  return Complaint.find(filter).sort({ createdAt: -1 }).limit(200);
}

export async function reviewComplaint(complaintId, { status, resolution }, { actorId, actorRole, actorCampIds, ip }) {
  const scope = resolveCampScope({ actorRole, actorCampIds });

  const complaint = await Complaint.findById(complaintId);
  if (!complaint) throw AppError.notFound('No complaint with that id.');
  if (!scope.allows(complaint.camp_id)) {
    throw AppError.forbidden('That complaint is at a camp you are not assigned to.');
  }

  const before = { status: complaint.status };
  complaint.status = status;
  // Whoever moves it off "open" owns it from then on.
  if (!complaint.assigned_to) complaint.assigned_to = actorId;
  if (resolution) complaint.resolution = resolution;
  complaint.resolved_at = CLOSED_COMPLAINT_STATUSES.includes(status) ? new Date() : null;
  await complaint.save();

  // Tell the person who raised it — a complaint nobody hears back on is
  // indistinguishable from one that was never read.
  await createNotification({
    user_id: complaint.reporter_id,
    type: 'complaint_update',
    ref_id: complaint._id,
    message: `${complaint.complaint_code} is now ${status.replace('_', ' ')}.`,
  });

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'complaint.review',
    module: 'complaints', record_id: complaint._id,
    before, after: { status: complaint.status }, ip,
  });

  return complaint;
}
