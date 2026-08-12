/** Low-stock threshold check — spec section 6.8's low-stock alerts. */
export function isLowStock({ remaining_qty, reorder_threshold }) {
  return remaining_qty <= reorder_threshold;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** True when expiry_date falls within `withinDays` of `now` (default 7). */
export function isNearExpiry(expiry_date, withinDays = 7, now = new Date()) {
  if (!expiry_date) return false;
  const diff = new Date(expiry_date).getTime() - now.getTime();
  return diff >= 0 && diff <= withinDays * MS_PER_DAY;
}

export function isExpired(expiry_date, now = new Date()) {
  if (!expiry_date) return false;
  return new Date(expiry_date).getTime() < now.getTime();
}
