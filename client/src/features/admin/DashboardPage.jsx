import { Box, Card, CardContent, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useDashboardSummary } from '../../api/dashboard.js';
import { useLiveCampUpdates } from '../../api/socket.js';

function Stat({ label, value, to, tone }) {
  const clickable = Boolean(to);
  return (
    <Card
      {...(clickable ? { component: RouterLink, to } : {})}
      sx={{
        textDecoration: 'none', display: 'block',
        borderLeft: tone ? `3px solid ${tone}` : undefined,
        '&:hover': clickable ? { borderColor: 'primary.main' } : undefined,
      }}
    >
      <CardContent>
        <Typography sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, fontSize: 30, lineHeight: 1.1 }}>
          {value}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{label}</Typography>
      </CardContent>
    </Card>
  );
}

function Group({ title, children }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography sx={{ fontWeight: 600 }}>{title}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 2 }}>
        {children}
      </Box>
    </Box>
  );
}

export function DashboardPage() {
  useLiveCampUpdates();
  const { data, isLoading } = useDashboardSummary();

  if (isLoading || !data) {
    return <Typography color="text.secondary">Loading dashboard…</Typography>;
  }

  const { camps, beneficiaries, volunteers, inventory, flood_monitoring: flood } = data;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Box>
        <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>
          Administrator dashboard
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Every figure is computed live from stored records.
        </Typography>
      </Box>

      <Group title="Camps">
        <Stat label="Total camps" value={camps.total} to="/admin/camps" />
        <Stat label="Open" value={camps.by_status.open ?? 0} to="/admin/camps" />
        <Stat label="Nearly full" value={camps.by_status.nearly_full ?? 0} to="/admin/camps" />
        <Stat label="Full" value={camps.by_status.full ?? 0} to="/admin/camps" />
        <Stat label="Beds occupied" value={`${camps.beneficiaries_accepted} / ${camps.beneficiary_capacity}`} to="/admin/camps" />
      </Group>

      <Group title="Beneficiaries">
        <Stat label="Households registered" value={beneficiaries.total_registered} />
        <Stat label="People checked in" value={beneficiaries.total_checked_in} />
        <Stat label="High priority" value={beneficiaries.high_priority} />
      </Group>

      <Group title="Volunteers">
        <Stat label="Awaiting a duty" value={volunteers.accepted} to="/official/volunteers" />
        <Stat label="On duty now" value={volunteers.active} to="/official/volunteers" />
        <Stat label="Completed" value={volunteers.completed} to="/official/volunteers" />
      </Group>

      <Group title="Inventory">
        <Stat label="Stock entries" value={inventory.total_entries} to="/admin/inventory" />
        <Stat label="Low stock" value={inventory.low_stock} to="/admin/inventory" tone={inventory.low_stock > 0 ? '#C0392B' : undefined} />
        <Stat label="Near expiry" value={inventory.near_expiry} to="/admin/inventory" tone={inventory.near_expiry > 0 ? '#8A5B0C' : undefined} />
        <Stat label="Expired" value={inventory.expired} to="/admin/inventory" tone={inventory.expired > 0 ? '#C0392B' : undefined} />
      </Group>

      <Group title="Flood monitoring">
        <Stat label="Affected areas" value={flood.affected_areas} to="/admin/areas" />
        <Stat label="Active alerts" value={flood.active_alerts} to="/admin/areas" tone={flood.active_alerts > 0 ? '#C44E00' : undefined} />
      </Group>
    </Box>
  );
}
