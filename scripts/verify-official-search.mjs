/**
 * Dev check: prove a camp official can now find a beneficiary by code on both
 * the Check-in search and the Distribute lookup, and that an official with no
 * assigned camp gets a legible 403 instead of silent emptiness.
 *
 * Run against the running dev server:
 *   node --env-file=.env scripts/verify-official-search.mjs BEN-1005
 */
import mongoose from 'mongoose';
import { signAccessToken } from '../server/src/core/tokens.js';

const code = (process.argv[2] ?? 'BEN-1005').toUpperCase();
const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:4000';

await mongoose.connect(process.env.MONGODB_URI);
const users = mongoose.connection.collection('users');

const assigned = await users.findOne({ role: 'camp_official', status: 'active', assigned_camp_id: { $ne: null } });
const stranded = await users.findOne({ role: 'camp_official', assigned_camp_id: null });

async function hit(label, user, path) {
  if (!user) return console.log(`${label.padEnd(34)} skipped (no such user)`);
  const token = signAccessToken({
    _id: user._id, role: user.role, status: user.status, assigned_camp_id: user.assigned_camp_id,
  });
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  const count = body.registrations?.length ?? (body.registration ? 1 : 0);
  const detail = res.ok ? `${count} result(s)` : (body.error?.message ?? '');
  console.log(`${label.padEnd(34)} ${res.status}  ${detail}`);
}

console.log(`--- assigned official: ${assigned?.name ?? 'none'} ---`);
await hit('Check-in search', assigned, `/api/registrations?search=${code}`);
await hit('Distribute lookup', assigned, `/api/registrations/${code}`);
await hit('Volunteers list', assigned, '/api/volunteers');

console.log(`--- unassigned official: ${stranded?.name ?? 'none'} ---`);
await hit('Check-in search', stranded, `/api/registrations?search=${code}`);
await hit('Distribute lookup', stranded, `/api/registrations/${code}`);

await mongoose.disconnect();
