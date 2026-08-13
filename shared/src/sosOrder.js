import { CLOSED_SOS_STATUSES, SOS_URGENCY } from './schemas/sos.schema.js';

/**
 * Urgency ordering for the Emergency dashboard, per requirements §6.11:
 * "Display SOS immediately on the Admin dashboard, flagged by urgency."
 *
 * Deliberately separate from complaint priority or registration priority —
 * an SOS at "medium" urgency is not on the same scale as a complaint at
 * "normal" priority and must never be compared against one.
 */
export function urgencyRank(urgency) {
  const rank = SOS_URGENCY.indexOf(urgency);
  return rank >= 0 ? rank : SOS_URGENCY.length;
}

/** Still-open work before closed work; most urgent first within each; newest first after that. */
export function bySosPriority(a, b) {
  const openA = CLOSED_SOS_STATUSES.includes(a.status) ? 1 : 0;
  const openB = CLOSED_SOS_STATUSES.includes(b.status) ? 1 : 0;
  if (openA !== openB) return openA - openB;

  const diff = urgencyRank(a.urgency) - urgencyRank(b.urgency);
  if (diff !== 0) return diff;

  return new Date(b.createdAt) - new Date(a.createdAt);
}
