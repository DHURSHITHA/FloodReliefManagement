import { useState } from 'react';
import {
  Box, Button, MenuItem, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useCamps } from '../../../api/camps.js';
import { useLiveCampUpdates } from '../../../api/socket.js';
import { StatusBadge } from '../../../components/StatusBadge.jsx';

const STATUS_TONE = { open: 'ok', nearly_full: 'warn', full: 'bad', temporarily_closed: 'neutral', closed: 'neutral' };
const STATUS_LABEL = {
  open: 'Open', nearly_full: 'Nearly Full', full: 'Full',
  temporarily_closed: 'Temporarily Closed', closed: 'Closed',
};

export function CampsListPage() {
  useLiveCampUpdates();
  const [status, setStatus] = useState('');
  const { data: camps = [], isLoading } = useCamps(status ? { status } : {});

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>Camps</Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">All statuses</MenuItem>
            {Object.entries(STATUS_LABEL).map(([v, label]) => <MenuItem key={v} value={v}>{label}</MenuItem>)}
          </TextField>
          <Button component={RouterLink} to="/admin/camps/new" variant="contained">+ Create camp</Button>
        </Box>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Camp</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Occupied</TableCell>
              <TableCell>Volunteers</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell>Official</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {camps.map((camp) => (
              <TableRow key={camp.id}>
                <TableCell>
                  <Typography sx={{ fontWeight: 600 }}>{camp.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{camp.area}, {camp.district}</Typography>
                </TableCell>
                <TableCell>{camp.camp_type.replace('_', ' ')}</TableCell>
                <TableCell>{camp.beneficiaries_accepted} / {camp.beneficiary_capacity}</TableCell>
                <TableCell>{camp.volunteers_accepted} / {camp.volunteer_capacity}</TableCell>
                <TableCell>{camp.duration_days} days</TableCell>
                <TableCell>
                  <StatusBadge tone={camp.assigned_official_id ? 'ok' : 'neutral'}>
                    {camp.assigned_official_id ? 'Assigned' : 'Unassigned'}
                  </StatusBadge>
                </TableCell>
                <TableCell><StatusBadge tone={STATUS_TONE[camp.status]}>{STATUS_LABEL[camp.status]}</StatusBadge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {!isLoading && camps.length === 0 && (
        <Typography color="text.secondary" sx={{ mt: 3 }}>No camps yet. Create the first one.</Typography>
      )}
    </Box>
  );
}
