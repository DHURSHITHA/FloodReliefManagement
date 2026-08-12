import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { signupSchema, loginSchema, officialDecisionSchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  signupHandler, loginHandler, refreshHandler, logoutHandler, meHandler,
  pendingOfficialsHandler, officialDecisionHandler,
} from './auth.controller.js';

// Credential endpoints are the ones worth brute-forcing, so they are limited.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 10000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again shortly.', details: [] } },
});

export const authRouter = Router();
authRouter.post('/signup', authLimiter, validate(signupSchema), signupHandler);
authRouter.post('/login', authLimiter, validate(loginSchema), loginHandler);
authRouter.post('/refresh', refreshHandler);
authRouter.post('/logout', logoutHandler);
authRouter.get('/me', authenticate, meHandler);

authRouter.get('/pending-officials', authenticate, authorize('admin'), pendingOfficialsHandler);
authRouter.post(
  '/officials/:id/decision',
  authenticate,
  authorize('admin'),
  validate(officialDecisionSchema),
  officialDecisionHandler
);
