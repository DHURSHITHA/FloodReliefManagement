import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES } from '@frp/shared';

export const BCRYPT_COST = 12;

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Sparse so many users may omit one identifier while the other stays unique.
    mobile: { type: String, default: undefined, trim: true },
    email: { type: String, default: undefined, trim: true, lowercase: true },
    // select:false means the hash never rides along on an ordinary query.
    password_hash: { type: String, required: true, select: false },
    role: { type: String, required: true, enum: ROLES, index: true },
    status: {
      type: String,
      required: true,
      enum: ['active', 'pending_approval', 'rejected', 'disabled'],
      default: 'active',
      index: true,
    },
    assigned_camp_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Camp', default: null, index: true },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approved_at: { type: Date, default: null },
    last_login_at: { type: Date, default: null },
  },
  { timestamps: true, collection: 'users' }
);

userSchema.index({ mobile: 1 }, { unique: true, sparse: true });
userSchema.index({ email: 1 }, { unique: true, sparse: true });

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.password_hash);
};

/** The ONLY shape a user may be serialized in for a response. */
userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    mobile: this.mobile ?? null,
    email: this.email ?? null,
    role: this.role,
    status: this.status,
    assigned_camp_id: this.assigned_camp_id ? this.assigned_camp_id.toString() : null,
  };
};

export async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export const User = mongoose.model('User', userSchema);
