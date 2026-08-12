import mongoose from 'mongoose';

const campCheckinSchema = new mongoose.Schema(
  {
    beneficiary_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Beneficiary', required: true, index: true },
    member_id: { type: mongoose.Schema.Types.ObjectId, ref: 'RegistrationMember', required: true, index: true },
    camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    verified_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    checked_in_at: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'camp_checkins' }
);

export const CampCheckin = mongoose.model('CampCheckin', campCheckinSchema);
