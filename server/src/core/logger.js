import pino from 'pino';
import { env, isProd, isTest } from '../config/env.js';

export const logger = pino({
  level: isTest ? 'silent' : isProd ? 'info' : 'debug',
  // Belt and braces: even if a secret reaches a log call, it is redacted.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.password_hash',
      '*.refresh_token',
      '*.aadhaar',
      '*.aadhaar_enc',
      '*.aadhaar_hash',
    ],
    censor: '[REDACTED]',
  },
  transport: isProd || isTest ? undefined : { target: 'pino-pretty' },
});

export const loggerEnv = env.NODE_ENV;
