// Occupancy percentage at which a camp is shown as nearing capacity, ahead
// of the point it can no longer accept anyone. A judgment call, not a spec
// requirement — change this constant if the real deployment needs another
// threshold.
const NEARLY_FULL_THRESHOLD = 0.85;

/**
 * Status is computed from occupancy, per requirements §18 ("every dashboard
 * figure computed, not manually entered") — except the two lifecycle states
 * only Admin can set. An override, once in force, always wins: a camp an
 * admin has temporarily closed does not reopen itself just because a bed
 * frees up.
 */
export function deriveCampStatus({ beneficiaries_accepted, beneficiary_capacity, admin_override = null }) {
  if (admin_override === 'temporarily_closed' || admin_override === 'closed') return admin_override;

  if (beneficiary_capacity <= 0) return 'full';
  const occupancy = beneficiaries_accepted / beneficiary_capacity;
  if (occupancy >= 1) return 'full';
  if (occupancy >= NEARLY_FULL_THRESHOLD) return 'nearly_full';
  return 'open';
}
