import mongoose from 'mongoose';
import { SOS_CATEGORIES, SOS_URGENCY, SOS_STATUSES } from '@frp/shared';

/**
 * Requirements §6.11. `routed_to_*` is copied from the camp at creation time,
 * not referenced — if a camp's hospital contact is edited later, the record
 * of who was actually called during a past emergency must not silently
 * change (the same reasoning that keeps camp_checkins an event log rather
 * than a live join).
 */
const sosSchema = new mongoose.Schema(
  {
    sos_code: { type: String, required: true, unique: true },
    reported_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reporter_role: { type: String, required: true },
    camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    category: { type: String, enum: SOS_CATEGORIES, required: true },
    urgency: { type: String, enum: SOS_URGENCY, required: true },
    description: { type: String, required: true },
    location: { type: String, required: true },
    status: { type: String, enum: SOS_STATUSES, default: 'open', index: true },
    routed_to_type: { type: String, enum: ['hospital', 'police', 'camp_admin'], required: true },
    routed_to_name: { type: String, required: true },
    routed_to_contact: { type: String, required: true },
    resolution: { type: String, default: '' },
    resolved_at: { type: Date, default: null },
    timeline: [
      {
        _id: false,
        status: { type: String, enum: SOS_STATUSES, required: true },
        actor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        note: { type: String, default: '' },
        at: { type: Date, required: true },
      },
    ],
  },
  { timestamps: true, collection: 'sos_requests' }
);

// The Emergency dashboard's only query shape: this camp, ranked by urgency.
sosSchema.index({ camp_id: 1, status: 1, urgency: 1 });
// The admin's cross-camp open list.
sosSchema.index({ status: 1, createdAt: -1 });

sosSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    sos_code: this.sos_code,
    reported_by: this.reported_by.toString(),
    reporter_role: this.reporter_role,
    camp_id: this.camp_id.toString(),
    category: this.category,
    urgency: this.urgency,
    description: this.description,
    location: this.location,
    status: this.status,
    routed_to_type: this.routed_to_type,
    routed_to_name: this.routed_to_name,
    routed_to_contact: this.routed_to_contact,
    resolution: this.resolution,
    resolved_at: this.resolved_at,
    timeline: this.timeline.map((t) => ({
      status: t.status, actor_id: t.actor_id.toString(), note: t.note, at: t.at,
    })),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const SosRequest = mongoose.model('SosRequest', sosSchema);
