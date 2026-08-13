import { Router } from 'express';
import { upsertDonorProfileSchema, createDonationSchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  upsertMyDonorProfileHandler, getMyDonorProfileHandler, raiseDonationHandler,
} from './donations.controller.js';

export const donationsRouter = Router();

// §6.12: donor/NGO self-signup already happens through the common auth
// flow; this is the profile that sits on top of the `donor` account.
donationsRouter.post('/donors/me', authenticate, authorize('donor'), validate(upsertDonorProfileSchema), upsertMyDonorProfileHandler);
donationsRouter.get('/donors/me', authenticate, authorize('donor'), getMyDonorProfileHandler);

// §6.13: a donor records their own; an admin may record one on an existing
// donor's behalf (a cheque phoned in), never a walk-in with no account.
donationsRouter.post('/donations', authenticate, authorize('admin', 'donor'), validate(createDonationSchema), raiseDonationHandler);
