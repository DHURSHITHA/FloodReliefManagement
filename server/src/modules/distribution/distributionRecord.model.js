import mongoose from 'mongoose';

const distributionRecordSchema = new mongoose.Schema(
  {
    beneficiary_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary', required: true, index: true },
    camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ResourceItem', required: true, index: true },
    quantity: { type: Number, required: true, min: 0 },
    period_key: { type: String, required: true },
    distributed_at: { type: Date, default: Date.now },
    distributed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    override_reason: { type: String, default: null },
  },
  { timestamps: true, collection: 'distribution_records' }
);

// Spec section 5.4's duplicate block: one distribution per beneficiary,
// per item, per period. The insert is what catches a repeat — see
// distribution.service.js for why it runs before the stock deduction.
distributionRecordSchema.index({ beneficiary_id: 1, item_id: 1, period_key: 1 }, { unique: true });

distributionRecordSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    beneficiary_id: this.beneficiary_id.toString(),
    camp_id: this.camp_id.toString(),
    item_id: this.item_id.toString(),
    quantity: this.quantity, period_key: this.period_key,
    distributed_at: this.distributed_at, override_reason: this.override_reason,
  };
};

export const DistributionRecord = mongoose.model('DistributionRecord', distributionRecordSchema);
