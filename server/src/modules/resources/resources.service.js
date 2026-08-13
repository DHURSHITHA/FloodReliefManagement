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

/**
 * Post a stock increase for camp_id/item_id, creating the lot if this is
 * the first stock this camp has ever held for that item. The only caller
 * outside this module is a confirmed material donation (spec §4.2) — donors
 * reach Inventory only through this function, never the model.
 *
 * A donation-created lot starts with reorder_threshold 0 (no low-stock
 * alert) until an admin sets a real one via the existing adjust endpoint —
 * a donation has no basis to guess what "low" means for this camp.
 *
 * Marked source:'donation' and matched/inserted against that field
 * specifically: a plain {camp_id, item_id} upsert is not race-safe under
 * concurrent first-time receipt (two calls can both see "no lot yet" and
 * both insert). The partial unique index on inventory.model.js enforces at
 * most one source:'donation' lot per camp/item; a concurrent loser gets a
 * duplicate-key error here and retries, folding its receipt into the
 * winner's lot instead of creating a second one. Manually-created batches
 * are untouched by this — they default to source:'manual' and the index
 * does not apply to them.
 *
 * No side effects here on purpose: this is called from inside another
 * module's transaction, and a socket emit or notification must never fire
 * from work that might still be rolled back. The caller announces
 * low-stock and broadcasts the change after its own transaction commits.
 */
export async function receiveStock({ camp_id, item_id, quantity, expiry_date = null }, { actorId, session } = {}) {
  try {
    return await Inventory.findOneAndUpdate(
      { camp_id, item_id, source: 'donation' },
      {
        $inc: { remaining_qty: quantity },
        $setOnInsert: {
          camp_id, item_id, source: 'donation', distributed_qty: 0, reorder_threshold: 0, expiry_date, created_by: actorId,
        },
      },
      { new: true, upsert: true, session }
    );
  } catch (err) {
    if (err?.code === 11000) {
      return receiveStock({ camp_id, item_id, quantity, expiry_date }, { actorId, session });
    }
    throw err;
  }
}
