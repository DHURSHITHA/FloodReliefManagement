import mongoose from 'mongoose';
import { COMPLAINT_CATEGORIES, COMPLAINT_STATUSES, COMPLAINT_PRIORITIES } from '@frp/shared';

/** Requirements §6.10. Field names follow the spec's list. */
const complaintSchema = new mongoose.Schema(
  {
    complaint_code: { type: String, required: true, unique: true },
    reporter_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reporter_role: { type: String, required: true },
    camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    category: { type: String, enum: COMPLAINT_CATEGORIES, required: true },
    description: { type: String, required: true },
    priority: { type: String, enum: COMPLAINT_PRIORITIES, default: 'normal' },
    status: { type: String, enum: COMPLAINT_STATUSES, default: 'open', index: true },
    // "Assigned Person" in the spec: the official who picked it up.
    assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolution: { type: String, default: '' },
    resolved_at: { type: Date, default: null },
  },
  { timestamps: true, collection: 'complaints' }
);

// The official's list is "this camp, newest first" on every load.
complaintSchema.index({ camp_id: 1, createdAt: -1 });

complaintSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    complaint_code: this.complaint_code,
    reporter_id: this.reporter_id.toString(),
    reporter_role: this.reporter_role,
    camp_id: this.camp_id.toString(),
    category: this.category,
    description: this.description,
    priority: this.priority,
    status: this.status,
    assigned_to: this.assigned_to ? this.assigned_to.toString() : null,
    resolution: this.resolution,
    resolved_at: this.resolved_at,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Complaint = mongoose.model('Complaint', complaintSchema);
