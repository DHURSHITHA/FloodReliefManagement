import { Box, Card, CardContent, Typography } from '@mui/material';
import { StatusBadge } from '../../components/StatusBadge.jsx';

const STATUS_TONE = {
  open: 'bad', acknowledged: 'warn', responding: 'brand', resolved: 'ok', closed: 'neutral',
};

export const STATUS_LABELS = {
  open: 'Open', acknowledged: 'Acknowledged', responding: 'Responding',
  resolved: 'Resolved', closed: 'Closed',
};

const URGENCY_TONE = { critical: 'bad', high: 'warn', medium: 'brand', low: 'neutral' };

const CATEGORY_LABELS = {
  medical: 'Medical', security: 'Security', food_shortage: 'Food shortage',
  water_shortage: 'Water shortage', missing_person: 'Missing person', other: 'Other emergency',
};

export function SosStatus({ status }) {
  return <StatusBadge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABELS[status] ?? status}</StatusBadge>;
}

/**
 * One SOS request, with the routed contact front and center — a number
 * someone may have to dial under time pressure, not a buried detail.
 */
export function SosCard({ sos, children }) {
  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{sos.sos_code}</Typography>
          <StatusBadge tone={URGENCY_TONE[sos.urgency] ?? 'neutral'}>{sos.urgency}</StatusBadge>
          <SosStatus status={sos.status} />
          <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
            {new Date(sos.createdAt).toLocaleString()}
          </Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          {CATEGORY_LABELS[sos.category] ?? sos.category} · {sos.location}
        </Typography>
        <Typography variant="body2" sx={{ mb: 1.5 }}>{sos.description}</Typography>

        <Box sx={{ p: 1.25, borderRadius: '10px', bgcolor: '#FFF0E4' }}>
          <Typography sx={{ fontWeight: 600, fontSize: 12, color: '#C44E00' }}>
            Routed to {sos.routed_to_name}
          </Typography>
          <Typography sx={{ fontSize: 13 }}>{sos.routed_to_contact}</Typography>
        </Box>

        {sos.resolution && (
          <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid #F0E7DE' }}>
            <Typography sx={{ fontWeight: 600, fontSize: 12, mb: 0.25 }}>What was done</Typography>
            <Typography variant="body2">{sos.resolution}</Typography>
          </Box>
        )}

        {children}
      </CardContent>
    </Card>
  );
}
