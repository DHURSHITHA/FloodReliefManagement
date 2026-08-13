import mongoose from 'mongoose';

/**
 * One item line on a material donation (spec §6.13). item_label/category
 * are copied from the ResourceItem at creation time — display fields a
 * donor never types directly, so donated rice and procured rice are always
 * described the same way.
 */
const donationMaterialSchema = new mongoose.Schema(
  {
    donation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Donation', required: true, index: true },
    resource_item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ResourceItem', required: true },
    item_label: { type: String, required: true },
    category: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    estimated_value: { type: Number, default: 0 },
    remarks: { type: String, default: '' },
  },
  { timestamps: true, collection: 'donation_materials' }
);

donationMaterialSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    donation_id: this.donation_id.toString(),
    resource_item_id: this.resource_item_id.toString(),
    item_label: this.item_label,
    category: this.category,
    quantity: this.quantity,
    unit: this.unit,
    estimated_value: this.estimated_value,
    remarks: this.remarks,
  };
};

export const DonationMaterial = mongoose.model('DonationMaterial', donationMaterialSchema);
