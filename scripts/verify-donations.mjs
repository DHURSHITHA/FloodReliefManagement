/**
 * Dev check against the running server for donors and donations (§6.12,
 * §6.13), proving stock posting and §16 criterion 17 live: "Donors can
 * record fund and material donations and receive a unique Donation ID."
 *
 * Run: node --env-file=.env scripts/verify-donations.mjs
 */
import mongoose from 'mongoose';
import { signAccessToken } from '../server/src/core/tokens.js';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:4000';
await mongoose.connect(process.env.MONGODB_URI);
const users = mongoose.connection.collection('users');
const camps = mongoose.connection.collection('camps');

const admin = await users.findOne({ role: 'admin', status: 'active' });
let donor = await users.findOne({ role: 'donor', status: 'active' });
const camp = await camps.findOne({});

const tokenFor = (u) => signAccessToken({ _id: u._id, role: u.role, status: u.status, assigned_camp_ids: u.assigned_camp_ids ?? [] });
const hdrs = (u) => ({ Authorization: `Bearer ${tokenFor(u)}`, 'Content-Type': 'application/json' });

async function call(label, u, method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: hdrs(u), ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await res.json().catch(() => ({}));
  return { label, status: res.status, json };
}
const show = (r, extra = '') => console.log(`${r.label.padEnd(52)} ${r.status}  ${extra || r.json.error?.message || ''}`);

console.log('--- donor profile (§6.12) ---');
show(await call('donor POST /donors/me', donor, 'POST', '/api/donors/me', {
  donor_type: 'individual', name: 'Verify Donor', mobile: '9876543210', address: 'Live verification address',
}));

console.log('--- resource item for the material donation ---');
const item = await call('admin POST /resources', admin, 'POST', '/api/resources', {
  name: `Verify Rice ${Date.now()}`, category: 'food', unit: 'kg',
});
show(item, item.json.item?.id);

console.log('--- material donation → confirmation → stock (§16 #17, §4.2 of the M2 design) ---');
const before = await call('inventory before', admin, 'GET', `/api/inventory?camp_id=${camp._id}`);
const beforeQty = (before.json.inventory ?? []).find((i) => i.item_id === item.json.item.id)?.remaining_qty ?? 0;

const material = await call('donor POST /donations (material)', donor, 'POST', '/api/donations', {
  donation_type: 'material', target_camp_id: camp._id.toString(),
  materials: [{ resource_item_id: item.json.item.id, quantity: 100, unit: 'kg' }],
});
show(material, material.json.donation?.donation_code);

const confirmed = await call('admin PATCH confirm', admin, 'PATCH', `/api/donations/${material.json.donation.id}/confirm`, { action: 'confirm' });
show(confirmed, confirmed.json.donation?.status);

const after = await call('inventory after', admin, 'GET', `/api/inventory?camp_id=${camp._id}`);
const afterQty = (after.json.inventory ?? []).find((i) => i.item_id === item.json.item.id)?.remaining_qty ?? 0;
console.log(`camp inventory: ${beforeQty} -> ${afterQty} (expect +100)`);

console.log('--- financial donation, rejection, and the derived-totals principle (§16 #20) ---');
const financial = await call('donor POST /donations (financial)', donor, 'POST', '/api/donations', {
  donation_type: 'financial', amount: 2500, payment_method: 'UPI',
});
show(financial, financial.json.donation?.donation_code);
show(await call('admin PATCH reject, no reason', admin, 'PATCH', `/api/donations/${financial.json.donation.id}/confirm`, { action: 'reject' }), 'expect 400');
const rejected = await call('admin PATCH reject, with reason', admin, 'PATCH', `/api/donations/${financial.json.donation.id}/confirm`, {
  action: 'reject', rejection_reason: 'Live verification: intentionally rejected.',
});
show(rejected, rejected.json.donation?.status);

const mine = await call('donor GET /donations/mine', donor, 'GET', '/api/donations/mine');
const totalConfirmed = (mine.json.donations ?? []).filter((d) => d.status === 'confirmed' && d.donation_type === 'financial')
  .reduce((sum, d) => sum + d.amount, 0);
console.log(`donor's own confirmed financial total, computed from the list (never a stored field): ₹${totalConfirmed}`);

console.log('--- role boundaries ---');
const person = await users.findOne({ role: 'affected_person', status: 'active' });
show(await call('affected person POST /donations', person, 'POST', '/api/donations', { donation_type: 'financial', amount: 1, payment_method: 'cash' }));
show(await call('donor GET /donations (admin-only)', donor, 'GET', '/api/donations'));

await mongoose.disconnect();
