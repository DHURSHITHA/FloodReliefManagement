import { DistributionRule } from './distributionRule.model.js';
import { AppError } from '../../core/errors.js';
import { recordAudit } from '../audit/audit.service.js';

/**
 * A friendlier message than the generic 409 the model's partial unique
 * index (camp_id + item_id + active) falls back to on a raw duplicate-key
 * error. The index is still the actual race-safety guarantee under
 * concurrent creation — this pre-check only improves the common,
 * non-racing case's error message.
 */
async function assertNoConflict(campId, itemId, active, excludeId) {
  if (!active) return;
  const filter = { camp_id: campId ?? null, item_id: itemId, active: true };
  if (excludeId) filter._id = { $ne: excludeId };
  const clash = await DistributionRule.findOne(filter);
  if (clash) {
    throw AppError.conflict(
      'RULE_ALREADY_ACTIVE',
      campId
        ? 'This camp already has an active rule for this item. Edit that rule instead, or deactivate it first.'
        : 'A global active rule for this item already exists. Edit that rule instead, or deactivate it first.',
      [{ path: 'camp_id', message: 'Choose a different camp, or edit the existing rule.' }]
    );
  }
}

/** A distribution rule scoped to one item, and optionally to one camp — see distributionRule.model.js. */
export async function createDistributionRule(input, { actorId, actorRole, ip }) {
  await assertNoConflict(input.camp_id, input.item_id, input.active ?? true);

  let rule;
  try {
    rule = await DistributionRule.create({ ...input, created_by: actorId });
  } catch (err) {
    // Lost a race against another create for the same camp+item — the
    // index caught what the pre-check above could not.
    if (err?.code === 11000) {
      throw AppError.conflict(
        'RULE_ALREADY_ACTIVE',
        'Another active rule for this camp and item was just created. Refresh and edit it instead.'
      );
    }
    throw err;
  }

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'distribution_rule.create',
    module: 'resources', record_id: rule._id, after: rule.toSafeJSON(), ip,
  });
  return rule;
}

export async function listDistributionRules({ item_id } = {}) {
  const filter = {};
  if (item_id) filter.item_id = item_id;
  return DistributionRule.find(filter).sort({ createdAt: -1 });
}

export async function getDistributionRuleById(id) {
  const rule = await DistributionRule.findById(id);
  if (!rule) throw AppError.notFound('No distribution rule with that id.');
  return rule;
}

/**
 * Editing a rule already in place — the terms (quantity, bands, period,
 * eligibility...) most commonly, but also its camp/item targeting and its
 * active flag, since deactivating is how one rule is freed for a
 * replacement to take over the same camp+item slot.
 */
export async function updateDistributionRule(id, input, { actorId, actorRole, ip }) {
  const rule = await getDistributionRuleById(id);
  const before = rule.toSafeJSON();

  const nextCampId = 'camp_id' in input ? input.camp_id : rule.camp_id;
  const nextItemId = input.item_id ?? rule.item_id;
  const nextActive = input.active ?? rule.active;
  await assertNoConflict(nextCampId, nextItemId, nextActive, rule._id);

  Object.assign(rule, input);
  try {
    await rule.save();
  } catch (err) {
    if (err?.code === 11000) {
      throw AppError.conflict(
        'RULE_ALREADY_ACTIVE',
        'Another active rule for this camp and item was just created. Refresh and try again.'
      );
    }
    throw err;
  }

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'distribution_rule.update',
    module: 'resources', record_id: rule._id, before, after: rule.toSafeJSON(), ip,
  });
  return rule;
}
