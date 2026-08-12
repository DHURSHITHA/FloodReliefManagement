/**
 * Dev helper: assign camps to the active camp officials.
 *
 * An official with no camps has no camp scope, so every camp-scoped screen
 * (check-in, distribute, volunteers) legitimately shows them nothing. The
 * admin Officials page assigns camps at approval time; this covers accounts
 * approved before that page existed.
 *
 * Run: node --env-file=.env scripts/assign-official-camp.mjs <campId> [campId...]
 */
import mongoose from 'mongoose';

const campIds = process.argv.slice(2);
if (campIds.length === 0 || !campIds.every((id) => /^[0-9a-fA-F]{24}$/.test(id))) {
  console.error('Usage: node --env-file=.env scripts/assign-official-camp.mjs <campId> [campId...]');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
const users = mongoose.connection.collection('users');
const camps = mongoose.connection.collection('camps');

const ids = campIds.map((id) => new mongoose.Types.ObjectId(id));
const found = await camps.find({ _id: { $in: ids } }).toArray();
if (found.length !== ids.length) {
  console.error(`Only ${found.length} of ${ids.length} camps exist.`);
  await mongoose.disconnect();
  process.exit(1);
}

const officials = await users.find({ role: 'camp_official', status: 'active' }).toArray();
for (const o of officials) {
  await users.updateOne({ _id: o._id }, { $set: { assigned_camp_ids: ids } });
  console.log(`assigned ${found.map((c) => `"${c.name}"`).join(', ')} -> ${o.name}`);
}

// Point the first camp back at one of them so the Camps table's Official column fills in.
if (officials.length && !found[0].assigned_official_id) {
  await camps.updateOne({ _id: found[0]._id }, { $set: { assigned_official_id: officials.at(-1)._id } });
}

console.log('--- after ---');
for (const u of await users.find({ role: 'camp_official' }).toArray()) {
  console.log(`${u.name} | ${u.status} | camps: ${(u.assigned_camp_ids ?? []).length}`);
}
await mongoose.disconnect();
