import { z } from 'zod';

export const ROLES = ['admin', 'camp_official', 'affected_person', 'donor'];

// Indian mobile: optional +91 or 0 prefix, then 10 digits starting 6-9.
const mobile = z
  .string()
  .trim()
  .regex(/^(?:\+91|0)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number.')
  .transform((v) => v.replace(/^(?:\+91|0)/, ''));

export const signupSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required.').max(120),
    mobile: mobile.optional(),
    email: z.string().trim().toLowerCase().email('Enter a valid email address.').optional(),
    // Length beats character-class rules: a long passphrase is stronger than
    // "Pa$$w0rd" and far likelier to be remembered by a camp official at 3am.
    password: z.string().min(12, 'Use at least 12 characters.').max(200),
    role: z.enum(ROLES, { message: 'Select a valid role.' }),
  })
  .refine((d) => Boolean(d.mobile || d.email), {
    message: 'Provide a mobile or an email address.',
    path: ['mobile'],
  });

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your mobile number or email.'),
  password: z.string().min(1, 'Enter your password.'),
});
