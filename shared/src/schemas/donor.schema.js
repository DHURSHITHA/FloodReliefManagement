import { z } from 'zod';

/**
 * Requirements §6.12 Donor / NGO Management. Both donor types share one
 * profile shape rather than two schemas, because most fields (mobile,
 * email, address) are common and an individual/NGO toggle is simpler for a
 * form to drive than two entirely separate submission paths.
 */
export const DONOR_TYPES = ['individual', 'ngo'];

// Same Indian-mobile convention as registration.schema.js and auth.schema.js:
// optional +91/0 prefix, then 10 digits starting 6-9.
const mobileRegex = /^(?:\+91|0)?[6-9]\d{9}$/;

export const upsertDonorProfileSchema = z.object({
  donor_type: z.enum(DONOR_TYPES, { message: 'Choose individual or NGO.' }),
  name: z.string().trim().min(1, 'Name is required.').max(150),
  contact_person: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(150).optional(),
  ),
  mobile: z.string().trim().regex(mobileRegex, 'Enter a valid 10-digit mobile number.'),
  email: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().email('Enter a valid email address.').optional(),
  ),
  address: z.string().trim().min(1, 'Address is required.').max(300),
  registration_details: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(300).optional(),
  ),
}).superRefine((val, ctx) => {
  if (val.donor_type === 'ngo') {
    if (!val.contact_person) {
      ctx.addIssue({ code: 'custom', path: ['contact_person'], message: 'Contact person is required for an NGO.' });
    }
    if (!val.registration_details) {
      ctx.addIssue({ code: 'custom', path: ['registration_details'], message: 'Registration details are required for an NGO.' });
    }
  }
});
