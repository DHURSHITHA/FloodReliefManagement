function memberHasTag(member, tag) {
  if (tag === 'has_pregnant') return member.is_pregnant === true;
  if (tag === 'has_disability') return member.has_disability === true;
  if (tag === 'has_child') return (member.priority_tags || []).includes('child');
  if (tag === 'has_senior_citizen') return (member.priority_tags || []).includes('senior_citizen');
  return false;
}

/**
 * Ration quantity from a distribution rule (spec section 3.1). Pure and
 * unit-tested — the hybrid engine's whole point is that this logic lives
 * in exactly one place rather than scattered across the service.
 */
export function calcRation(rule, members) {
  if (!rule || !rule.active) return 0;

  if (rule.eligibility && rule.eligibility.length > 0) {
    const eligible = members.some((m) => rule.eligibility.some((tag) => memberHasTag(m, tag)));
    if (!eligible) return 0;
  }

  let qty;
  if (rule.mode === 'fixed') {
    qty = rule.fixed_qty ?? 0;
  } else if (rule.mode === 'per_head') {
    qty = (rule.per_head_qty ?? 0) * members.length;
  } else if (rule.mode === 'family_band') {
    const band = (rule.bands || []).find((b) => members.length >= b.min && members.length <= b.max);
    qty = band ? band.qty : 0;
  } else {
    qty = 0;
  }

  for (const addon of rule.priority_addons || []) {
    if (members.some((m) => memberHasTag(m, addon.when))) qty += addon.extra_qty;
  }

  if (rule.min_qty != null) qty = Math.max(qty, rule.min_qty);
  if (rule.max_qty != null) qty = Math.min(qty, rule.max_qty);

  return qty;
}

/**
 * period_key for distribution_records' uniqueness (spec section 5.4):
 * '2026-08-12' for daily, '2026-W33' (ISO week) for weekly, 'once' once.
 */
export function computePeriodKey(period, date = new Date()) {
  if (period === 'once') return 'once';
  if (period === 'daily') return date.toISOString().slice(0, 10);
  if (period === 'weekly') {
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNr = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  throw new Error(`Unknown period: ${period}`);
}
