/**
 * Dev check against the running server: an official can search across the
 * camps assigned to them, narrow to one with the camp bar's camp_id, and is
 * refused a camp that isn't theirs.
 *
 * Run: node --env-file=.env scripts/verify-official-search.mjs BEN-1005
 */
import mongoose from 'mongoose';
import { signAccessToken } from '../server/src/core/tokens.js';

const code = (process.argv[2] ?? 'BEN-1005').toUpperCase();
const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:4000';

await mongoose.connect(process.env.MONGODB_URI);
const users = mongoose.connection.collection('users');
const camps = mongoose.connection.collection('camps');

const official = await users.findOne({
  role: 'camp_official', status: 'active', 'assigned_camp_ids.0': { $exists: true },
});
const token = signAccessToken({
  _id: official._id, role: official.role, status: official.status,
  assigned_camp_ids: official.assigned_camp_ids,
});
const auth = { Authorization: `Bearer ${token}` };

const mine = await camps.find({ _id: { $in: official.assigned_camp_ids } }).toArray();
const other = await camps.findOne({ _id: { $nin: official.assigned_camp_ids } });
console.log(`${official.name} runs: ${mine.map((c) => c.name).join(', ')}`);

async function hit(label, path) {
  const res = await fetch(`${BASE}${path}`, { headers: auth });
  const body = await res.json().catch(() => ({}));
  const count = body.registrations?.length ?? body.volunteers?.length ?? (body.registration ? 1 : 0);
  console.log(`${label.padEnd(38)} ${res.status}  ${res.ok ? `${count} result(s)` : body.error?.message ?? ''}`);
}

await hit('search, no camp selected', `/api/registrations?search=${code}`);
await hit('search, narrowed to its own camp', `/api/registrations?search=${code}&camp_id=${mine[0]._id}`);
await hit('search, narrowed to the other camp', `/api/registrations?search=${code}&camp_id=${mine[1]._id}`);
if (other) await hit('search, camp not assigned to them', `/api/registrations?search=${code}&camp_id=${other._id}`);
await hit('volunteers, no camp selected', '/api/volunteers');
await hit('volunteers, narrowed', `/api/volunteers?camp_id=${mine[0]._id}`);

await mongoose.disconnect();
