import mongoose from 'mongoose';

const beneficiarySchema = new mongoose.Schema(
  {
    beneficiary_code: { type: String, required: true, unique: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    status: { type: String, enum: ['applied', 'partially_checked_in', 'active', 'closed'], default: 'applied' },
    duplicate_warning: { type: Boolean, default: false },
    applied_at: { type: Date, default: Date.now },
    closed_at: { type: Date, default: null },
  },
  { timestamps: true, collection: 'beneficiaries' }
);

beneficiarySchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    beneficiary_code: this.beneficiary_code,
    camp_id: this.camp_id.toString(),
    status: this.status,
    duplicate_warning: this.duplicate_warning,
    applied_at: this.applied_at,
  };
};

export const Beneficiary = mongoose.model('Beneficiary', beneficiarySchema);
