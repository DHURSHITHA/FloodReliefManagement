import mongoose from 'mongoose';

const bandSchema = new mongoose.Schema({ min: Number, max: Number, qty: Number }, { _id: false });
const addonSchema = new mongoose.Schema({ when: String, extra_qty: Number }, { _id: false });

const distributionRuleSchema = new mongoose.Schema(
  {
    item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ResourceItem', required: true, index: true },
    // null = a global default, applying to every camp without its own override.
    camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', default: null, index: true },
    mode: { type: String, required: true, enum: ['per_head', 'family_band', 'fixed'] },
    period: { type: String, required: true, enum: ['daily', 'weekly', 'once'] },
    bands: { type: [bandSchema], default: [] },
    per_head_qty: { type: Number, default: null },
    fixed_qty: { type: Number, default: null },
    priority_addons: { type: [addonSchema], default: [] },
    eligibility: { type: [String], default: [] },
    min_qty: { type: Number, default: null },
    max_qty: { type: Number, default: null },
    effective_from: { type: Date, default: null },
    effective_to: { type: Date, default: null },
    active: { type: Boolean, default: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'distribution_rules' }
);

// At most one *active* rule per camp+item — including camp_id: null, so
// this covers both tiers at once: one active global default per item, and
// separately one active camp-specific override per camp+item. Deactivated
// (active: false) history is unconstrained, the same partial-unique-index
// shape inventory.model.js already established for donation-sourced lots.
distributionRuleSchema.index(
  { camp_id: 1, item_id: 1, active: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);

distributionRuleSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(), item_id: this.item_id.toString(),
    camp_id: this.camp_id ? this.camp_id.toString() : null,
    mode: this.mode, period: this.period, bands: this.bands,
    per_head_qty: this.per_head_qty, fixed_qty: this.fixed_qty,
    priority_addons: this.priority_addons, eligibility: this.eligibility,
    min_qty: this.min_qty, max_qty: this.max_qty,
    effective_from: this.effective_from, effective_to: this.effective_to, active: this.active,
  };
};

export const DistributionRule = mongoose.model('DistributionRule', distributionRuleSchema);
