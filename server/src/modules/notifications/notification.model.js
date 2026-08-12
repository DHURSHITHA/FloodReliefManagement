import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      required: true,
      enum: ['low_stock', 'expiry', 'complaint', 'complaint_update', 'other'],
      default: 'other',
    },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    ref_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    read: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'notifications' }
);

notificationSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(), type: this.type, message: this.message,
    ref_id: this.ref_id ? this.ref_id.toString() : null, read: this.read, createdAt: this.createdAt,
  };
};

export const Notification = mongoose.model('Notification', notificationSchema);
