import { Router } from 'express';
import { createSosSchema, updateSosSchema, listSosQuerySchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  raiseSosHandler, listMySosHandler, listSosHandler, transitionSosHandler,
} from './sos.controller.js';

export const sosRouter = Router();

// §6.11: raised by an affected person about their own emergency, or by a
// camp official on someone's behalf. Admins work through the dashboard, not
// by filing their own — the same boundary complaints already draws.
sosRouter.post(
  '/sos',
  authenticate,
  authorize('affected_person', 'camp_official'),
  validate(createSosSchema),
  raiseSosHandler
);

// /mine before /:id — Express matches in declaration order and :id would
// otherwise swallow the literal "mine" segment, as with /complaints/mine.
sosRouter.get('/sos/mine', authenticate, listMySosHandler);

sosRouter.get(
  '/sos',
  authenticate,
  authorize('admin', 'camp_official'),
  validate(listSosQuerySchema, 'query'),
  listSosHandler
);

sosRouter.patch(
  '/sos/:id',
  authenticate,
  authorize('admin', 'camp_official'),
  validate(updateSosSchema),
  transitionSosHandler
);
