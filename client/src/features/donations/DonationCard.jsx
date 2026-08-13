import { Box, Card, CardContent, Typography } from '@mui/material';
import { StatusBadge } from '../../components/StatusBadge.jsx';

const STATUS_TONE = { pending: 'warn', confirmed: 'ok', rejected: 'bad' };
export const STATUS_LABELS = { pending: 'Pending', confirmed: 'Confirmed', rejected: 'Rejected' };

export function DonationStatus({ status }) {
  return <StatusBadge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABELS[status] ?? status}</StatusBadge>;
}

/** One donation, financial or material, as either the donor or the admin sees it. */
export function DonationCard({ donation, children }) {
  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{donation.donation_code}</Typography>
          <DonationStatus status={donation.status} />
          {donation.donor_name && (
            <Typography variant="body2" color="text.secondary">{donation.donor_name}</Typography>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
            {new Date(donation.createdAt).toLocaleDateString()}
          </Typography>
        </Box>

        {donation.donation_type === 'financial' ? (
          <Typography sx={{ fontWeight: 600, fontSize: 20, mb: 0.5 }}>₹{donation.amount}</Typography>
        ) : (
          <Box sx={{ mb: 0.5 }}>
            {donation.materials.map((m) => (
              <Typography key={m.id} variant="body2">{m.quantity} {m.unit} — {m.item_label}</Typography>
            ))}
          </Box>
        )}
        {donation.purpose && <Typography variant="body2" color="text.secondary">{donation.purpose}</Typography>}

        {donation.status === 'rejected' && donation.rejection_reason && (
          <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid #F0E7DE' }}>
            <Typography sx={{ fontWeight: 600, fontSize: 12, mb: 0.25 }}>Why</Typography>
            <Typography variant="body2">{donation.rejection_reason}</Typography>
          </Box>
        )}

        {children}
      </CardContent>
    </Card>
  );
}
