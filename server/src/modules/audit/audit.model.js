import mongoose from 'mongoose';

// Fields mandated by requirements §15: audit id, actor, role, action, module,
// record id, timestamp, previous value, new value.
const auditLogSchema = new mongoose.Schema(
  {
    actor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actor_role: {
      type: String,
      required: true,
      enum: ['admin', 'camp_official', 'affected_person', 'donor', 'system'],
    },
    action: { type: String, required: true, index: true },
    module: { type: String, required: true, index: true },
    record_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'audit_logs' }
);

// Audit records are append-only. Nothing in the application may edit or delete one.
auditLogSchema.pre('findOneAndUpdate', function block(next) {
  next(new Error('Audit logs are immutable.'));
});
auditLogSchema.pre('updateOne', function block(next) {
  next(new Error('Audit logs are immutable.'));
});

auditLogSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
