import { Beneficiary } from './beneficiary.model.js';
import { RegistrationMember } from './registrationMember.model.js';
import { CampCheckin } from './campCheckin.model.js';
import { hashAadhaar, encryptAadhaar } from '../../core/crypto.js';
import { nextBeneficiaryCode } from '../../core/idGenerator.js';
import { normalizeAadhaar, maskAadhaar } from '@frp/shared';
import { withTransaction } from '../../core/transaction.js';
import { AppError } from '../../core/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { reserveBeneficiarySlots, reserveVolunteerSlots } from '../camps/camps.service.js';
import { Camp } from '../camps/camp.model.js';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The registration transaction. Order matters: members are inserted (the
 * hard-dedup unique index surfaces conflicts here) BEFORE capacity is
 * reserved, so a duplicate-Aadhaar abort never leaves a false
 * camp:occupancy broadcast behind — reserveBeneficiarySlots only broadcasts
 * on real success.
 */
export async function submitRegistration(input, { actorId, actorRole, ip }) {
  const { camp_id, members } = input;

  return withTransaction(async (session) => {
    const camp = await Camp.findById(camp_id).session(session);
    if (!camp) throw AppError.notFound('No camp with that id.');

    // Soft dedup (spec section 2.2): fuzzy name + mobile/address match
    // against any other ACTIVE registration. Never blocks — only flags.
    const applicant = members[0];
    const fuzzyMatch = await RegistrationMember.exists({
      is_active_registration: true,
      name: new RegExp(`^${escapeRegex(applicant.name.trim())}$`, 'i'),
      $or: [{ mobile: applicant.mobile }, { address: applicant.address }],
    }).session(session);
    const duplicate_warning = Boolean(fuzzyMatch);

    const beneficiary_code = await nextBeneficiaryCode(session);
    const [beneficiary] = await Beneficiary.create(
      [{ beneficiary_code, user_id: actorId, camp_id, duplicate_warning }],
      { session }
    );

    const createdMembers = [];
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const normalized = normalizeAadhaar(m.aadhaar);
      try {
        const [doc] = await RegistrationMember.create(
          [
            {
              beneficiary_id: beneficiary._id,
              is_primary: i === 0,
              relation_to_applicant: i === 0 ? null : m.relation_to_applicant,
              name: m.name, age: m.age, gender: m.gender,
              mobile: i === 0 ? m.mobile : null,
              address: i === 0 ? m.address : null,
              aadhaar_hash: hashAadhaar(normalized),
              aadhaar_enc: encryptAadhaar(normalized),
              aadhaar_last4: normalized.slice(-4),
              is_pregnant: m.is_pregnant, has_disability: m.has_disability,
              wants_to_volunteer: m.wants_to_volunteer,
              is_active_registration: true,
              duplicate_warning,
            },
          ],
          { session }
        );
        createdMembers.push(doc);
      } catch (err) {
        if (err?.code === 11000) {
          throw AppError.conflict(
            'DUPLICATE_AADHAAR',
            `${m.name}, ${maskAadhaar(m.aadhaar)} already has an active registration.`,
            [{ path: `members.${i}.aadhaar`, message: 'This person already has an active registration.' }]
          );
        }
        throw err;
      }
    }

    const updatedCamp = await reserveBeneficiarySlots(camp_id, members.length, session);
    if (!updatedCamp) {
      throw AppError.conflict(
        'CAMP_FULL',
        'This camp does not have enough remaining capacity for your family.',
        [{ path: 'camp_id', message: 'Camp is full. Try the nearest open camp instead.' }]
      );
    }

    const optedIn = createdMembers.filter((m) => m.wants_to_volunteer);
    if (optedIn.length > 0) {
      const granted = await reserveVolunteerSlots(camp_id, optedIn.length, session);
      for (let i = 0; i < optedIn.length; i++) {
        optedIn[i].volunteer_status = i < granted ? 'accepted' : 'not_accepted_slots_full';
        await optedIn[i].save({ session });
      }
    }

    await recordAudit({
      actor_id: actorId, actor_role: actorRole, action: 'registration.create',
      module: 'intake', record_id: beneficiary._id,
      after: { beneficiary_code, camp_id: String(camp_id), member_count: members.length, duplicate_warning },
      ip, session,
    });

    return { beneficiary, members: createdMembers };
  });
}

