import { AuditLog } from './audit.model.js';

// An audit trail must never become a second copy of the secrets it describes.
const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'refresh_token',
  'token',
  'aadhaar',
  'aadhaar_enc',
  'aadhaar_hash',
]);

function scrub(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(scrub);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(k)) continue;
    out[k] = scrub(v);
  }
  return out;
}

/**
 * Write one audit record.
 * Pass `session` when the audited action is itself transactional, so the audit
 * entry commits or rolls back together with the change it describes.
 */
export async function recordAudit({
  actor_id,
  actor_role,
  action,
  module,
  record_id,
  before = null,
  after = null,
  ip = null,
  session,
}) {
  const [doc] = await AuditLog.create(
    [
      {
        actor_id,
        actor_role,
        action,
        module,
        record_id,
        before: scrub(before),
        after: scrub(after),
        ip,
      },
    ],
    session ? { session } : {}
  );
  return doc;
}
