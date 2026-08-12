import { ResourceItem } from './resourceItem.model.js';
import { Inventory } from './inventory.model.js';
import { isLowStock } from '@frp/shared';
import { AppError } from '../../core/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { emitInventoryChanged, emitLowStock } from '../../core/socket.js';
import { User } from '../auth/user.model.js';
import { createNotification } from '../notifications/notifications.service.js';

/**
 * Announce a low-stock crossing two ways. The socket event is transient —
 * it only reaches whoever happens to be connected at that instant — so a
 * stored notification per admin is what survives being offline.
 */
export async function announceLowStock(inv) {
  emitLowStock(inv.camp_id, {
    itemId: inv.item_id.toString(),
    remaining_qty: inv.remaining_qty,
    reorder_threshold: inv.reorder_threshold,
  });

  const item = await ResourceItem.findById(inv.item_id);
  const label = item ? `${item.name} (${item.unit})` : 'An item';
  const admins = await User.find({ role: 'admin', status: 'active' });

  await Promise.all(
    admins.map((a) =>
      createNotification({
        user_id: a._id,
        type: 'low_stock',
        ref_id: inv._id,
        message: `${label} is low: ${inv.remaining_qty} left, reorder threshold ${inv.reorder_threshold}.`,
      })
    )
  );
}

export async function createResourceItem(input, { actorId, actorRole, ip }) {
  const item = await ResourceItem.create({ ...input, created_by: actorId });
  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'resource_item.create',
    module: 'resources', record_id: item._id, after: item.toSafeJSON(), ip,
  });
  return item;
}

export async function listResourceItems() {
  return ResourceItem.find().sort({ name: 1 });
}

export async function createInventory(input, { actorId, actorRole, ip }) {
  const inv = await Inventory.create({ ...input, created_by: actorId });
  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'inventory.create',
    module: 'resources', record_id: inv._id, after: inv.toSafeJSON(), ip,
  });
  emitInventoryChanged(inv.camp_id, { itemId: inv.item_id.toString(), remaining_qty: inv.remaining_qty });
  return inv;
}

export async function listInventory({ camp_id } = {}) {
  const filter = {};
  if (camp_id) filter.camp_id = camp_id;
  return Inventory.find(filter).sort({ createdAt: -1 });
}

export async function getInventoryById(id) {
  const inv = await Inventory.findById(id);
  if (!inv) throw AppError.notFound('No inventory entry with that id.');
  return inv;
}

export async function adjustInventory(id, input, { actorId, actorRole, ip }) {
  const inv = await getInventoryById(id);
  const before = inv.toSafeJSON();
  Object.assign(inv, input);
  await inv.save();

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'inventory.adjust',
    module: 'resources', record_id: inv._id, before, after: inv.toSafeJSON(), ip,
  });

  emitInventoryChanged(inv.camp_id, { itemId: inv.item_id.toString(), remaining_qty: inv.remaining_qty });
  if (isLowStock(inv)) await announceLowStock(inv);
  return inv;
}
