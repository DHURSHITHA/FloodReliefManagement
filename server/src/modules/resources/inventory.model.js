import mongoose from 'mongoose';

const inventorySchema = new mongoose.Schema(
  {
    camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ResourceItem', required: true, index: true },
    batch_no: { type: String, default: null },
    // Distinguishes the single lot receiveStock manages per camp/item from
    // manually-created batches, which may legitimately number more than
    // one. See the partial unique index below.
    source: { type: String, enum: ['manual', 'donation'], default: 'manual' },
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

// At most one donation-sourced lot per camp/item -- this is what makes
// receiveStock's upsert race-safe under concurrent first-time receipt
// (server/src/modules/resources/resources.service.js). Scoped to
// source:'donation' only, so it never constrains manually-created batches,
// which may still number more than one per camp/item as before.
inventorySchema.index(
  { camp_id: 1, item_id: 1, source: 1 },
  { unique: true, partialFilterExpression: { source: 'donation' } }
);

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
