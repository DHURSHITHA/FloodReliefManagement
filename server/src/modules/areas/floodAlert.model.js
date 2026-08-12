import mongoose from 'mongoose';
import { SEVERITIES } from '@frp/shared';

const floodAlertSchema = new mongoose.Schema(
  {
    area_id: { type: mongoose.Schema.Types.ObjectId, ref: 'AffectedArea', required: true, index: true },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    severity: { type: String, required: true, enum: SEVERITIES },
    status: { type: String, required: true, enum: ['active', 'resolved'], default: 'active', index: true },
    raised_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    resolved_at: { type: Date, default: null },
  },
  { timestamps: true, collection: 'flood_alerts' }
);

export const FloodAlert = mongoose.model('FloodAlert', floodAlertSchema);
