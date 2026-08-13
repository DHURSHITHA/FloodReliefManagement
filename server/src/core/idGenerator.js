import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema(
  { _id: String, seq: { type: Number, default: 0 } },
  { collection: 'counters' }
);

const Counter = mongoose.model('Counter', counterSchema);

/**
 * Atomic $inc + upsert — the only race-free way to hand out sequential
 * human-facing codes under concurrent requests (spec section 4.2). Counting
 * documents races under concurrent submission; this does not.
 */
async function nextCode(counterKey, prefix, session) {
  const counter = await Counter.findOneAndUpdate(
    { _id: counterKey },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );
  return `${prefix}-${1000 + counter.seq}`;
}

export const nextBeneficiaryCode = (session) => nextCode('beneficiary_code', 'BEN', session);

/** The "Complaint ID" of §6.10. */
export const nextComplaintCode = (session) => nextCode('complaint_code', 'CMP', session);

/** The SOS record id implied by §6.11's field list. */
export const nextSosCode = (session) => nextCode('sos_code', 'SOS', session);
