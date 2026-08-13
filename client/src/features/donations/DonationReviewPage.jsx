import { useState } from 'react';
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { DONATION_STATUSES } from '@frp/shared';
import { useAdminDonations, useDecideDonation } from '../../api/donations.js';
import { toFormErrors } from '../../api/client.js';
import { DonationCard, STATUS_LABELS } from './DonationCard.jsx';

/** The confirm/reject controls an admin gets on a pending donation. */
function DecisionControls({ donation }) {
  const decide = useDecideDonation();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  if (donation.status !== 'pending') return null;

  async function confirm() {
    setError(null);
    try {
      await decide.mutateAsync({ id: donation.id, action: 'confirm' });
    } catch (err) {
      setError(toFormErrors(err).message);
    }
  }

  async function reject() {
    setError(null);
    try {
      await decide.mutateAsync({ id: donation.id, action: 'reject', rejection_reason: reason });
    } catch (err) {
      const { message, fields } = toFormErrors(err);
      setError(fields.rejection_reason ?? message);
    }
  }

  return (
    <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid #F0E7DE' }}>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!rejecting ? (
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button variant="contained" size="medium" onClick={confirm} disabled={decide.isPending}>Confirm</Button>
          <Button variant="outlined" color="error" size="medium" onClick={() => setRejecting(true)} disabled={decide.isPending}>Reject</Button>
        </Box>
      ) : (
        <Box>
          <TextField
            label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Required before rejecting." multiline minRows={2}
          />
          <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
            <Button variant="contained" color="error" onClick={reject} disabled={decide.isPending}>
              {decide.isPending ? 'Saving…' : 'Confirm rejection'}
            </Button>
            <Button variant="text" onClick={() => setRejecting(false)}>Cancel</Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/** The admin's review queue: every donation, defaulting to what still needs a decision. */
export function DonationReviewPage() {
  const [statusFilter, setStatusFilter] = useState('pending');
  const { data: donations = [], isLoading } = useAdminDonations(statusFilter ? { status: statusFilter } : {});

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>
          Donations
        </Typography>
        <TextField
          select size="small" label="Filter by status" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          sx={{ minWidth: 180, ml: 'auto', mb: 0 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {DONATION_STATUSES.map((s) => <MenuItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</MenuItem>)}
        </TextField>
      </Box>

      <Stack spacing={2} sx={{ maxWidth: 720 }}>
        {donations.map((d) => (
          <DonationCard key={d.id} donation={d}>
            <DecisionControls donation={d} />
          </DonationCard>
        ))}
        {!isLoading && donations.length === 0 && (
          <Typography color="text.secondary">Nothing is waiting on a decision.</Typography>
        )}
      </Stack>
    </Box>
  );
}
