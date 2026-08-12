process.env.NODE_ENV = 'test';

import { beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet;

beforeAll(async () => {
  // A REPLICA SET, not a standalone server: transactions require one.
  // fileParallelism:false in vitest.config.js means this runs once for the whole suite.
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(replSet.getUri());
}, 900_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});
