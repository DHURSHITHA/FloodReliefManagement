import { z } from 'zod';
import { objectId } from './camp.schema.js';

export const RESOURCE_CATEGORIES = ['food', 'medical', 'clothing', 'shelter', 'hygiene', 'other'];

export const createResourceItemSchema = z.object({
  name: z.string().trim().min(2, 'Item name is required.').max(120),
  category: z.enum(RESOURCE_CATEGORIES, { message: 'Select a valid category.' }),
  unit: z.string().trim().min(1, 'Unit is required (e.g. kg, liters, pieces).').max(30),
  description: z.string().trim().max(500).optional(),
});

export const createInventorySchema = z.object({
  camp_id: objectId,
  item_id: objectId,
  batch_no: z.string().trim().max(60).optional(),
  remaining_qty: z.coerce.number().nonnegative('Quantity cannot be negative.'),
  reorder_threshold: z.coerce.number().nonnegative('Threshold cannot be negative.'),
  expiry_date: z.coerce.date().optional(),
});

export const adjustInventorySchema = z.object({
  remaining_qty: z.coerce.number().nonnegative('Quantity cannot be negative.').optional(),
  reorder_threshold: z.coerce.number().nonnegative('Threshold cannot be negative.').optional(),
  expiry_date: z.coerce.date().nullable().optional(),
});
