import mongoose from 'mongoose';

const idempotencyRecordSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    response: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true, collection: 'idempotency_records' }
);

// 24h TTL — long enough to cover a poor-connection double-tap, short enough
// not to accumulate forever.
idempotencyRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

const IdempotencyRecord = mongoose.model('IdempotencyRecord', idempotencyRecordSchema);

/**
 * Run `fn` once per key. A repeated key returns the first call's result
 * without re-running `fn` — spec section 8's "a repeated key returns the
 * original response rather than creating a second registration."
 * `fn`'s return value must be plain, JSON-serializable data (a Mongoose
 * document would serialize its internal metadata too); callers should
 * shape their result with toSafeJSON() before returning it here.
 */
export async function withIdempotency(key, fn) {
  if (!key) return fn();

  const existing = await IdempotencyRecord.findOne({ key });
  if (existing) return existing.response;

  const result = await fn();
  try {
    await IdempotencyRecord.create({ key, response: result });
  } catch (err) {
    // Another request with the same key won the race to write the record
    // first — its result is equally valid, nothing to do.
    if (err?.code !== 11000) throw err;
  }
  return result;
}