export async function getMyRegistration(userId) {
  const beneficiary = await Beneficiary.findOne({ user_id: userId }).sort({ createdAt: -1 });
  if (!beneficiary) return null;
  const members = await RegistrationMember.find({ beneficiary_id: beneficiary._id });
  return { beneficiary, members };
}

export async function getRegistrationByCode(code, { actorRole, actorCampId }) {
  const beneficiary = await Beneficiary.findOne({ beneficiary_code: code.toUpperCase() });
  if (!beneficiary) throw AppError.notFound('No registration with that code.');
  if (actorRole === 'camp_official' && String(beneficiary.camp_id) !== String(actorCampId)) {
    throw AppError.forbidden('You may only view registrations at your assigned camp.');
  }
  const members = await RegistrationMember.find({ beneficiary_id: beneficiary._id });
  return { beneficiary, members };
}

export async function searchRegistrations({ search, actorRole, actorCampId }) {
  const campFilter = actorRole === 'camp_official' ? { camp_id: actorCampId } : {};

  const byCode = await Beneficiary.findOne({ beneficiary_code: search.toUpperCase(), ...campFilter });
  if (byCode) {
    const members = await RegistrationMember.find({ beneficiary_id: byCode._id });
    return [{ beneficiary: byCode.toSafeJSON(), members: members.map((m) => m.toSafeJSON()) }];
  }

  const primaryMatches = await RegistrationMember.find({
    is_primary: true,
    $or: [{ name: new RegExp(escapeRegex(search), 'i') }, { mobile: search }],
  }).limit(20);

  const beneficiaryIds = primaryMatches.map((m) => m.beneficiary_id);
  const beneficiaries = await Beneficiary.find({ _id: { $in: beneficiaryIds }, ...campFilter });

  const results = [];
  for (const b of beneficiaries) {
    const members = await RegistrationMember.find({ beneficiary_id: b._id });
    results.push({ beneficiary: b.toSafeJSON(), members: members.map((m) => m.toSafeJSON()) });
  }
  return results;
}

/**
 * Not wrapped in a transaction: no capacity counter or financial invariant
 * is at stake here, only a status flag and an append-only log, so the
 * added overhead isn't justified — a deliberate simplification.
 */
export async function checkInMember(beneficiaryId, memberId, { actorId, actorRole, actorCampId, ip }) {
  const beneficiary = await Beneficiary.findById(beneficiaryId);
  if (!beneficiary) throw AppError.notFound('No registration with that id.');
  if (actorRole === 'camp_official' && String(beneficiary.camp_id) !== String(actorCampId)) {
    throw AppError.forbidden('You may only check in members at your assigned camp.');
  }

  const member = await RegistrationMember.findOne({ _id: memberId, beneficiary_id: beneficiaryId });
  if (!member) throw AppError.notFound('No member with that id on this registration.');
  if (member.checkin_status === 'checked_in') {
    throw AppError.conflict('ALREADY_CHECKED_IN', 'This member is already checked in.');
  }

  member.checkin_status = 'checked_in';
  member.checked_in_at = new Date();
  await member.save();

  await CampCheckin.create({
    beneficiary_id: beneficiary._id, member_id: member._id, camp_id: beneficiary.camp_id, verified_by: actorId,
  });

  const allMembers = await RegistrationMember.find({ beneficiary_id: beneficiary._id });
  const checkedInCount = allMembers.filter((m) => m.checkin_status === 'checked_in').length;
  beneficiary.status = checkedInCount === allMembers.length ? 'active' : 'partially_checked_in';
  await beneficiary.save();

  await recordAudit({
    actor_id: actorId, actor_role: actorRole, action: 'member.checkin',
    module: 'intake', record_id: member._id,
    after: { beneficiary_code: beneficiary.beneficiary_code, member_name: member.name }, ip,
  });

  return { member, beneficiary };
}
