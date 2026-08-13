import { Camp } from '../camps/camp.model.js';
import { Beneficiary } from '../intake/beneficiary.model.js';
import { RegistrationMember } from '../intake/registrationMember.model.js';
import { Inventory } from '../resources/inventory.model.js';
import { AffectedArea } from '../areas/affectedArea.model.js';
import { FloodAlert } from '../areas/floodAlert.model.js';
import { getSosDashboardCounts } from '../sos/sos.service.js';
import { isLowStock, isNearExpiry, isExpired } from '@frp/shared';

/**
 * Every figure here is computed from stored data, never manually entered
 * (spec section 18). Registered and checked-in are kept as separate,
 * clearly labelled counts rather than merged into one number, because
 * section 6.16 asks for exactly that distinction.
 */
export async function getDashboardSummary() {
  const [campTotal, campStatusCounts] = await Promise.all([
    Camp.countDocuments(),
    Camp.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  const [beneficiaryTotal, checkedInCount, highPriorityCount, campCapacity] = await Promise.all([
    Beneficiary.countDocuments(),
    RegistrationMember.countDocuments({ checkin_status: 'checked_in' }),
    RegistrationMember.countDocuments({ priority_level: 'high' }),
    Camp.aggregate([
      { $group: { _id: null, capacity: { $sum: '$beneficiary_capacity' }, accepted: { $sum: '$beneficiaries_accepted' } } },
    ]),
  ]);

  const [volunteerAccepted, volunteerActive, volunteerCompleted] = await Promise.all([
    RegistrationMember.countDocuments({ volunteer_status: 'accepted' }),
    RegistrationMember.countDocuments({ volunteer_status: 'active' }),
    RegistrationMember.countDocuments({ volunteer_status: 'completed' }),
  ]);

  // Read once, classify in memory: the three flags come from the same pure
  // helpers the inventory API uses, so a figure here can never disagree
  // with what the inventory screen shows.
  const inventoryEntries = await Inventory.find();
  const lowStock = inventoryEntries.filter((i) => isLowStock(i)).length;
  const expired = inventoryEntries.filter((i) => isExpired(i.expiry_date)).length;
  const nearExpiry = inventoryEntries.filter((i) => !isExpired(i.expiry_date) && isNearExpiry(i.expiry_date)).length;

  const [affectedAreas, activeAlerts] = await Promise.all([
    AffectedArea.countDocuments(),
    FloodAlert.countDocuments({ status: 'active' }),
  ]);

  const emergency = await getSosDashboardCounts();

  const capacityTotals = campCapacity[0] ?? { capacity: 0, accepted: 0 };

  return {
    camps: {
      total: campTotal,
      by_status: Object.fromEntries(campStatusCounts.map((c) => [c._id, c.count])),
      beneficiary_capacity: capacityTotals.capacity,
      beneficiaries_accepted: capacityTotals.accepted,
    },
    beneficiaries: {
      total_registered: beneficiaryTotal,
      total_checked_in: checkedInCount,
      high_priority: highPriorityCount,
    },
    volunteers: {
      accepted: volunteerAccepted,
      active: volunteerActive,
      completed: volunteerCompleted,
    },
    inventory: {
      total_entries: inventoryEntries.length,
      low_stock: lowStock,
      near_expiry: nearExpiry,
      expired,
    },
    flood_monitoring: {
      affected_areas: affectedAreas,
      active_alerts: activeAlerts,
    },
    emergency,
  };
}
