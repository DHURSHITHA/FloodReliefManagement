/**
 * Dev check against the running server: the pending-officials list loads, and
 * approving without a camp is refused before anything is written.
 *
 * Run: node --env-file=.env scripts/verify-official-approval.mjs
 */
import mongoose from 'mongoose';
import { signAccessToken } from '../server/src/core/tokens.js';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:4000';
await mongoose.connect(process.env.MONGODB_URI);
const users = mongoose.connection.collection('users');

const admin = await users.findOne({ role: 'admin', status: 'active' });
const token = signAccessToken({ _id: admin._id, role: admin.role, status: admin.status, assigned_camp_id: null });
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const list = await fetch(`${BASE}/api/auth/pending-officials`, { headers: auth });
const { officials = [] } = await list.json();
console.log(`GET /pending-officials -> ${list.status}, ${officials.length} waiting: ${officials.map((o) => o.name).join(', ') || '—'}`);

if (officials.length) {
  const target = officials[0];

  const noCamp = await fetch(`${BASE}/api/auth/officials/${target.id}/decision`, {
    method: 'POST', headers: auth, body: JSON.stringify({ decision: 'approve' }),
  });
  const noCampBody = await noCamp.json();
  console.log(`approve without camp   -> ${noCamp.status}  ${noCampBody.error?.details?.[0]?.message ?? ''}`);

  const badCamp = await fetch(`${BASE}/api/auth/officials/${target.id}/decision`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ decision: 'approve', assigned_camp_id: '0'.repeat(24) }),
  });
  console.log(`approve unknown camp   -> ${badCamp.status}  ${(await badCamp.json()).error?.message ?? ''}`);

  const after = await users.findOne({ _id: new mongoose.Types.ObjectId(target.id) });
  console.log(`${target.name} still ${after.status} (nothing was written)`);
}

await mongoose.disconnect();
