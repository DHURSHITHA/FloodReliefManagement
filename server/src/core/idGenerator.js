import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema(
  { _id: String, seq: { type: Number, default: 0 } },
  { collection: 'counters' }
);

const Counter = mongoose.model('Counter', counterSchema);

/** Atomic $inc + upsert — the only race-free way to hand out sequential
 * Beneficiary IDs under concurrent registrations (spec section 4.2). */
export async function nextBeneficiaryCode(session) {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'beneficiary_code' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );
  return `BEN-${1000 + counter.seq}`;
}

/** Same atomic counter, own sequence — the "Complaint ID" of §6.10. */
export async function nextComplaintCode(session) {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'complaint_code' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );
  return `CMP-${1000 + counter.seq}`;
}
