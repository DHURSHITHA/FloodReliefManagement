import { Router } from 'express';
import { createComplaintSchema, updateComplaintSchema, listComplaintsQuerySchema } from '@frp/shared';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  raiseComplaintHandler, listMyComplaintsHandler, listComplaintsHandler, reviewComplaintHandler,
} from './complaints.controller.js';

export const complaintsRouter = Router();

// §6.10: "Any logged-in Affected Person or Camp Official can raise a complaint."
complaintsRouter.post(
  '/complaints',
  authenticate,
  authorize('affected_person', 'camp_official'),
  validate(createComplaintSchema),
  raiseComplaintHandler
);

// /mine before /:id would not clash here, but keep the literal segment first
// for the same reason the intake routes do.
complaintsRouter.get('/complaints/mine', authenticate, listMyComplaintsHandler);

complaintsRouter.get(
  '/complaints',
  authenticate,
  authorize('admin', 'camp_official'),
  validate(listComplaintsQuerySchema, 'query'),
  listComplaintsHandler
);

complaintsRouter.patch(
  '/complaints/:id',
  authenticate,
  authorize('admin', 'camp_official'),
  validate(updateComplaintSchema),
  reviewComplaintHandler
);
