/**
 * One-off dev fix: assign a camp to camp officials who were approved without one.
 *
 * An official whose `assigned_camp_id` is null has no camp scope, so every
 * camp-scoped screen (check-in, distribute, volunteers) legitimately shows
 * them nothing. Until an admin screen exists for approving officials *with*
 * a camp, this script does it directly.
 *
 * Run: node --env-file=.env scripts/assign-official-camp.mjs <campId>
 */
import mongoose from 'mongoose';

const campId = process.argv[2];
if (!/^[0-9a-fA-F]{24}$/.test(campId ?? '')) {
  console.error('Usage: node --env-file=.env scripts/assign-official-camp.mjs <campId>');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
const users = mongoose.connection.collection('users');
const camps = mongoose.connection.collection('camps');

const camp = await camps.findOne({ _id: new mongoose.Types.ObjectId(campId) });
if (!camp) {
  console.error(`No camp with id ${campId}.`);
  await mongoose.disconnect();
  process.exit(1);
}

const officials = await users.find({ role: 'camp_official', status: 'active' }).toArray();
for (const o of officials) {
  await users.updateOne({ _id: o._id }, { $set: { assigned_camp_id: camp._id } });
  console.log(`assigned "${camp.name}" -> ${o.name}`);
}

// Point the camp back at one of them so the Camps table's Official column fills in.
if (officials.length && !camp.assigned_official_id) {
  await camps.updateOne({ _id: camp._id }, { $set: { assigned_official_id: officials.at(-1)._id } });
}

console.log('--- after ---');
for (const u of await users.find({ role: 'camp_official' }).toArray()) {
  console.log(`${u.name} | ${u.status} | camp: ${u.assigned_camp_id ?? 'none'}`);
}
await mongoose.disconnect();
