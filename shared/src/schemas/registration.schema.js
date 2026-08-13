import { z } from 'zod';
import { objectId } from './camp.schema.js';
import { isValidAadhaar } from '../aadhaar.js';

const mobileRegex = /^(?:\+91|0)?[6-9]\d{9}$/;

// An untouched optional field arrives from the client as '', not undefined.
// z.optional() only skips undefined, so without this an empty string would
// trip the field's own min()/regex() before superRefine's friendlier,
// position-aware message ever gets a chance to run.
const optionalTrimmed = (inner) => z.preprocess((v) => (v === '' ? undefined : v), inner.optional());

export const registrationMemberInputSchema = z.object({
  name: z.string().trim().min(2, 'Name is required.').max(120),
  age: z.coerce.number().int().min(0, 'Age must be zero or more.').max(120),
  gender: z.enum(['male', 'female', 'other'], { message: 'Select a valid gender.' }),
  aadhaar: z.string().trim().refine(isValidAadhaar, 'Enter a valid Aadhaar number.'),
  is_pregnant: z.boolean().default(false),
  has_disability: z.boolean().default(false),
  wants_to_volunteer: z.boolean().default(false),
  relation_to_applicant: optionalTrimmed(z.string().trim().min(1).max(60)),
  mobile: optionalTrimmed(z.string().trim().regex(mobileRegex, 'Enter a valid 10-digit mobile number.')),
  address: optionalTrimmed(z.string().trim().min(1).max(300)),
});

export const createRegistrationSchema = z
  .object({
    camp_id: objectId,
    members: z
      .array(registrationMemberInputSchema)
      .min(1, 'At least one person is required.')
      .max(20, 'Register at most 20 people at once.'),
  })
  .superRefine((data, ctx) => {
    data.members.forEach((m, i) => {
      if (i === 0) {
        if (!m.mobile) {
          ctx.addIssue({ code: 'custom', path: ['members', i, 'mobile'], message: 'A mobile number is required for the applicant.' });
        }
        if (!m.address) {
          ctx.addIssue({ code: 'custom', path: ['members', i, 'address'], message: 'An address is required for the applicant.' });
        }
      } else if (!m.relation_to_applicant) {
        ctx.addIssue({ code: 'custom', path: ['members', i, 'relation_to_applicant'], message: 'Relation to the applicant is required.' });
      }

      if (m.wants_to_volunteer && m.age < 18) {
        ctx.addIssue({ code: 'custom', path: ['members', i, 'wants_to_volunteer'], message: 'A volunteer must be at least 18 years old.' });
      }
      if (m.is_pregnant && m.gender === 'male') {
        ctx.addIssue({ code: 'custom', path: ['members', i, 'is_pregnant'], message: 'Pregnancy cannot be marked for a male member.' });
      }
    });
  });

/** `camp_id` is the camp chosen in the camp bar — it narrows the search to one camp. */
export const searchRegistrationsQuerySchema = z.object({
  search: z.string().trim().min(1, 'Enter a search term.').max(120),
  camp_id: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid camp id.').optional(),
  ),
});

export const campScopeQuerySchema = z.object({
  camp_id: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid camp id.').optional(),
  ),
});
