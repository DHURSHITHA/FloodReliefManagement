import * as distributionRulesService from './distributionRules.service.js';

export async function createDistributionRuleHandler(req, res) {
  const rule = await distributionRulesService.createDistributionRule(req.body, {
    actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
  });
  res.status(201).json({ rule: rule.toSafeJSON() });
}

export async function listDistributionRulesHandler(req, res) {
  const rules = await distributionRulesService.listDistributionRules({ item_id: req.query.item_id });
  res.json({ rules: rules.map((r) => r.toSafeJSON()) });
}

export async function updateDistributionRuleHandler(req, res) {
  const rule = await distributionRulesService.updateDistributionRule(req.params.id, req.body, {
    actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
  });
  res.json({ rule: rule.toSafeJSON() });
}
