import { z } from 'zod';

/**
 * Requirements §6.10 Complaint Management.
 *
 * Fields per the spec: Complaint ID, Reporter, Camp, Category, Description,
 * Date, Priority, Status, Assigned Person, Resolution, Resolved Date.
 * Statuses are the five the spec names, verbatim.
 *
 * SOS/emergency (§6.11) is a separate module and stays deferred — this is the
 * ordinary complaint channel, not the emergency one.
 */
export const COMPLAINT_CATEGORIES = [
  'food',
  'water',
  'sanitation',
  'medical',
  'shelter',
  'safety',
  'volunteer',
  'other',
];

export const COMPLAINT_STATUSES = ['open', 'under_review', 'in_progress', 'resolved', 'rejected'];
export const COMPLAINT_PRIORITIES = ['low', 'normal', 'high'];

/** Statuses that mean nobody is working on it any more. */
export const CLOSED_COMPLAINT_STATUSES = ['resolved', 'rejected'];

export const createComplaintSchema = z.object({
  camp_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Choose the camp this is about.'),
  category: z.enum(COMPLAINT_CATEGORIES, { message: 'Choose a category.' }),
  description: z
    .string()
    .trim()
    .min(10, 'Describe the problem in at least 10 characters.')
    .max(2000, 'Keep it under 2000 characters.'),
  priority: z.enum(COMPLAINT_PRIORITIES).default('normal'),
});

/**
 * Resolution text is required exactly when the complaint is being closed —
 * "resolved" with no account of what was done is not a resolution, and a
 * rejection without a reason is worse.
 */
export const updateComplaintSchema = z.object({
  status: z.enum(COMPLAINT_STATUSES, { message: 'Choose a status.' }),
  resolution: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(2000).optional(),
  ),
}).superRefine((val, ctx) => {
  if (CLOSED_COMPLAINT_STATUSES.includes(val.status) && !val.resolution) {
    ctx.addIssue({
      code: 'custom',
      path: ['resolution'],
      message: 'Say what was done before closing this.',
    });
  }
});

export const listComplaintsQuerySchema = z.object({
  camp_id: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid camp id.').optional(),
  ),
  status: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(COMPLAINT_STATUSES).optional(),
  ),
});
