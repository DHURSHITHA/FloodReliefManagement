/**
 * Dev check against the running server for the two newest features:
 * the distribution priority queue and complaint management (§6.10).
 *
 * Run: node --env-file=.env scripts/verify-queries-and-priority.mjs
 */
import mongoose from 'mongoose';
import { signAccessToken } from '../server/src/core/tokens.js';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:4000';
await mongoose.connect(process.env.MONGODB_URI);
const users = mongoose.connection.collection('users');

const official = await users.findOne({ role: 'camp_official', status: 'active', 'assigned_camp_ids.0': { $exists: true } });
const person = await users.findOne({ role: 'affected_person', status: 'active' });
const donor = await users.findOne({ role: 'donor', status: 'active' });

const tokenFor = (u) => signAccessToken({
  _id: u._id, role: u.role, status: u.status, assigned_camp_ids: u.assigned_camp_ids ?? [],
});
const hdrs = (u) => ({ Authorization: `Bearer ${tokenFor(u)}`, 'Content-Type': 'application/json' });
const campId = official.assigned_camp_ids[0].toString();

async function call(label, u, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: hdrs(u), ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { label, status: res.status, json };
}
const show = (r, extra = '') => console.log(`${r.label.padEnd(46)} ${r.status}  ${extra || r.json.error?.message || ''}`);

console.log('--- priority queue ---');
const q = await call('official GET /registrations/priority', official, 'GET', `/api/registrations/priority?camp_id=${campId}`);
show(q, q.json.members ? `${q.json.members.length} in queue: ${q.json.members.map((m) => `${m.name}[${m.priority_tags}]`).join(' > ') || '(none checked in yet)'}` : '');
show(await call('donor GET /registrations/priority', donor, 'GET', '/api/registrations/priority'));

console.log('--- complaints ---');
const raised = await call('person POST /complaints', person, 'POST', '/api/complaints', {
  camp_id: campId, category: 'water', description: 'Live verification: the water point has been dry since morning.', priority: 'high',
});
show(raised, raised.json.complaint?.complaint_code);

const id = raised.json.complaint?.id;
show(await call('official GET /complaints (their camp)', official, 'GET', `/api/complaints?camp_id=${campId}`),
  `${(await call('x', official, 'GET', `/api/complaints?camp_id=${campId}`)).json.complaints?.length} visible`);
show(await call('person GET /complaints/mine', person, 'GET', '/api/complaints/mine'),
  `${(await call('x', person, 'GET', '/api/complaints/mine')).json.complaints?.length} own`);

if (id) {
  show(await call('official PATCH -> under_review', official, 'PATCH', `/api/complaints/${id}`, { status: 'under_review' }));
  show(await call('official PATCH -> resolved, no reason', official, 'PATCH', `/api/complaints/${id}`, { status: 'resolved' }),
    'expect 400');
  const done = await call('official PATCH -> resolved, with reason', official, 'PATCH', `/api/complaints/${id}`, {
    status: 'resolved', resolution: 'Tanker refilled at 14:00.',
  });
  show(done, done.json.complaint?.resolved_at ? `resolved_at stamped` : '');
}
show(await call('donor POST /complaints', donor, 'POST', '/api/complaints', {
  camp_id: campId, category: 'food', description: 'Donors may not raise complaints at all.',
}));

const notifs = await call('reporter notifications', person, 'GET', '/api/notifications');
console.log(`reporter heard back: ${(notifs.json.notifications ?? []).filter((n) => n.type === 'complaint_update').map((n) => n.message).join(' | ') || 'none'}`);

await mongoose.disconnect();
