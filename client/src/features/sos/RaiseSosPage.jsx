import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { SOS_CATEGORIES, SOS_URGENCY } from '@frp/shared';
import { useRaiseSos, useMySos } from '../../api/sos.js';
import { useCamps } from '../../api/camps.js';
import { useMyRegistration } from '../../api/registration.js';
import { toFormErrors } from '../../api/client.js';
import { SosCard } from './SosCard.jsx';

const CATEGORY_LABELS = {
  medical: 'Medical', security: 'Security', food_shortage: 'Food shortage',
  water_shortage: 'Water shortage', missing_person: 'Missing person', other: 'Other emergency',
};

/**
 * Where an affected person reports an emergency and watches what happens to
 * it. Raising and tracking share a screen for the same reason the query page
 * does: the first thing anyone wants to know after sending one is whether
 * someone is coming.
 */
export function RaiseSosPage() {
  const { data: registration } = useMyRegistration();
  const { data: camps = [] } = useCamps();
  const { data: mine = [], isLoading } = useMySos();
  const raise = useRaiseSos();

  const [values, setValues] = useState({ camp_id: '', category: 'medical', urgency: 'high', location: '', description: '' });
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
      setSent(`Sent as ${created.sos_code}, routed to ${created.routed_to_name} (${created.routed_to_contact}).`);
      setValues((v) => ({ ...v, location: '', description: '' }));
    } catch (err) {
      setError(toFormErrors(err).message);
    }
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 4, alignItems: 'start' }}>
      <Card>
        <CardContent>
          <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 0.5 }}>
            Report an emergency
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This reaches the camp's linked hospital or police contact immediately.
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {sent && <Alert severity="success" sx={{ mb: 2 }}>{sent}</Alert>}

          <Box component="form" onSubmit={onSubmit} noValidate>
            <TextField select label="Camp" value={campId} onChange={change('camp_id')}>
              {camps.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>

            <TextField select label="What kind of emergency?" value={values.category} onChange={change('category')}>
              {SOS_CATEGORIES.map((c) => (
                <MenuItem key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</MenuItem>
              ))}
            </TextField>

            <TextField select label="How urgent?" value={values.urgency} onChange={change('urgency')}>
              {SOS_URGENCY.map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
            </TextField>

            <TextField
              label="Where"
              value={values.location}
              onChange={change('location')}
              placeholder="e.g. block 4 tents, near the food line"
            />

            <TextField
              label="Describe the emergency"
              value={values.description}
              onChange={change('description')}
              placeholder="What is happening, and to whom?"
              multiline
              minRows={4}
            />

            <Button
              type="submit" variant="contained" color="error" fullWidth sx={{ mt: 2 }}
              disabled={
                raise.isPending || !campId
                || values.description.trim().length < 10
                || values.location.trim().length < 2
              }
            >
              {raise.isPending ? 'Sending…' : 'Send emergency alert'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Box>
        <Typography sx={{ fontWeight: 600, mb: 1.5 }}>Your reports</Typography>
        <Stack spacing={1.5}>
          {mine.map((s) => <SosCard key={s.id} sos={s} />)}
          {!isLoading && mine.length === 0 && (
            <Typography color="text.secondary" variant="body2">
              You have not reported an emergency.
            </Typography>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
