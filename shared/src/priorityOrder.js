/**
 * The order relief is handed out in when a queue forms at the distribution
 * desk: pregnant women first, then senior citizens, then children.
 *
 * This is deliberately separate from `derivePriority`'s tag order, which is a
 * fixed display order for storing tags comparably. This one is a service
 * order, and it answers a different question: who is called next.
 *
 * A person may carry several tags — a pregnant woman with a disability, a
 * child with a disability — so rank is taken from the single most urgent tag
 * they hold, never summed.
 */
export const SERVICE_ORDER = ['pregnant', 'senior_citizen', 'child', 'disability'];

/** Lower is served first. Untagged people rank after everyone tagged. */
export function priorityRank(tags = []) {
  const ranks = tags
    .map((t) => SERVICE_ORDER.indexOf(t))
    .filter((i) => i >= 0);
  return ranks.length ? Math.min(...ranks) : SERVICE_ORDER.length;
}

export const PRIORITY_LABELS = {
  pregnant: 'Pregnant',
  senior_citizen: 'Senior citizen',
  child: 'Child',
  disability: 'Disability',
};

/**
 * Sorts members into the order they should be called. Ties break on age,
 * oldest first within a band, so the queue is stable and explicable rather
 * than arbitrary.
 */
export function byServiceOrder(a, b) {
  const diff = priorityRank(a.priority_tags) - priorityRank(b.priority_tags);
  if (diff !== 0) return diff;
  return (b.age ?? 0) - (a.age ?? 0);
}
