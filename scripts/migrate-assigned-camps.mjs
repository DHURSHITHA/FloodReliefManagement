/**
 * Migration: users.assigned_camp_id (single) -> users.assigned_camp_ids (array).
 *
 * An official may now run several camps and picks which one they are working
 * in from the camp bar. Existing accounts keep exactly the camp they had.
 *
 * Run: node --env-file=.env scripts/migrate-assigned-camps.mjs
 */
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGODB_URI);
const users = mongoose.connection.collection('users');

const legacy = await users.find({ assigned_camp_id: { $exists: true } }).toArray();
console.log(`${legacy.length} user(s) carry the old field`);

for (const u of legacy) {
  const ids = u.assigned_camp_id ? [u.assigned_camp_id] : [];
  await users.updateOne(
    { _id: u._id },
    { $set: { assigned_camp_ids: ids }, $unset: { assigned_camp_id: '' } },
  );
  console.log(`  ${u.name}: ${ids.length} camp(s)`);
}

console.log('--- after ---');
for (const u of await users.find({ role: 'camp_official' }).toArray()) {
  console.log(`${u.name} | ${u.status} | camps: ${(u.assigned_camp_ids ?? []).length}`);
}
await mongoose.disconnect();
