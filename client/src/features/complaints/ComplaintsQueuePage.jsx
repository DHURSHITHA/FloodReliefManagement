import { useState } from 'react';
import {
  Alert, Box, Button, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { COMPLAINT_STATUSES, CLOSED_COMPLAINT_STATUSES } from '@frp/shared';
import { useComplaints, useReviewComplaint } from '../../api/complaints.js';
import { toFormErrors } from '../../api/client.js';
import { CampBar } from '../../camps/CampBar.jsx';
import { useCampScope } from '../../camps/CampScope.jsx';
import { ComplaintCard, STATUS_LABELS } from './ComplaintCard.jsx';

/** The review controls an official gets on each complaint. */
function ReviewControls({ complaint }) {
  const review = useReviewComplaint();
  const [status, setStatus] = useState(complaint.status);
  const [resolution, setResolution] = useState(complaint.resolution ?? '');
  const [error, setError] = useState(null);

  const closing = CLOSED_COMPLAINT_STATUSES.includes(status);
  const unchanged = status === complaint.status && resolution === (complaint.resolution ?? '');

  async function save() {
    setError(null);
    try {
      await review.mutateAsync({ id: complaint.id, status, resolution: resolution || undefined });
    } catch (err) {
      const { message, fields } = toFormErrors(err);
      setError(fields.resolution ?? message);
    }
  }

  return (
    <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid #F0E7DE' }}>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <TextField
          select size="small" label="Status" value={status}
          onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 180, mb: 0 }}
        >
          {COMPLAINT_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</MenuItem>
          ))}
        </TextField>

        <Button variant="contained" size="medium" onClick={save} disabled={review.isPending || unchanged}>
          {review.isPending ? 'Saving…' : 'Update'}
        </Button>
      </Box>

      {closing && (
        <TextField
          label="What was done"
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          placeholder="Required before this can be closed."
          multiline minRows={2}
          sx={{ mt: 2 }}
        />
      )}
    </Box>
  );
}

/**
 * The official's side: everything raised at the camp they are working in.
 * It shares the camp bar with check-in and distribute, so switching camps
 * switches the queue too.
 */
export function ComplaintsQueuePage() {
  const { params, campId } = useCampScope();
  const [statusFilter, setStatusFilter] = useState('');
  const { data: complaints = [], isLoading } = useComplaints({
    ...params,
    ...(statusFilter ? { status: statusFilter } : {}),
  });

  const open = complaints.filter((c) => !CLOSED_COMPLAINT_STATUSES.includes(c.status)).length;

  return (
    <Box>
      <CampBar />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>
            Queries
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {open} still need attention.
          </Typography>
        </Box>
        <TextField
          select size="small" label="Filter by status" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          sx={{ minWidth: 180, ml: 'auto', mb: 0 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {COMPLAINT_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</MenuItem>
          ))}
        </TextField>
      </Box>

      <Stack spacing={2} sx={{ maxWidth: 720 }}>
        {complaints.map((c) => (
          <ComplaintCard key={c.id} complaint={c}>
            <ReviewControls complaint={c} />
          </ComplaintCard>
        ))}
        {!isLoading && complaints.length === 0 && (
          <Typography color="text.secondary">
            {campId ? 'Nothing has been raised at this camp.' : 'Nothing has been raised yet.'}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
