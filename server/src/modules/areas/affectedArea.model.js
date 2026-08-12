import mongoose from 'mongoose';
import { SEVERITIES } from '@frp/shared';

const affectedAreaSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    district: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [longitude, latitude]
    },
    severity: { type: String, required: true, enum: SEVERITIES, index: true },
    estimated_population: { type: Number, default: null },
    estimated_families: { type: Number, default: null },
    source: { type: String, default: 'manual Admin entry' },
    identified_at: { type: Date, default: Date.now },
    recorded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'affected_areas' }
);

affectedAreaSchema.index({ location: '2dsphere' });

affectedAreaSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    district: this.district,
    state: this.state,
    address: this.address,
    latitude: this.location.coordinates[1],
    longitude: this.location.coordinates[0],
    severity: this.severity,
    estimated_population: this.estimated_population,
    estimated_families: this.estimated_families,
    identified_at: this.identified_at,
  };
};

export const AffectedArea = mongoose.model('AffectedArea', affectedAreaSchema);
