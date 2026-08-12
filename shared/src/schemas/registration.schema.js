import { z } from 'zod';
import { objectId } from './camp.schema.js';
import { isValidAadhaar } from '../aadhaar.js';

const mobileRegex = /^(?:\+91|0)?[6-9]\d{9}$/;

export const registrationMemberInputSchema = z.object({
  name: z.string().trim().min(2, 'Name is required.').max(120),
  age: z.coerce.number().int().min(0, 'Age must be zero or more.').max(120),
  gender: z.enum(['male', 'female', 'other'], { message: 'Select a valid gender.' }),
  aadhaar: z.string().trim().refine(isValidAadhaar, 'Enter a valid Aadhaar number.'),
  is_pregnant: z.boolean().default(false),
  has_disability: z.boolean().default(false),
  wants_to_volunteer: z.boolean().default(false),
  relation_to_applicant: z.string().trim().min(1).max(60).optional(),
  mobile: z.string().trim().regex(mobileRegex, 'Enter a valid 10-digit mobile number.').optional(),
  address: z.string().trim().min(1).max(300).optional(),
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
    });
  });

export const searchRegistrationsQuerySchema = z.object({
  search: z.string().trim().min(1, 'Enter a search term.').max(120),
});
