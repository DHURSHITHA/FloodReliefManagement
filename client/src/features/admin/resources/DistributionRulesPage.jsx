import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useResourceItems, useDistributionRules, useCreateDistributionRule } from '../../../api/resources.js';
import { StatusBadge } from '../../../components/StatusBadge.jsx';
import { toFormErrors } from '../../../api/client.js';

export function DistributionRulesPage() {
  const { data: items = [] } = useResourceItems();
  const [itemId, setItemId] = useState('');
  const { data: rules = [] } = useDistributionRules(itemId);
  const createRule = useCreateDistributionRule();

  const [mode, setMode] = useState('fixed');
  const [period, setPeriod] = useState('daily');
  const [qty, setQty] = useState('');
  const [error, setError] = useState(null);

  const qtyLabel = mode === 'per_head' ? 'Quantity per person' : 'Fixed quantity';

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    const payload = { item_id: itemId, mode, period };
    if (mode === 'fixed') payload.fixed_qty = Number(qty);
    if (mode === 'per_head') payload.per_head_qty = Number(qty);
    if (mode === 'family_band') {
      payload.bands = [
        { min: 1, max: 3, qty: Number(qty) },
        { min: 4, max: 8, qty: Number(qty) * 2 },
      ];
    }
    try {
      await createRule.mutateAsync(payload);
      setQty('');
    } catch (err) {
      setError(toFormErrors(err).message);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>
        Distribution rules
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
        <Card>
          <CardContent>
            <Typography sx={{ fontWeight: 600, mb: 2 }}>Configure a rule</Typography>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            <Box component="form" onSubmit={onSubmit} noValidate>
              <TextField select label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                {items.map((i) => <MenuItem key={i.id} value={i.id}>{i.name}</MenuItem>)}
              </TextField>
              <TextField select label="Mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                <MenuItem value="fixed">Fixed — same amount per household</MenuItem>
                <MenuItem value="per_head">Per head — multiplied by family size</MenuItem>
                <MenuItem value="family_band">Family band — tiered by household size</MenuItem>
              </TextField>
              <TextField select label="Period" value={period} onChange={(e) => setPeriod(e.target.value)}>
                <MenuItem value="daily">Daily</MenuItem>
                <MenuItem value="weekly">Weekly</MenuItem>
                <MenuItem value="once">Once</MenuItem>
              </TextField>
              <TextField label={qtyLabel} value={qty} onChange={(e) => setQty(e.target.value)} />
              {mode === 'family_band' && (
                <Alert severity="info" sx={{ mt: 1 }}>
                  Creates two bands: 1–3 people get this amount, 4–8 get double.
                </Alert>
              )}
              <Button
                type="submit" variant="contained" fullWidth sx={{ mt: 2 }}
                disabled={!itemId || !qty || createRule.isPending}
              >
                {createRule.isPending ? 'Saving…' : 'Save rule'}
              </Button>
            </Box>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography sx={{ fontWeight: 600, mb: 2 }}>Rules for the selected item</Typography>
            {!itemId && <Typography color="text.secondary">Pick an item to see its rules.</Typography>}
            <Stack spacing={1.25}>
              {rules.map((r) => (
                <Box key={r.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, py: 1, borderTop: '1px solid #F0E7DE' }}>
                  <Box>
                    <Typography sx={{ fontWeight: 600 }}>{r.mode.replace('_', ' ')} · {r.period}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {r.camp_id ? 'Camp-specific override' : 'Global default'}
                    </Typography>
                  </Box>
                  <StatusBadge tone={r.active ? 'ok' : 'neutral'}>{r.active ? 'Active' : 'Inactive'}</StatusBadge>
                </Box>
              ))}
            </Stack>
            {itemId && rules.length === 0 && <Typography color="text.secondary">No rules configured yet.</Typography>}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
