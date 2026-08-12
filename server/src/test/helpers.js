import mongoose from 'mongoose';

/** Empty every collection between tests without dropping indexes. */
export async function clearDatabase() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

/** Ensure declared indexes exist — unique constraints are inert without this. */
export async function syncIndexes() {
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}
