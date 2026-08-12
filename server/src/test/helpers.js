import mongoose from 'mongoose';

/** Empty every collection between tests without dropping indexes. */
export async function clearDatabase() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

/**
 * Ensure declared indexes exist — unique constraints are inert without this.
 *
 * Memoized per process. Indexes survive clearDatabase() (which only empties
 * documents), so syncing them once per test file is enough. Doing it in every
 * beforeEach meant ~18 models × every test in the suite, which dominated the
 * run time and churned index state between tests for no benefit.
 */
let indexSync = null;
export async function syncIndexes() {
  indexSync ??= Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await indexSync;
}
