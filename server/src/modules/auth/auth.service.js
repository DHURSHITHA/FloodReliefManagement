import { User, hashPassword } from './user.model.js';
import { recordAudit } from '../audit/audit.service.js';

/**
 * Requirements §4: one signup flow for all four roles.
 * Camp officials self-signup into pending_approval because §4 says they are
 * "created by Admin, or self-signup approved by Admin". Everyone else is
 * active at once — §16 requires signup and login with no OTP step.
 */
export async function signup({ name, mobile, email, password, role }, { ip } = {}) {
  const password_hash = await hashPassword(password);
  const status = role === 'camp_official' ? 'pending_approval' : 'active';

  const user = await User.create({ name, mobile, email, password_hash, role, status });

  await recordAudit({
    actor_id: user._id,
    actor_role: role,
    action: 'user.signup',
    module: 'auth',
    record_id: user._id,
    after: { name, role, status },
    ip,
  });

  return { user };
}
