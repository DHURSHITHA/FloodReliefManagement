import mongoose from 'mongoose';
import { RESOURCE_CATEGORIES } from '@frp/shared';

const resourceItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, required: true, enum: RESOURCE_CATEGORIES, index: true },
    unit: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'resource_items' }
);

resourceItemSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(), name: this.name, category: this.category,
    unit: this.unit, description: this.description,
  };
};

export const ResourceItem = mongoose.model('ResourceItem', resourceItemSchema);
