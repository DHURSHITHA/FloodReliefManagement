import {
  Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { useDistributions } from '../../api/distributions.js';
import { useResourceItems } from '../../api/resources.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';

export function DistributionHistoryPage() {
  const { data: distributions = [] } = useDistributions();
  const { data: items = [] } = useResourceItems();
  const itemName = (id) => items.find((i) => i.id === id)?.name ?? 'Unknown item';

  return (
    <Box>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 2 }}>
        Distribution history
      </Typography>

      <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>When</TableCell>
              <TableCell>Item</TableCell>
              <TableCell align="right">Quantity</TableCell>
              <TableCell>Period</TableCell>
              <TableCell>Notes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {distributions.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{new Date(d.distributed_at).toLocaleString()}</TableCell>
                <TableCell>{itemName(d.item_id)}</TableCell>
                <TableCell align="right">{d.quantity}</TableCell>
                <TableCell>{d.period_key}</TableCell>
                <TableCell>
                  {d.override_reason ? <StatusBadge tone="warn">Override</StatusBadge> : <StatusBadge tone="ok">Verified</StatusBadge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {distributions.length === 0 && (
        <Typography color="text.secondary" sx={{ mt: 3 }}>No distributions recorded yet.</Typography>
      )}
    </Box>
  );
}
