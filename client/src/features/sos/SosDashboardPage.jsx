import { useState } from 'react';
import {
  Alert, Box, Button, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { SOS_STATUSES, CLOSED_SOS_STATUSES } from '@frp/shared';
import { useSosRequests, useTransitionSos } from '../../api/sos.js';
import { useLiveSosUpdates } from '../../api/socket.js';
import { toFormErrors } from '../../api/client.js';
import { CampBar } from '../../camps/CampBar.jsx';
import { useCampScope } from '../../camps/CampScope.jsx';
import { SosCard, STATUS_LABELS } from './SosCard.jsx';

const TRANSITIONABLE = SOS_STATUSES.filter((s) => s !== 'open');

/** The response controls an official or admin gets on each SOS request. */
function ResponseControls({ sos }) {
  const transition = useTransitionSos();
  const [status, setStatus] = useState(sos.status === 'open' ? 'acknowledged' : sos.status);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);

  const closing = CLOSED_SOS_STATUSES.includes(status);
  const unchanged = status === sos.status;

  async function save() {
    setError(null);
    try {
      await transition.mutateAsync({ id: sos.id, status, note: note || undefined });
      setNote('');
    } catch (err) {
      const { message, fields } = toFormErrors(err);
      setError(fields.note ?? message);
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
          {TRANSITIONABLE.map((s) => (
            <MenuItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</MenuItem>
          ))}
        </TextField>

        <Button variant="contained" size="medium" onClick={save} disabled={transition.isPending || unchanged}>
          {transition.isPending ? 'Saving…' : 'Update'}
        </Button>
      </Box>

      {closing && (
        <TextField
          label="What was done"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Required before this can be closed."
          multiline minRows={2}
          sx={{ mt: 2 }}
        />
      )}
    </Box>
  );
}

/**
 * The Emergency dashboard: everything raised at the camp an official is
 * working in, or every camp for an admin. Shares the camp bar with the other
 * operational screens, and updates live — an emergency someone else just
 * acknowledged should not sit in the list looking unattended.
 */
export function SosDashboardPage() {
  useLiveSosUpdates();
  const { params, campId } = useCampScope();
  const [statusFilter, setStatusFilter] = useState('');
  const { data: requests = [], isLoading } = useSosRequests({
    ...params,
    ...(statusFilter ? { status: statusFilter } : {}),
  });

  const open = requests.filter((s) => !CLOSED_SOS_STATUSES.includes(s.status)).length;

  return (
    <Box>
      <CampBar />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>
            Emergency
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {open} still need a response.
          </Typography>
        </Box>
        <TextField
          select size="small" label="Filter by status" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          sx={{ minWidth: 180, ml: 'auto', mb: 0 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {SOS_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</MenuItem>
          ))}
        </TextField>
      </Box>

      <Stack spacing={2} sx={{ maxWidth: 720 }}>
        {requests.map((s) => (
          <SosCard key={s.id} sos={s}>
            <ResponseControls sos={s} />
          </SosCard>
        ))}
        {!isLoading && requests.length === 0 && (
          <Typography color="text.secondary">
            {campId ? 'Nothing has been reported at this camp.' : 'Nothing has been reported yet.'}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
