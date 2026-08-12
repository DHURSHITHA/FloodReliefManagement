/**
 * Vulnerability classification, per requirements §6.5.
 * Tags are an array, not a single enum, because §6.16 requires children,
 * senior citizens, pregnant women and persons with disability to be counted
 * separately on the dashboard — one person can be several of those at once.
 * Tag order is fixed so stored values are comparable across records.
 */
export function derivePriority({ age, is_pregnant = false, has_disability = false } = {}) {
  const priority_tags = [];
  const numericAge = Number(age);
  const hasAge = Number.isFinite(numericAge);

  if (hasAge && numericAge <= 12) priority_tags.push('child');
  if (hasAge && numericAge >= 60) priority_tags.push('senior_citizen');
  if (is_pregnant === true) priority_tags.push('pregnant');
  if (has_disability === true) priority_tags.push('disability');

  // Fixed display order, independent of the order checks ran in.
  const ORDER = ['senior_citizen', 'child', 'pregnant', 'disability'];
  priority_tags.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

  return { priority_tags, priority_level: priority_tags.length > 0 ? 'high' : 'normal' };
}
