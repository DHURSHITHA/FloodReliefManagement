import { z } from 'zod';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'];

export const createAreaSchema = z.object({
  name: z.string().trim().min(2, 'Area name is required.').max(160),
  district: z.string().trim().min(1, 'District is required.'),
  state: z.string().trim().min(1, 'State is required.'),
  address: z.string().trim().min(1, 'Address or location description is required.'),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  severity: z.enum(SEVERITIES, { message: 'Select a valid severity.' }),
  estimated_population: z.coerce.number().int().nonnegative().optional(),
  estimated_families: z.coerce.number().int().nonnegative().optional(),
  source: z.string().trim().max(200).optional(),
});

export const createAlertSchema = z.object({
  message: z.string().trim().min(1, 'Alert message is required.').max(500),
  severity: z.enum(SEVERITIES, { message: 'Select a valid severity.' }),
});
