import { ResourceItem } from './resourceItem.model.js';
import { Inventory } from './inventory.model.js';
import { isLowStock } from '@frp/shared';
import { AppError } from '../../core/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { emitInventoryChanged, emitLowStock } from '../../core/socket.js';

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
  if (isLowStock(inv)) {
    emitLowStock(inv.camp_id, { itemId: inv.item_id.toString(), remaining_qty: inv.remaining_qty, reorder_threshold: inv.reorder_threshold });
  }
  return inv;
}
