import { z } from 'zod';
import { objectId } from './camp.schema.js';

/**
 * Requirements §6.13 Donation Management. A single schema for both types
 * rather than two, discriminated by `donation_type` inside superRefine,
 * because a form toggling between them needs one shape to submit against.
 *
 * `target_camp_id` is optional here even for a material donation — §4.2 of
 * the M2 design makes that a *confirmation-time* rule ("stock has to land
 * somewhere"), not a creation-time one. A donor may record a donation
 * before a camp has been decided.
 */
export const DONATION_TYPES = ['financial', 'material'];
export const DONATION_STATUSES = ['pending', 'confirmed', 'rejected'];

const donationMaterialItemSchema = z.object({
  resource_item_id: objectId,
  quantity: z.coerce.number().positive('Quantity must be greater than zero.'),
  unit: z.string().trim().min(1, 'Unit is required (e.g. kg, liters, pieces).').max(30),
  estimated_value: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().nonnegative('Value cannot be negative.').optional(),
  ),
  remarks: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(300).optional(),
  ),
});

export const createDonationSchema = z.object({
  donation_type: z.enum(DONATION_TYPES, { message: 'Choose a donation type.' }),
  // Set by an admin recording on a donor's behalf; a donor's own submission
  // ignores this and is resolved server-side from their account.
  donor_id: z.preprocess((v) => (v === '' ? undefined : v), objectId.optional()),
  target_camp_id: z.preprocess((v) => (v === '' ? undefined : v), objectId.optional()),
  purpose: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(300).optional(),
  ),
  amount: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().positive('Enter the donated amount.').optional(),
  ),
  payment_method: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(60).optional(),
  ),
  payment_reference: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(120).optional(),
  ),
  materials: z.array(donationMaterialItemSchema).optional(),
}).superRefine((val, ctx) => {
  if (val.donation_type === 'financial') {
    if (!val.amount) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Enter the donated amount.' });
    if (!val.payment_method) ctx.addIssue({ code: 'custom', path: ['payment_method'], message: 'Say how this was paid.' });
    if (val.materials?.length) {
      ctx.addIssue({ code: 'custom', path: ['materials'], message: 'A financial donation does not carry material items.' });
    }
  } else {
    if (!val.materials || val.materials.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['materials'], message: 'Add at least one item.' });
    }
    if (val.amount) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'A material donation does not carry an amount.' });
    }
  }
});

/**
 * A closing decision on a pending donation. Rejection requires a reason —
 * the same rule complaints and SOS apply to their own closing statuses.
 */
export const donationDecisionSchema = z.object({
  action: z.enum(['confirm', 'reject'], { message: 'Choose confirm or reject.' }),
  rejection_reason: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(500).optional(),
  ),
}).superRefine((val, ctx) => {
  if (val.action === 'reject' && !val.rejection_reason) {
    ctx.addIssue({ code: 'custom', path: ['rejection_reason'], message: 'Say why this donation is being rejected.' });
  }
});

export const listDonationsQuerySchema = z.object({
  status: z.preprocess((v) => (v === '' ? undefined : v), z.enum(DONATION_STATUSES).optional()),
  donation_type: z.preprocess((v) => (v === '' ? undefined : v), z.enum(DONATION_TYPES).optional()),
});
