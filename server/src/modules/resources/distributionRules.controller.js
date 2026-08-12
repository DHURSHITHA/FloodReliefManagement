import { DistributionRule } from './distributionRule.model.js';
import { recordAudit } from '../audit/audit.service.js';

export async function createDistributionRuleHandler(req, res) {
  const rule = await DistributionRule.create({ ...req.body, created_by: req.user.id });
  await recordAudit({
    actor_id: req.user.id, actor_role: req.user.role, action: 'distribution_rule.create',
    module: 'resources', record_id: rule._id, after: rule.toSafeJSON(), ip: req.ip,
  });
  res.status(201).json({ rule: rule.toSafeJSON() });
}

export async function listDistributionRulesHandler(req, res) {
  const filter = {};
  if (req.query.item_id) filter.item_id = req.query.item_id;
  const rules = await DistributionRule.find(filter).sort({ createdAt: -1 });
  res.json({ rules: rules.map((r) => r.toSafeJSON()) });
}
