import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { usePendingOfficials, useDecideOfficial } from '../../api/auth.js';
import { useCamps } from '../../api/camps.js';
import { toFormErrors } from '../../api/client.js';

/**
 * Approving an official without a camp used to strand the account: every
 * camp-scoped screen filters on assigned_camp_id, so a null one silently
 * showed them nothing. The camp picker is therefore required to approve,
 * and the server enforces the same rule.
 */
function OfficialCard({ official, camps }) {
  const decide = useDecideOfficial();
  const [campId, setCampId] = useState('');
  const [error, setError] = useState(null);

  async function decideWith(decision) {
    setError(null);
    try {
      await decide.mutateAsync({ id: official.id, decision, assigned_camp_id: campId || undefined });
    } catch (err) {
      const { message, fields } = toFormErrors(err);
      setError(fields.assigned_camp_id ?? message);
    }
  }

  return (
    <Card>
      <CardContent>
        <Typography sx={{ fontWeight: 600 }}>{official.name}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {official.mobile || official.email} · requested {new Date(official.createdAt).toLocaleDateString()}
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <TextField
          select
          label="Camp they will run"
          value={campId}
          onChange={(e) => setCampId(e.target.value)}
          helperText="Required to approve — an official without a camp cannot see anyone."
        >
          {camps.map((c) => (
            <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
          ))}
        </TextField>

        <Box sx={{ display: 'flex', gap: 1.25, mt: 2 }}>
          <Button
            variant="contained"
            disabled={decide.isPending || !campId}
            onClick={() => decideWith('approve')}
          >
            {decide.isPending ? 'Saving…' : 'Approve'}
          </Button>
          <Button color="inherit" disabled={decide.isPending} onClick={() => decideWith('reject')}>
            Reject
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}

export function OfficialsPage() {
  const { data: officials = [], isLoading } = usePendingOfficials();
  const { data: camps = [] } = useCamps();

  return (
    <Box>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>
        Camp officials
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
        Officials who signed up and are waiting to be approved. Approving one assigns them the camp
        they will run.
      </Typography>

      {camps.length === 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          There are no camps yet. Create a camp before approving an official.
        </Alert>
      )}

      <Stack spacing={2} sx={{ maxWidth: 560 }}>
        {officials.map((o) => <OfficialCard key={o.id} official={o} camps={camps} />)}
        {!isLoading && officials.length === 0 && (
          <Typography color="text.secondary">No officials are waiting for approval.</Typography>
        )}
      </Stack>
    </Box>
  );
}
