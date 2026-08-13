/**
 * Dev check against the running server for SOS / Emergency management
 * (§6.11), proving routing resolution and §16 criteria 15–16 live.
 *
 * Run: node --env-file=.env scripts/verify-sos.mjs
 */
import mongoose from 'mongoose';
import { signAccessToken } from '../server/src/core/tokens.js';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:4000';
await mongoose.connect(process.env.MONGODB_URI);
const users = mongoose.connection.collection('users');

const official = await users.findOne({ role: 'camp_official', status: 'active', 'assigned_camp_ids.0': { $exists: true } });
const person = await users.findOne({ role: 'affected_person', status: 'active' });
const admin = await users.findOne({ role: 'admin', status: 'active' });
const donor = await users.findOne({ role: 'donor', status: 'active' });

const tokenFor = (u) => signAccessToken({ _id: u._id, role: u.role, status: u.status, assigned_camp_ids: u.assigned_camp_ids ?? [] });
const hdrs = (u) => ({ Authorization: `Bearer ${tokenFor(u)}`, 'Content-Type': 'application/json' });
const campId = official.assigned_camp_ids[0].toString();

async function call(label, u, method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: hdrs(u), ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await res.json().catch(() => ({}));
  return { label, status: res.status, json };
}
const show = (r, extra = '') => console.log(`${r.label.padEnd(50)} ${r.status}  ${extra || r.json.error?.message || ''}`);

console.log('--- routing resolution (§16 #16) ---');
const raised = await call('person POST /sos (medical)', person, 'POST', '/api/sos', {
  camp_id: campId, category: 'medical', urgency: 'critical',
  description: 'Live verification: a woman in tent 4 needs medical attention.', location: 'Tent 4',
});
show(raised, `${raised.json.sos?.sos_code} routed to ${raised.json.sos?.routed_to_name} (${raised.json.sos?.routed_to_contact})`);

show(await call('donor POST /sos', donor, 'POST', '/api/sos', {
  camp_id: campId, category: 'medical', urgency: 'high', description: 'Donors may not raise SOS requests.', location: 'x',
}));

console.log('--- dashboard and tracking to resolution (§16 #15) ---');
const id = raised.json.sos?.id;
show(await call('official GET /sos (their camp)', official, 'GET', `/api/sos?camp_id=${campId}`),
  `${(await call('x', official, 'GET', `/api/sos?camp_id=${campId}`)).json.sos_requests?.length} visible`);

if (id) {
  show(await call('official PATCH -> acknowledged', official, 'PATCH', `/api/sos/${id}`, { status: 'acknowledged' }));
  show(await call('official PATCH -> resolved, no note', official, 'PATCH', `/api/sos/${id}`, { status: 'resolved' }), 'expect 400');
  const done = await call('official PATCH -> resolved, with note', official, 'PATCH', `/api/sos/${id}`, {
    status: 'resolved', note: 'Taken to the medical tent by 14:05, stable.',
  });
  show(done, done.json.sos?.resolved_at ? 'resolved_at stamped' : '');
}

const summary = await call('admin GET dashboard summary', admin, 'GET', '/api/dashboard/summary');
console.log(`Emergency area: ${JSON.stringify(summary.json.emergency)}`);

const notifs = await call('reporter notifications', person, 'GET', '/api/notifications');
console.log(`reporter heard back: ${(notifs.json.notifications ?? []).filter((n) => n.type === 'sos_update').map((n) => n.message).join(' | ') || 'none'}`);

await mongoose.disconnect();
