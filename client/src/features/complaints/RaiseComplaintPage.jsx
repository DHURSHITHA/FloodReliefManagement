import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { COMPLAINT_CATEGORIES, COMPLAINT_PRIORITIES } from '@frp/shared';
import { useRaiseComplaint, useMyComplaints } from '../../api/complaints.js';
import { useCamps } from '../../api/camps.js';
import { useMyRegistration } from '../../api/registration.js';
import { toFormErrors } from '../../api/client.js';
import { ComplaintCard } from './ComplaintCard.jsx';

const CATEGORY_LABELS = {
  food: 'Food', water: 'Drinking water', sanitation: 'Sanitation', medical: 'Medical',
  shelter: 'Shelter', safety: 'Safety', volunteer: 'Volunteering', other: 'Something else',
};

/**
 * Where an affected person raises a query and watches what happens to it.
 * Raising and tracking sit on one screen because the first question after
 * sending one is "what happened to the last one?".
 */
export function RaiseComplaintPage() {
  const { data: registration } = useMyRegistration();
  const { data: camps = [] } = useCamps();
  const { data: mine = [], isLoading } = useMyComplaints();
  const raise = useRaiseComplaint();

  // Default to the camp they registered at — almost always the one they mean.
  const [values, setValues] = useState({ camp_id: '', category: 'food', description: '', priority: 'normal' });
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);

  const campId = values.camp_id || registration?.beneficiary?.camp_id || '';
  const change = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSent(null);
    try {
      const created = await raise.mutateAsync({ ...values, camp_id: campId });
      setSent(`Sent as ${created.complaint_code}. The camp official has been notified.`);
      setValues((v) => ({ ...v, description: '' }));
    } catch (err) {
      setError(toFormErrors(err).message);
    }
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 4, alignItems: 'start' }}>
      <Card>
        <CardContent>
          <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 0.5 }}>
            Raise a query
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This goes straight to the officials running your camp.
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {sent && <Alert severity="success" sx={{ mb: 2 }}>{sent}</Alert>}

          <Box component="form" onSubmit={onSubmit} noValidate>
            <TextField select label="Camp" value={campId} onChange={change('camp_id')}>
              {camps.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>

            <TextField select label="What is this about?" value={values.category} onChange={change('category')}>
              {COMPLAINT_CATEGORIES.map((c) => (
                <MenuItem key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</MenuItem>
              ))}
            </TextField>

            <TextField select label="How urgent?" value={values.priority} onChange={change('priority')}>
              {COMPLAINT_PRIORITIES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </TextField>

            <TextField
              label="Describe the problem"
              value={values.description}
              onChange={change('description')}
              placeholder="What is wrong, and since when?"
              multiline
              minRows={4}
            />

            <Button
              type="submit" variant="contained" fullWidth sx={{ mt: 2 }}
              disabled={raise.isPending || !campId || values.description.trim().length < 10}
            >
              {raise.isPending ? 'Sending…' : 'Send to the camp official'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Box>
        <Typography sx={{ fontWeight: 600, mb: 1.5 }}>Your queries</Typography>
        <Stack spacing={1.5}>
          {mine.map((c) => <ComplaintCard key={c.id} complaint={c} />)}
          {!isLoading && mine.length === 0 && (
            <Typography color="text.secondary" variant="body2">
              You have not raised anything yet.
            </Typography>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
