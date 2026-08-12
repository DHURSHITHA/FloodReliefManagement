import * as notificationsService from './notifications.service.js';

export async function listNotificationsHandler(req, res) {
  const list = await notificationsService.listNotifications(req.user.id);
  res.json({ notifications: list.map((n) => n.toSafeJSON()) });
}

export async function markReadHandler(req, res) {
  const n = await notificationsService.markRead(req.params.id, req.user.id);
  res.json({ notification: n.toSafeJSON() });
}
