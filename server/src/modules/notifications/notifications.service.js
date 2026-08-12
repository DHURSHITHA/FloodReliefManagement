import { Notification } from './notification.model.js';
import { AppError } from '../../core/errors.js';

export async function createNotification({ user_id, type, message, ref_id = null }) {
  return Notification.create({ user_id, type, message, ref_id });
}

export async function listNotifications(userId) {
  return Notification.find({ user_id: userId }).sort({ createdAt: -1 }).limit(50);
}

export async function markRead(id, userId) {
  const n = await Notification.findOne({ _id: id, user_id: userId });
  if (!n) throw AppError.notFound('No notification with that id.');
  n.read = true;
  await n.save();
  return n;
}
