import { Router } from 'express';
import {
  upsertDonorProfileSchema, createDonationSchema, donationDecisionSchema, listDonationsQuerySchema,
} from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  upsertMyDonorProfileHandler, getMyDonorProfileHandler, raiseDonationHandler, decideDonationHandler,
  listMyDonationsHandler, listDonationsHandler,
} from './donations.controller.js';

export const donationsRouter = Router();

// §6.12: donor/NGO self-signup already happens through the common auth
// flow; this is the profile that sits on top of the `donor` account.
donationsRouter.post('/donors/me', authenticate, authorize('donor'), validate(upsertDonorProfileSchema), upsertMyDonorProfileHandler);
donationsRouter.get('/donors/me', authenticate, authorize('donor'), getMyDonorProfileHandler);

// §6.13: a donor records their own; an admin may record one on an existing
// donor's behalf (a cheque phoned in), never a walk-in with no account.
donationsRouter.post('/donations', authenticate, authorize('admin', 'donor'), validate(createDonationSchema), raiseDonationHandler);

// §4.1-4.2: only an admin decides. Material confirmation posts stock inside
// the same transaction as the status change (see decideDonation).
donationsRouter.patch(
  '/donations/:id/confirm',
  authenticate,
  authorize('admin'),
  validate(donationDecisionSchema),
  decideDonationHandler
);

// /mine declared as its own literal segment, the same convention every
// prior "mine" route in this codebase follows.
donationsRouter.get('/donations/mine', authenticate, authorize('donor'), listMyDonationsHandler);
donationsRouter.get(
  '/donations',
  authenticate,
  authorize('admin'),
  validate(listDonationsQuerySchema, 'query'),
  listDonationsHandler
);
