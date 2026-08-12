import * as distributionService from './distribution.service.js';

export async function createDistributionHandler(req, res) {
  const record = await distributionService.distributeItem(req.body, {
    actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
  });
  res.status(201).json({ distribution: record.toSafeJSON() });
}

export async function listDistributionsHandler(req, res) {
  const records = await distributionService.listDistributions({
    beneficiary: req.query.beneficiary, camp: req.query.camp, date: req.query.date,
  });
  res.json({ distributions: records.map((r) => r.toSafeJSON()) });
}
