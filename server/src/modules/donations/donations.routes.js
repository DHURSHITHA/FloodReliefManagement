import { Router } from 'express';
import { upsertDonorProfileSchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { upsertMyDonorProfileHandler, getMyDonorProfileHandler } from './donations.controller.js';

export const donationsRouter = Router();

// §6.12: donor/NGO self-signup already happens through the common auth
// flow; this is the profile that sits on top of the `donor` account.
donationsRouter.post('/donors/me', authenticate, authorize('donor'), validate(upsertDonorProfileSchema), upsertMyDonorProfileHandler);
donationsRouter.get('/donors/me', authenticate, authorize('donor'), getMyDonorProfileHandler);
