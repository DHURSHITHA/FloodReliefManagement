import { z } from 'zod';
import { objectId } from './camp.schema.js';

export const DISTRIBUTION_MODES = ['per_head', 'family_band', 'fixed'];
export const DISTRIBUTION_PERIODS = ['daily', 'weekly', 'once'];
export const ELIGIBILITY_TAGS = ['has_pregnant', 'has_disability', 'has_senior_citizen', 'has_child'];

const bandSchema = z.object({
  min: z.coerce.number().int().nonnegative(),
  max: z.coerce.number().int().nonnegative(),
  qty: z.coerce.number().nonnegative(),
});

const addonSchema = z.object({
  when: z.enum(ELIGIBILITY_TAGS),
  extra_qty: z.coerce.number().nonnegative(),
});

export const createDistributionRuleSchema = z.object({
  item_id: objectId,
  camp_id: objectId.nullable().optional(),
  mode: z.enum(DISTRIBUTION_MODES, { message: 'Select a valid mode.' }),
  period: z.enum(DISTRIBUTION_PERIODS, { message: 'Select a valid period.' }),
  bands: z.array(bandSchema).optional(),
  per_head_qty: z.coerce.number().nonnegative().optional(),
  fixed_qty: z.coerce.number().nonnegative().optional(),
  priority_addons: z.array(addonSchema).optional(),
  eligibility: z.array(z.enum(ELIGIBILITY_TAGS)).optional(),
  min_qty: z.coerce.number().nonnegative().optional(),
  max_qty: z.coerce.number().nonnegative().optional(),
  effective_from: z.coerce.date().optional(),
  effective_to: z.coerce.date().optional(),
  active: z.boolean().default(true),
});

/**
 * Editing a rule already in place — every field optional, the same
 * `createSchema.partial()` convention every other module's update schema
 * follows (updateCampSchema, updateComplaintSchema). Including camp_id and
 * item_id lets an admin re-target a rule, not just adjust its terms; the
 * server still enforces at most one active rule per camp+item either way.
 */
export const updateDistributionRuleSchema = createDistributionRuleSchema.partial();

export const distributeItemSchema = z.object({
  beneficiary_id: objectId,
  item_id: objectId,
  override_reason: z.string().trim().min(1).max(500).optional(),
});
