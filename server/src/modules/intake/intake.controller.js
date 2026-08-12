import * as intakeService from './intake.service.js';
import { withIdempotency } from '../../core/idempotency.js';

export async function createRegistrationHandler(req, res) {
  const idKey = req.headers['idempotency-key'];
  const responseBody = await withIdempotency(idKey, async () => {
    const result = await intakeService.submitRegistration(req.body, {
      actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
    });
    return {
      beneficiary: result.beneficiary.toSafeJSON(),
      members: result.members.map((m) => m.toSafeJSON()),
    };
  });
  res.status(201).json(responseBody);
}

export async function getMyRegistrationHandler(req, res) {
  const registration = await intakeService.getMyRegistration(req.user.id);
  if (!registration) return res.json({ registration: null });
  res.json({
    registration: {
      beneficiary: registration.beneficiary.toSafeJSON(),
      members: registration.members.map((m) => m.toSafeJSON()),
    },
  });
}

export async function getRegistrationByCodeHandler(req, res) {
  const registration = await intakeService.getRegistrationByCode(req.params.code, {
    actorRole: req.user.role, actorCampIds: req.user.camp_ids,
  });
  res.json({
    registration: {
      beneficiary: registration.beneficiary.toSafeJSON(),
      members: registration.members.map((m) => m.toSafeJSON()),
    },
  });
}

export async function searchRegistrationsHandler(req, res) {
  const results = await intakeService.searchRegistrations({
    search: req.validatedQuery.search,
    actorRole: req.user.role,
    actorCampIds: req.user.camp_ids,
    selectedCampId: req.validatedQuery.camp_id,
  });
  res.json({ registrations: results });
}

export async function checkInMemberHandler(req, res) {
  const { member } = await intakeService.checkInMember(req.params.beneficiaryId, req.params.memberId, {
    actorId: req.user.id, actorRole: req.user.role, actorCampIds: req.user.camp_ids, ip: req.ip,
  });
  res.json({ member: member.toSafeJSON() });
}

export async function assignVolunteerDutyHandler(req, res) {
  const member = await intakeService.assignVolunteerDuty(req.params.memberId, req.body, {
    actorId: req.user.id, actorRole: req.user.role, actorCampIds: req.user.camp_ids, ip: req.ip,
  });
  res.json({ member: member.toSafeJSON() });
}

export async function completeVolunteerDutyHandler(req, res) {
  const member = await intakeService.completeVolunteerDuty(req.params.memberId, req.body, {
    actorId: req.user.id, actorRole: req.user.role, actorCampIds: req.user.camp_ids, ip: req.ip,
  });
  res.json({ member: member.toSafeJSON() });
}

export async function listActiveVolunteersHandler(req, res) {
  const volunteers = await intakeService.listActiveVolunteers({
    actorRole: req.user.role,
    actorCampIds: req.user.camp_ids,
    selectedCampId: req.validatedQuery?.camp_id,
  });
  res.json({ volunteers });
}
