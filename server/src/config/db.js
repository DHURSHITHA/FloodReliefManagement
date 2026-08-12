import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../core/logger.js';

mongoose.set('strictQuery', true);
// Build indexes automatically in development; in production they are created
// deliberately at deploy time so a hot path never blocks on index construction.
mongoose.set('autoIndex', env.NODE_ENV !== 'production');

export async function connectDb(uri = env.MONGODB_URI) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  logger.info('mongodb connected');
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
