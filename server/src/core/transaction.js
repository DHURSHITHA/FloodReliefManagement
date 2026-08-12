import mongoose from 'mongoose';

/**
 * Run `fn` inside a MongoDB transaction and return its result.
 *
 * session.withTransaction retries automatically on TransientTransactionError
 * and UnknownTransactionCommitResult, which is what spec §8 requires. It also
 * aborts on any thrown error, so partial writes cannot survive.
 *
 * Requires a replica set. Atlas is one; a standalone mongod is not.
 */
export async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
