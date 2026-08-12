import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import { User, hashPassword } from '../modules/auth/user.model.js';
import { recordAudit } from '../modules/audit/audit.service.js';
import { logger } from '../core/logger.js';

/**
 * Creates the first admin.
 *
 * Signup alone cannot produce one: admins do not self-approve into existence,
 * and a camp official signup needs an admin to approve it. This breaks that
 * circular dependency. Idempotent — re-running never creates a second admin.
 */
async function seedBootstrapAdmin() {
  const { BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_ADMIN_NAME } = env;

  if (!BOOTSTRAP_ADMIN_EMAIL || !BOOTSTRAP_ADMIN_PASSWORD) {
    logger.warn('BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are not set; skipping admin seed.');
    return;
  }

  const existing = await User.findOne({ role: 'admin' });
  if (existing) {
    logger.info(`An admin already exists (${existing.email ?? existing.mobile}); leaving it untouched.`);
    return;
  }

  const admin = await User.create({
    name: BOOTSTRAP_ADMIN_NAME ?? 'Administrator',
    email: BOOTSTRAP_ADMIN_EMAIL,
    password_hash: await hashPassword(BOOTSTRAP_ADMIN_PASSWORD),
    role: 'admin',
    status: 'active',
  });

  await recordAudit({
    actor_id: admin._id,
    actor_role: 'system',
    action: 'user.bootstrap_admin_created',
    module: 'auth',
    record_id: admin._id,
    after: { email: admin.email, role: 'admin' },
  });

  logger.info(`Bootstrap admin created: ${admin.email}`);
  logger.warn('Change this password immediately after first login.');
}

async function main() {
  await connectDb();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await seedBootstrapAdmin();
  await disconnectDb();
}

main().catch((err) => {
  logger.error({ err }, 'seed failed');
  process.exitCode = 1;
});
