import mongoose from 'mongoose';

const inventorySchema = new mongoose.Schema(
  {
    camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ResourceItem', required: true, index: true },
    batch_no: { type: String, default: null },
    remaining_qty: { type: Number, required: true, min: 0 },
    distributed_qty: { type: Number, default: 0, min: 0 },
    reorder_threshold: { type: Number, required: true, min: 0 },
    expiry_date: { type: Date, default: null },
    received_at: { type: Date, default: Date.now },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'inventory' }
);

inventorySchema.index({ camp_id: 1, item_id: 1 });

inventorySchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    camp_id: this.camp_id.toString(),
    item_id: this.item_id.toString(),
    batch_no: this.batch_no,
    remaining_qty: this.remaining_qty,
    distributed_qty: this.distributed_qty,
    reorder_threshold: this.reorder_threshold,
    expiry_date: this.expiry_date,
    received_at: this.received_at,
  };
};

export const Inventory = mongoose.model('Inventory', inventorySchema);
