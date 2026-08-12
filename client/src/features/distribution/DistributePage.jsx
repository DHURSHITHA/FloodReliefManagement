import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Card, CardContent, MenuItem, TextField, Typography } from '@mui/material';
import { api } from '../../api/client.js';
import { useResourceItems } from '../../api/resources.js';
import { useDistributeItem } from '../../api/distributions.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';

export function DistributePage() {
  const [code, setCode] = useState('');
  const [lookupCode, setLookupCode] = useState(null);
  const { data: items = [] } = useResourceItems();
  const [itemId, setItemId] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const distribute = useDistributeItem();
  const [error, setError] = useState(null);
  const [needsOverride, setNeedsOverride] = useState(false);
  const [success, setSuccess] = useState(null);

  const { data: registration, isError: lookupFailed } = useQuery({
    queryKey: ['registrations', 'lookup', lookupCode],
    queryFn: async () => (await api.get(`/registrations/${lookupCode}`)).data.registration,
    enabled: Boolean(lookupCode),
    retry: false,
  });

  const checkedInCount = registration?.members.filter((m) => m.checkin_status === 'checked_in').length ?? 0;

  async function onDistribute() {
    setError(null);
    setSuccess(null);
    try {
      const result = await distribute.mutateAsync({
        beneficiary_id: registration.beneficiary.id,
        item_id: itemId,
        ...(overrideReason ? { override_reason: overrideReason } : {}),
      });
      setSuccess(`Distributed ${result.quantity} unit(s).`);
      setNeedsOverride(false);
      setOverrideReason('');
    } catch (err) {
      const envelope = err?.response?.data?.error;
      setError(envelope?.message ?? 'Could not record the distribution.');
      setNeedsOverride(envelope?.code === 'NOT_VERIFIED');
    }
  }

  return (
    <Box sx={{ maxWidth: 520 }}>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 2 }}>
        Record a distribution
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <TextField label="Beneficiary code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="BEN-1001" />
        <Button variant="outlined" onClick={() => setLookupCode(code.trim())} disabled={!code.trim()}>Find</Button>
      </Box>

      {lookupFailed && <Alert severity="warning">No registration found for that code.</Alert>}

      {registration && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>{registration.beneficiary.beneficiary_code}</Typography>
              <StatusBadge tone={checkedInCount > 0 ? 'ok' : 'warn'}>
                {checkedInCount} of {registration.members.length} checked in
              </StatusBadge>
            </Box>

            <TextField select label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)} sx={{ mt: 1 }}>
              {items.map((i) => <MenuItem key={i.id} value={i.id}>{i.name}</MenuItem>)}
            </TextField>

            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
            {needsOverride && (
              <TextField
                label="Override reason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Why distribute before check-in?"
                multiline minRows={2}
                sx={{ mt: 2 }}
              />
            )}
            {success && <Alert severity="success" sx={{ mt: 2 }}>{success}</Alert>}

            <Button
              variant="contained" fullWidth sx={{ mt: 2 }}
              disabled={!itemId || distribute.isPending || (needsOverride && !overrideReason.trim())}
              onClick={onDistribute}
            >
              {distribute.isPending ? 'Distributing…' : needsOverride ? 'Distribute with override' : 'Distribute'}
            </Button>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
