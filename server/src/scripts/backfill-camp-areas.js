import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { logger } from '../core/logger.js';
import { Camp } from '../modules/camps/camp.model.js';
import { createArea } from '../modules/areas/areas.service.js';

/**
 * One-time backfill: every camp created before this feature existed has no
 * `linked_area_id` (the client never wrote one). This creates an affected
 * area from each such camp's own location fields and links it, using the
 * same createArea() path camps.service.js's resolveLinkedArea now uses for
 * every new camp — so old and new camps end up in an identical state.
 *
 * Idempotent: only touches camps where linked_area_id is still null, so
 * re-running after a partial or repeat run is safe.
 *
 * Run: node --env-file=../.env src/scripts/backfill-camp-areas.js
 */
async function backfillCampAreas() {
  const camps = await Camp.find({ linked_area_id: null });
  if (camps.length === 0) {
    logger.info('No camps need backfilling — every camp already has a linked area.');
    return;
  }

  logger.info(`Backfilling an affected area for ${camps.length} camp(s)...`);
  for (const camp of camps) {
    const area = await createArea(
      {
        name: camp.area, district: camp.district, state: camp.state, address: camp.address,
        latitude: camp.location.coordinates[1], longitude: camp.location.coordinates[0],
        severity: camp.flood_severity,
        source: `Backfilled from existing camp "${camp.name}"`,
      },
      // Attributed to the camp's own creator — accurate, since that person
      // originally supplied this location data when the camp was made.
      { actorId: camp.created_by, actorRole: 'admin', ip: null }
    );
    camp.linked_area_id = area._id;
    await camp.save();
    logger.info(`  ${camp.name} -> area "${area.name}" (${area._id})`);
  }
  logger.info('Backfill complete.');
}

async function main() {
  await connectDb();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await backfillCampAreas();
  await disconnectDb();
}

main().catch((err) => {
  logger.error({ err }, 'backfill-camp-areas failed');
  process.exitCode = 1;
});
