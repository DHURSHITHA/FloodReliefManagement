import mongoose from 'mongoose';
import { DONATION_TYPES, DONATION_STATUSES } from '@frp/shared';

/**
 * Requirements §6.13. `amount`/`payment_method`/`payment_reference` apply
 * only to financial donations; a material donation's line items live in
 * the sibling `donation_materials` collection (donationMaterial.model.js)
 * because a single donation may carry several items with their own
 * quantity/unit/estimated value.
 */
const donationSchema = new mongoose.Schema(
  {
    donation_code: { type: String, required: true, unique: true },
    donor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Donor', required: true, index: true },
    donation_type: { type: String, enum: DONATION_TYPES, required: true },
    target_camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', default: null },
    purpose: { type: String, default: '' },
    status: { type: String, enum: DONATION_STATUSES, default: 'pending', index: true },
    donated_at: { type: Date, default: Date.now },
    amount: { type: Number, default: null },
    payment_method: { type: String, default: '' },
    payment_reference: { type: String, default: '' },
    // Distinguishes a donor's own submission from one an admin recorded on
    // their behalf (spec's own reasoning for why admins may POST /donations).
    recorded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    confirmed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmed_at: { type: Date, default: null },
    rejection_reason: { type: String, default: '' },
  },
  { timestamps: true, collection: 'donations' }
);

donationSchema.index({ donor_id: 1, createdAt: -1 });
donationSchema.index({ status: 1, createdAt: -1 });

donationSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    donation_code: this.donation_code,
    donor_id: this.donor_id.toString(),
    donation_type: this.donation_type,
    target_camp_id: this.target_camp_id ? this.target_camp_id.toString() : null,
    purpose: this.purpose,
    status: this.status,
    donated_at: this.donated_at,
    amount: this.amount,
    payment_method: this.payment_method,
    payment_reference: this.payment_reference,
    recorded_by: this.recorded_by.toString(),
    confirmed_by: this.confirmed_by ? this.confirmed_by.toString() : null,
    confirmed_at: this.confirmed_at,
    rejection_reason: this.rejection_reason,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Donation = mongoose.model('Donation', donationSchema);
