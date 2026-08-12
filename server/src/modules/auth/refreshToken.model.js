import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token_hash: { type: String, required: true, unique: true },
    // Every token descends from one login. Reuse revokes the whole family.
    family_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    expires_at: { type: Date, required: true },
    revoked_at: { type: Date, default: null },
    replaced_by: { type: String, default: null },
  },
  { timestamps: true, collection: 'refresh_tokens' }
);

// MongoDB reaps expired documents automatically; no cleanup job needed.
refreshTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
