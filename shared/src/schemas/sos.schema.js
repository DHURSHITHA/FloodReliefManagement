import { z } from 'zod';

/**
 * Requirements §6.11 SOS / Emergency Management.
 *
 * Categories are the six the spec names, verbatim. Unlike complaints (§6.10,
 * which spells out its status list), §6.11 does not fix urgency or status —
 * both are design choices here. Urgency drives the "flagged by urgency"
 * dashboard ordering the spec asks for. Status widens complaints' three
 * working states by one (acknowledged, responding) because "track response
 * and resolution timeline" asks for more granularity than a query does.
 *
 * Hospital and police have no login accounts (out of scope permanently,
 * §3.2) — see sos.service.js for what "routed to" actually means as a result.
 */
export const SOS_CATEGORIES = [
  'medical',
  'security',
  'food_shortage',
  'water_shortage',
  'missing_person',
  'other',
];

export const SOS_URGENCY = ['critical', 'high', 'medium', 'low'];

export const SOS_STATUSES = ['open', 'acknowledged', 'responding', 'resolved', 'closed'];

/** Statuses that mean nobody is actively responding any more. */
export const CLOSED_SOS_STATUSES = ['resolved', 'closed'];

export const createSosSchema = z.object({
  camp_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Choose the camp this is about.'),
  category: z.enum(SOS_CATEGORIES, { message: 'Choose a category.' }),
  urgency: z.enum(SOS_URGENCY, { message: 'Choose how urgent this is.' }),
  description: z
    .string()
    .trim()
    .min(10, 'Describe the emergency in at least 10 characters.')
    .max(2000, 'Keep it under 2000 characters.'),
  location: z
    .string()
    .trim()
    .min(2, 'Say roughly where — e.g. "block 4 tents" or "near the food line".')
    .max(200),
});

/**
 * A transition off "open". A closing status with no account of what
 * happened is not a resolution — the same rule complaints enforces for both
 * of its closing statuses (resolved and rejected), applied here to both of
 * SOS's (resolved and closed).
 */
export const updateSosSchema = z.object({
  status: z.enum(['acknowledged', 'responding', 'resolved', 'closed'], { message: 'Choose a status.' }),
  note: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(2000).optional(),
  ),
}).superRefine((val, ctx) => {
  if (CLOSED_SOS_STATUSES.includes(val.status) && !val.note) {
    ctx.addIssue({
      code: 'custom',
      path: ['note'],
      message: 'Say what was done before closing this.',
    });
  }
});

export const listSosQuerySchema = z.object({
  camp_id: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid camp id.').optional(),
  ),
  status: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(SOS_STATUSES).optional(),
  ),
});
