import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useResourceItems, useDistributionRules, useCreateDistributionRule, useUpdateDistributionRule } from '../../../api/resources.js';
import { useCamps } from '../../../api/camps.js';
import { StatusBadge } from '../../../components/StatusBadge.jsx';
import { toFormErrors } from '../../../api/client.js';

const EMPTY_FORM = { campId: '', mode: 'fixed', period: 'daily', qty: '' };

/**
 * A rule is keyed by item + camp (server section: distributionRule.model.js's
 * partial unique index on {camp_id, item_id, active}). Leaving the camp
 * picker on "Global" targets every camp without its own override; picking
 * one scopes the rule to just that camp, so the same item can carry a
 * different rule at each camp. `camp_id` is always sent explicitly — as a
 * real id or as `null` — never omitted, so clearing a rule back to global
 * during an edit is distinguishable from leaving the field untouched.
 */
export function DistributionRulesPage() {
  const { data: items = [] } = useResourceItems();
  const { data: camps = [] } = useCamps();
  const [itemId, setItemId] = useState('');
  const { data: rules = [] } = useDistributionRules(itemId);
  const createRule = useCreateDistributionRule();
  const updateRule = useUpdateDistributionRule();

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);

  const qtyLabel = form.mode === 'per_head' ? 'Quantity per person' : 'Fixed quantity';
  const saving = createRule.isPending || updateRule.isPending;

  function startEdit(rule) {
    setEditingId(rule.id);
    setForm({
      campId: rule.camp_id ?? '',
      mode: rule.mode,
      period: rule.period,
      qty: String(
        rule.mode === 'family_band' ? (rule.bands[0]?.qty ?? '')
        : rule.mode === 'per_head' ? rule.per_head_qty
        : rule.fixed_qty
      ),
    });
    setError(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }
  function changeItem(e) {
    setItemId(e.target.value);
    cancelEdit();
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    const payload = { item_id: itemId, camp_id: form.campId || null, mode: form.mode, period: form.period };
    if (form.mode === 'fixed') payload.fixed_qty = Number(form.qty);
    if (form.mode === 'per_head') payload.per_head_qty = Number(form.qty);
    if (form.mode === 'family_band') {
      payload.bands = [
        { min: 1, max: 3, qty: Number(form.qty) },
        { min: 4, max: 8, qty: Number(form.qty) * 2 },
      ];
    }
    try {
      if (editingId) {
        await updateRule.mutateAsync({ id: editingId, payload });
      } else {
        await createRule.mutateAsync(payload);
      }
      cancelEdit();
    } catch (err) {
      setError(toFormErrors(err).message);
    }
  }

  const campName = (id) => camps.find((c) => c.id === id)?.name ?? 'Unknown camp';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>
        Distribution rules
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
        <Card>
          <CardContent>
            <Typography sx={{ fontWeight: 600, mb: 2 }}>{editingId ? 'Edit rule' : 'Configure a rule'}</Typography>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            <Box component="form" onSubmit={onSubmit} noValidate>
              <TextField select label="Item" value={itemId} onChange={changeItem} disabled={Boolean(editingId)}>
                {items.map((i) => <MenuItem key={i.id} value={i.id}>{i.name}</MenuItem>)}
              </TextField>
              <TextField select label="Camp" value={form.campId} onChange={(e) => setForm((f) => ({ ...f, campId: e.target.value }))}>
                <MenuItem value="">Global — every camp without its own rule</MenuItem>
                {camps.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>
              <TextField select label="Mode" value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}>
                <MenuItem value="fixed">Fixed — same amount per household</MenuItem>
                <MenuItem value="per_head">Per head — multiplied by family size</MenuItem>
                <MenuItem value="family_band">Family band — tiered by household size</MenuItem>
              </TextField>
              <TextField select label="Period" value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}>
                <MenuItem value="daily">Daily</MenuItem>
                <MenuItem value="weekly">Weekly</MenuItem>
                <MenuItem value="once">Once</MenuItem>
              </TextField>
              <TextField label={qtyLabel} value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} />
              {form.mode === 'family_band' && (
                <Alert severity="info" sx={{ mt: 1 }}>
                  Creates two bands: 1–3 people get this amount, 4–8 get double.
                </Alert>
              )}
              <Box sx={{ display: 'flex', gap: 1.5, mt: 2 }}>
                <Button type="submit" variant="contained" fullWidth disabled={!itemId || !form.qty || saving}>
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Save rule'}
                </Button>
                {editingId && <Button variant="text" onClick={cancelEdit}>Cancel</Button>}
              </Box>
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
                      {r.camp_id ? `Camp-specific override — ${campName(r.camp_id)}` : 'Global default'}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <StatusBadge tone={r.active ? 'ok' : 'neutral'}>{r.active ? 'Active' : 'Inactive'}</StatusBadge>
                    <Button size="small" onClick={() => startEdit(r)}>Edit</Button>
                  </Box>
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
