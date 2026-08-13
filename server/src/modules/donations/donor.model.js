import mongoose from 'mongoose';
import { DONOR_TYPES } from '@frp/shared';

/**
 * Requirements §6.12. A profile keyed by user_id, not a parallel account
 * store — donor signup already goes through the common auth flow (users
 * already carries the `donor` role), so a second account store here would
 * fork authentication. The auth module keeps sole ownership of `users`.
 */
const donorSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    donor_type: { type: String, enum: DONOR_TYPES, required: true },
    name: { type: String, required: true, trim: true },
    contact_person: { type: String, default: '' },
    mobile: { type: String, required: true, trim: true },
    email: { type: String, default: '' },
    address: { type: String, required: true, trim: true },
    registration_details: { type: String, default: '' },
  },
  { timestamps: true, collection: 'donors' }
);

donorSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    user_id: this.user_id.toString(),
    donor_type: this.donor_type,
    name: this.name,
    contact_person: this.contact_person,
    mobile: this.mobile,
    email: this.email,
    address: this.address,
    registration_details: this.registration_details,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Donor = mongoose.model('Donor', donorSchema);
