import { isLowStock, isNearExpiry, isExpired } from '@frp/shared';
import * as resourcesService from './resources.service.js';

export async function createResourceItemHandler(req, res) {
  const item = await resourcesService.createResourceItem(req.body, { actorId: req.user.id, actorRole: req.user.role, ip: req.ip });
  res.status(201).json({ item: item.toSafeJSON() });
}

export async function listResourceItemsHandler(req, res) {
  const items = await resourcesService.listResourceItems();
  res.json({ items: items.map((i) => i.toSafeJSON()) });
}

function withStockFlags(inv) {
  const json = inv.toSafeJSON();
  return {
    ...json,
    is_low_stock: isLowStock(json),
    is_near_expiry: isNearExpiry(json.expiry_date),
    is_expired: isExpired(json.expiry_date),
  };
}

export async function createInventoryHandler(req, res) {
  const inv = await resourcesService.createInventory(req.body, { actorId: req.user.id, actorRole: req.user.role, ip: req.ip });
  res.status(201).json({ inventory: withStockFlags(inv) });
}

export async function listInventoryHandler(req, res) {
  const { camp_id } = req.query;
  const inventory = await resourcesService.listInventory({ camp_id });
  res.json({ inventory: inventory.map(withStockFlags) });
}

export async function adjustInventoryHandler(req, res) {
  const inv = await resourcesService.adjustInventory(req.params.id, req.body, {
    actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
  });
  res.json({ inventory: withStockFlags(inv) });
}
