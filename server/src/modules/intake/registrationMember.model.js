import mongoose from 'mongoose';
import { derivePriority } from '@frp/shared';

const registrationMemberSchema = new mongoose.Schema(
  {
    beneficiary_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary', required: true, index: true },
    is_primary: { type: Boolean, required: true, default: false },
    relation_to_applicant: { type: String, default: null },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    age: { type: Number, required: true, min: 0, max: 120 },
    gender: { type: String, required: true, enum: ['male', 'female', 'other'] },
    mobile: { type: String, default: null, trim: true },
    address: { type: String, default: null, trim: true },
    aadhaar_hash: { type: String, required: true },
    aadhaar_enc: { type: String, required: true, select: false },
    aadhaar_last4: { type: String, required: true },
    is_pregnant: { type: Boolean, default: false },
    has_disability: { type: Boolean, default: false },
    priority_level: { type: String, enum: ['high', 'normal'], default: 'normal' },
    priority_tags: { type: [String], default: [] },
    wants_to_volunteer: { type: Boolean, default: false },
    volunteer_status: {
      type: String,
      enum: ['not_requested', 'accepted', 'not_accepted_slots_full', 'active', 'completed'],
      default: 'not_requested',
    },
    volunteer_task: { type: String, default: null },
    volunteer_shift: { type: String, default: null },
    volunteer_hours: { type: Number, default: 0 },
    checkin_status: { type: String, enum: ['pending', 'checked_in'], default: 'pending' },
    checked_in_at: { type: Date, default: null },
    is_active_registration: { type: Boolean, default: true },
    duplicate_warning: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'registration_members' }
);

// Hard dedup (spec section 2.2): a person cannot hold two ACTIVE
// registrations, but may register again once an earlier one closes.
registrationMemberSchema.index(
  { aadhaar_hash: 1 },
  { unique: true, partialFilterExpression: { is_active_registration: true } }
);

/** Computed here, never settable from a request body (spec sections 5.2, 7). */
registrationMemberSchema.pre('validate', function computePriority() {
  const { priority_tags, priority_level } = derivePriority({
    age: this.age, is_pregnant: this.is_pregnant, has_disability: this.has_disability,
  });
  this.priority_tags = priority_tags;
  this.priority_level = priority_level;
});

// Belt-and-suspenders: createRegistrationSchema's superRefine already
// blocks both of these at the API boundary. Repeated here so the
// invariant holds even for a write that reaches this model some other
// way (a script, a future caller) — the same reasoning
// inventory.model.js's partial unique index applies at the database layer.
registrationMemberSchema.pre('validate', function enforceMemberInvariants() {
  if (this.wants_to_volunteer && this.age < 18) {
    this.invalidate('wants_to_volunteer', 'A volunteer must be at least 18 years old.');
  }
  if (this.is_pregnant && this.gender === 'male') {
    this.invalidate('is_pregnant', 'Pregnancy cannot be marked for a male member.');
  }
});

registrationMemberSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    beneficiary_id: this.beneficiary_id.toString(),
    is_primary: this.is_primary,
    relation_to_applicant: this.relation_to_applicant,
    name: this.name, age: this.age, gender: this.gender,
    mobile: this.mobile, address: this.address,
    aadhaar_last4: this.aadhaar_last4,
    is_pregnant: this.is_pregnant, has_disability: this.has_disability,
    priority_level: this.priority_level, priority_tags: this.priority_tags,
    wants_to_volunteer: this.wants_to_volunteer, volunteer_status: this.volunteer_status,
    checkin_status: this.checkin_status, checked_in_at: this.checked_in_at,
    duplicate_warning: this.duplicate_warning,
  };
};

export const RegistrationMember = mongoose.model('RegistrationMember', registrationMemberSchema);
