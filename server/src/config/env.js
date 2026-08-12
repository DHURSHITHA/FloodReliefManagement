import { z } from 'zod';

const hex64 = z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (32 bytes)');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_ACCESS_SECRET: hex64,
  JWT_REFRESH_SECRET: hex64,
  AADHAAR_HMAC_PEPPER: hex64,
  AADHAAR_ENC_KEY: hex64,
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  BOOTSTRAP_ADMIN_NAME: z.string().optional(),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
});

// Tests run without a .env file; supply throwaway values so importing this
// module never explodes under vitest.
const testDefaults =
  process.env.NODE_ENV === 'test'
    ? {
        MONGODB_URI: 'mongodb://127.0.0.1:27017/test',
        JWT_ACCESS_SECRET: 'a'.repeat(64),
        JWT_REFRESH_SECRET: 'b'.repeat(64),
        AADHAAR_HMAC_PEPPER: 'c'.repeat(64),
        AADHAAR_ENC_KEY: 'd'.repeat(64),
      }
    : {};

const parsed = schema.safeParse({ ...testDefaults, ...process.env });

if (!parsed.success) {
  // Print WHICH variable is wrong, never its value.
  const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  console.error(`Invalid environment configuration:\n${problems.join('\n')}`);
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
