import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, MenuItem, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useResourceItems, useInventory, useCreateInventory } from '../../../api/resources.js';
import { useCamps } from '../../../api/camps.js';
import { StatusBadge } from '../../../components/StatusBadge.jsx';
import { toFormErrors } from '../../../api/client.js';

export function InventoryPage() {
  const { data: items = [] } = useResourceItems();
  const { data: camps = [] } = useCamps();
  const [campFilter, setCampFilter] = useState('');
  const { data: inventory = [] } = useInventory(campFilter || undefined);
  const createInventory = useCreateInventory();

  const [values, setValues] = useState({ camp_id: '', item_id: '', remaining_qty: '', reorder_threshold: '' });
  const [error, setError] = useState(null);
  const change = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }));

  const itemName = (id) => items.find((i) => i.id === id)?.name ?? 'Unknown item';
  const itemUnit = (id) => items.find((i) => i.id === id)?.unit ?? '';
  const campName = (id) => camps.find((c) => c.id === id)?.name ?? '—';

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await createInventory.mutateAsync({
        ...values,
        remaining_qty: Number(values.remaining_qty),
        reorder_threshold: Number(values.reorder_threshold),
      });
      setValues({ camp_id: '', item_id: '', remaining_qty: '', reorder_threshold: '' });
    } catch (err) {
      setError(toFormErrors(err).message);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>Inventory</Typography>
        <TextField select size="small" label="Camp" value={campFilter} onChange={(e) => setCampFilter(e.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">All camps</MenuItem>
          {camps.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
        </TextField>
      </Box>

      <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Item</TableCell>
              <TableCell>Camp</TableCell>
              <TableCell align="right">Remaining</TableCell>
              <TableCell align="right">Distributed</TableCell>
              <TableCell align="right">Threshold</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {inventory.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell>
                  <Typography sx={{ fontWeight: 600 }}>{itemName(inv.item_id)}</Typography>
                  <Typography variant="body2" color="text.secondary">{itemUnit(inv.item_id)}</Typography>
                </TableCell>
                <TableCell>{campName(inv.camp_id)}</TableCell>
                <TableCell align="right">{inv.remaining_qty}</TableCell>
                <TableCell align="right">{inv.distributed_qty}</TableCell>
                <TableCell align="right">{inv.reorder_threshold}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                    {inv.is_low_stock && <StatusBadge tone="bad">Low stock</StatusBadge>}
                    {inv.is_expired && <StatusBadge tone="bad">Expired</StatusBadge>}
                    {!inv.is_expired && inv.is_near_expiry && <StatusBadge tone="warn">Near expiry</StatusBadge>}
                    {!inv.is_low_stock && !inv.is_expired && !inv.is_near_expiry && <StatusBadge tone="ok">OK</StatusBadge>}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {inventory.length === 0 && <Typography color="text.secondary">No stock recorded yet.</Typography>}

      <Card sx={{ maxWidth: 520 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 2 }}>Add stock</Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box component="form" onSubmit={onSubmit} noValidate>
            <TextField select label="Camp" value={values.camp_id} onChange={change('camp_id')}>
              {camps.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <TextField select label="Item" value={values.item_id} onChange={change('item_id')}>
              {items.map((i) => <MenuItem key={i.id} value={i.id}>{i.name}</MenuItem>)}
            </TextField>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField label="Quantity" value={values.remaining_qty} onChange={change('remaining_qty')} />
              <TextField label="Reorder threshold" value={values.reorder_threshold} onChange={change('reorder_threshold')} />
            </Box>
            <Button
              type="submit" variant="contained" fullWidth sx={{ mt: 2 }}
              disabled={!values.camp_id || !values.item_id || createInventory.isPending}
            >
              {createInventory.isPending ? 'Adding…' : 'Add stock'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
