import { z } from 'zod';
import { SEVERITIES } from './area.schema.js';

export const CAMP_TYPES = ['school', 'auditorium', 'community_hall', 'other'];
export const CAMP_STATUSES = ['open', 'nearly_full', 'full', 'temporarily_closed', 'closed'];

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id.');

const facilitiesSchema = z
  .object({
    food: z.boolean().default(false),
    drinking_water: z.boolean().default(false),
    medical_support: z.boolean().default(false),
    toilets_count: z.coerce.number().int().nonnegative().default(0),
    electricity: z.boolean().default(false),
    accommodation: z.boolean().default(false),
    charging_points: z.boolean().default(false),
    internet: z.boolean().default(false),
    child_care: z.boolean().default(false),
    womens_facilities: z.boolean().default(false),
    disability_friendly: z.boolean().default(false),
  })
  .default({});

export const createCampSchema = z.object({
  // Identity
  name: z.string().trim().min(2, 'Camp name is required.').max(160),
  camp_type: z.enum(CAMP_TYPES, { message: 'Select a valid camp type.' }),
  description: z.string().trim().max(1000).optional(),

  // Location
  address: z.string().trim().min(1, 'Address is required.'),
  area: z.string().trim().min(1, 'Area is required.'),
  district: z.string().trim().min(1, 'District is required.'),
  state: z.string().trim().min(1, 'State is required.'),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a valid 6-digit pincode.'),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),

  // Flood context
  linked_area_id: objectId.optional(),
  flood_severity: z.enum(SEVERITIES, { message: 'Select a valid severity.' }),
  date_affected: z.coerce.date().optional(),
  estimated_affected_population: z.coerce.number().int().nonnegative().optional(),
  reason_for_camp: z.string().trim().max(500).optional(),

  // Capacity & duration — mandatory per requirements section 6.3's own intro sentence
  beneficiary_capacity: z.coerce.number().int().positive('Beneficiary capacity must be at least 1.'),
  volunteer_capacity: z.coerce.number().int().positive('Volunteer capacity must be at least 1.'),
  duration_days: z.coerce.number().int().positive('Duration must be at least 1 day.'),
  opening_date: z.coerce.date().optional(),
  expected_closing_date: z.coerce.date().optional(),

  // Facilities
  facilities: facilitiesSchema,

  // Management
  assigned_official_id: objectId.optional(),
  official_contact_number: z.string().trim().optional(),

  // Emergency — both mandatory: requirements section 6.3 ties medical/security SOS
  // routing directly to these two contacts, so a camp without them cannot safely open.
  nearest_hospital_name: z.string().trim().min(1, 'Nearest hospital name is required.'),
  nearest_hospital_contact: z.string().trim().min(1, 'Nearest hospital contact is required.'),
  nearest_police_name: z.string().trim().min(1, 'Nearest police station name is required.'),
  nearest_police_contact: z.string().trim().min(1, 'Nearest police contact is required.'),
});

export const updateCampSchema = createCampSchema.partial().extend({
  admin_override: z.enum(['temporarily_closed', 'closed']).nullable().optional(),
});

export const nearestCampQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  excludeCampId: objectId.optional(),
});
