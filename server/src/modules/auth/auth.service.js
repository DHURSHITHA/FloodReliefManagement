import mongoose from 'mongoose';
import { User, hashPassword } from './user.model.js';
import { recordAudit } from '../audit/audit.service.js';
import { AppError, ERROR_CODES } from '../../core/errors.js';
import { RefreshToken } from './refreshToken.model.js';
import {
  signAccessToken, generateRefreshToken, hashRefreshToken, REFRESH_TOKEN_TTL_MS,
} from '../../core/tokens.js';

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

export async function issueRefreshToken(userId, familyId = new mongoose.Types.ObjectId()) {
  const raw = generateRefreshToken();
  await RefreshToken.create({
    user_id: userId,
    token_hash: hashRefreshToken(raw),
    family_id: familyId,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  return raw;
}

export async function login({ identifier, password }, { ip } = {}) {
  const query = identifier.includes('@')
    ? { email: identifier.toLowerCase() }
    : { mobile: identifier.replace(/^(?:\+91|0)/, '') };

  const user = await User.findOne(query).select('+password_hash');

  // Identical response whether the account is missing or the password is wrong,
  // so this endpoint cannot be used to enumerate who is registered.
  const invalid = new AppError(401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid credentials.');
  if (!user) {
    // Spend comparable time so timing does not leak account existence either.
    await new Promise((r) => setTimeout(r, 120));
    throw invalid;
  }
  if (!(await user.comparePassword(password))) throw invalid;

  if (user.status === 'pending_approval') {
    throw new AppError(403, ERROR_CODES.ACCOUNT_PENDING_APPROVAL,
      'Your camp official account is awaiting administrator approval.');
  }
  if (user.status === 'disabled' || user.status === 'rejected') {
    throw new AppError(403, ERROR_CODES.ACCOUNT_DISABLED, 'This account is not active.');
  }

  user.last_login_at = new Date();
  await user.save();

  const access_token = signAccessToken(user);
  const refresh_token = await issueRefreshToken(user._id);

  await recordAudit({
    actor_id: user._id, actor_role: user.role, action: 'user.login',
    module: 'auth', record_id: user._id, ip,
  });

  return { user, access_token, refresh_token };
}

export async function rotateRefreshToken(raw) {
  const unauthorized = new AppError(401, ERROR_CODES.TOKEN_INVALID, 'Your session has expired. Please sign in again.');
  if (!raw) throw unauthorized;

  const existing = await RefreshToken.findOne({ token_hash: hashRefreshToken(raw) });
  if (!existing) throw unauthorized;

  // A token that was already rotated is being replayed. Either it was stolen
  // or it leaked; we cannot tell which, so we end every session in the family.
  if (existing.revoked_at) {
    await RefreshToken.updateMany(
      { family_id: existing.family_id, revoked_at: null },
      { revoked_at: new Date() }
    );
    throw unauthorized;
  }

  if (existing.expires_at.getTime() < Date.now()) throw unauthorized;

  const user = await User.findById(existing.user_id);
  if (!user || user.status !== 'active') throw unauthorized;

  const next = await issueRefreshToken(user._id, existing.family_id);
  existing.revoked_at = new Date();
  existing.replaced_by = hashRefreshToken(next);
  await existing.save();

  return { user, access_token: signAccessToken(user), refresh_token: next };
}

export async function revokeRefreshToken(raw) {
  if (!raw) return;
  await RefreshToken.updateOne(
    { token_hash: hashRefreshToken(raw), revoked_at: null },
    { revoked_at: new Date() }
  );
}

export async function listPendingOfficials() {
  return User.find({ role: 'camp_official', status: 'pending_approval' }).sort({ createdAt: 1 });
}

export async function decideOfficial({ userId, decision, assigned_camp_id, adminId, adminRole, ip }) {
  const user = await User.findOne({ _id: userId, role: 'camp_official', status: 'pending_approval' });
  if (!user) throw AppError.notFound('No camp official is awaiting approval with that id.');

  const before = { status: user.status };
  user.status = decision === 'approve' ? 'active' : 'rejected';
  user.approved_by = adminId;
  user.approved_at = new Date();
  if (decision === 'approve' && assigned_camp_id) user.assigned_camp_id = assigned_camp_id;
  await user.save();

  await recordAudit({
    actor_id: adminId,
    actor_role: adminRole,
    action: decision === 'approve' ? 'user.official_approved' : 'user.official_rejected',
    module: 'auth',
    record_id: user._id,
    before,
    after: { status: user.status, assigned_camp_id: user.assigned_camp_id ?? null },
    ip,
  });

  return user;
}
