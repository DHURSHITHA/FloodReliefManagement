import mongoose from 'mongoose';
import { SEVERITIES } from '@frp/shared';
import { CAMP_TYPES, CAMP_STATUSES } from '@frp/shared';

const facilitiesSchema = new mongoose.Schema(
  {
    food: { type: Boolean, default: false },
    drinking_water: { type: Boolean, default: false },
    medical_support: { type: Boolean, default: false },
    toilets_count: { type: Number, default: 0 },
    electricity: { type: Boolean, default: false },
    accommodation: { type: Boolean, default: false },
    charging_points: { type: Boolean, default: false },
    internet: { type: Boolean, default: false },
    child_care: { type: Boolean, default: false },
    womens_facilities: { type: Boolean, default: false },
    disability_friendly: { type: Boolean, default: false },
  },
  { _id: false }
);

const campSchema = new mongoose.Schema(
  {
    // Identity
    name: { type: String, required: true, trim: true, maxlength: 160 },
    camp_type: { type: String, required: true, enum: CAMP_TYPES },
    description: { type: String, default: '' },
    status: { type: String, required: true, enum: CAMP_STATUSES, default: 'open', index: true },
    admin_override: { type: String, enum: ['temporarily_closed', 'closed', null], default: null },

    // Location
    address: { type: String, required: true, trim: true },
    area: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true, index: true },
    state: { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [longitude, latitude]
    },

    // Flood context
    linked_area_id: { type: mongoose.Schema.Types.ObjectId, ref: 'AffectedArea', default: null },
    flood_severity: { type: String, required: true, enum: SEVERITIES },
    date_affected: { type: Date, default: null },
    estimated_affected_population: { type: Number, default: null },
    reason_for_camp: { type: String, default: '' },

    // Capacity & duration
    beneficiary_capacity: { type: Number, required: true, min: 1 },
    volunteer_capacity: { type: Number, required: true, min: 1 },
    duration_days: { type: Number, required: true, min: 1 },
    opening_date: { type: Date, default: null },
    expected_closing_date: { type: Date, default: null },
    actual_closing_date: { type: Date, default: null },

    // Live counters — written ONLY by camps.service.js's guarded atomic update.
    beneficiaries_accepted: { type: Number, default: 0, min: 0 },
    volunteers_accepted: { type: Number, default: 0, min: 0 },

    // Facilities
    facilities: { type: facilitiesSchema, default: () => ({}) },

    // Management
    assigned_official_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    official_contact_number: { type: String, default: '' },
    assignment_date: { type: Date, default: null },

    // Emergency
    nearest_hospital_name: { type: String, required: true, trim: true },
    nearest_hospital_contact: { type: String, required: true, trim: true },
    nearest_police_name: { type: String, required: true, trim: true },
    nearest_police_contact: { type: String, required: true, trim: true },

    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'camps' }
);

campSchema.index({ location: '2dsphere' });

campSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    camp_type: this.camp_type,
    description: this.description,
    status: this.status,
    address: this.address, area: this.area, district: this.district, state: this.state, pincode: this.pincode,
    latitude: this.location.coordinates[1], longitude: this.location.coordinates[0],
    linked_area_id: this.linked_area_id ? this.linked_area_id.toString() : null,
    flood_severity: this.flood_severity,
    beneficiary_capacity: this.beneficiary_capacity,
    volunteer_capacity: this.volunteer_capacity,
    duration_days: this.duration_days,
    opening_date: this.opening_date,
    expected_closing_date: this.expected_closing_date,
    beneficiaries_accepted: this.beneficiaries_accepted,
    volunteers_accepted: this.volunteers_accepted,
    facilities: this.facilities.toObject ? this.facilities.toObject() : this.facilities,
    assigned_official_id: this.assigned_official_id ? this.assigned_official_id.toString() : null,
    nearest_hospital_name: this.nearest_hospital_name,
    nearest_hospital_contact: this.nearest_hospital_contact,
    nearest_police_name: this.nearest_police_name,
    nearest_police_contact: this.nearest_police_contact,
  };
};

export const Camp = mongoose.model('Camp', campSchema);
