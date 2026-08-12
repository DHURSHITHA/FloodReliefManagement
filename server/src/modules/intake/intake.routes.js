import { Router } from 'express';
import { createRegistrationSchema, searchRegistrationsQuerySchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  createRegistrationHandler, getMyRegistrationHandler, getRegistrationByCodeHandler,
  searchRegistrationsHandler, checkInMemberHandler,
  assignVolunteerDutyHandler, completeVolunteerDutyHandler, listActiveVolunteersHandler,
} from './intake.controller.js';

export const intakeRouter = Router();

intakeRouter.post('/registrations', authenticate, authorize('affected_person'), validate(createRegistrationSchema), createRegistrationHandler);
// /me before /:code — Express matches in declaration order and :code would
// otherwise swallow the literal "me" segment.
intakeRouter.get('/registrations/me', authenticate, authorize('affected_person'), getMyRegistrationHandler);
intakeRouter.get('/registrations', authenticate, authorize('admin', 'camp_official'), validate(searchRegistrationsQuerySchema, 'query'), searchRegistrationsHandler);
intakeRouter.get('/registrations/:code', authenticate, authorize('admin', 'camp_official'), getRegistrationByCodeHandler);
intakeRouter.post('/registrations/:beneficiaryId/members/:memberId/checkin', authenticate, authorize('admin', 'camp_official'), checkInMemberHandler);

intakeRouter.get('/volunteers', authenticate, authorize('admin', 'camp_official'), listActiveVolunteersHandler);
intakeRouter.post('/volunteers/:memberId/assign', authenticate, authorize('admin', 'camp_official'), assignVolunteerDutyHandler);
intakeRouter.post('/volunteers/:memberId/complete', authenticate, authorize('admin', 'camp_official'), completeVolunteerDutyHandler);
