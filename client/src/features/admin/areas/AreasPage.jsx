import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { createAreaSchema } from '@frp/shared';
import { useAreas, useCreateArea } from '../../../api/areas.js';
import { StatusBadge } from '../../../components/StatusBadge.jsx';
import { toFormErrors } from '../../../api/client.js';

const SEVERITY_TONE = { low: 'ok', medium: 'warn', high: 'bad', critical: 'bad' };
const SEVERITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

export function AreasPage() {
  const { data: areas = [], isLoading } = useAreas();
  const createArea = useCreateArea();
  const [values, setValues] = useState({
    name: '', district: '', state: '', address: '', latitude: '', longitude: '', severity: 'medium',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);

  const change = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setFormError(null);
    const parsed = createAreaSchema.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
      return;
    }
    setFieldErrors({});
    try {
      await createArea.mutateAsync(parsed.data);
      setValues({ name: '', district: '', state: '', address: '', latitude: '', longitude: '', severity: 'medium' });
    } catch (err) {
      const { message, fields } = toFormErrors(err);
      setFormError(message);
      setFieldErrors(fields);
    }
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.3fr 1fr' }, gap: 3 }}>
      <Box>
        <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 2 }}>
          Flood-affected areas
        </Typography>
        <Stack spacing={1.5}>
          {areas.map((area) => (
            <Card key={area.id}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                <Box>
                  <Typography sx={{ fontWeight: 600 }}>{area.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{area.district}, {area.state}</Typography>
                </Box>
                <StatusBadge tone={SEVERITY_TONE[area.severity]}>{SEVERITY_LABEL[area.severity]}</StatusBadge>
              </CardContent>
            </Card>
          ))}
          {!isLoading && areas.length === 0 && (
            <Typography color="text.secondary">No affected areas recorded yet.</Typography>
          )}
        </Stack>
      </Box>

      <Card>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 2 }}>Record affected area</Typography>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <Box component="form" onSubmit={onSubmit} noValidate>
            <TextField label="Area name" value={values.name} onChange={change('name')}
              error={Boolean(fieldErrors.name)} helperText={fieldErrors.name} />
            <TextField label="District" value={values.district} onChange={change('district')}
              error={Boolean(fieldErrors.district)} helperText={fieldErrors.district} />
            <TextField label="State" value={values.state} onChange={change('state')}
              error={Boolean(fieldErrors.state)} helperText={fieldErrors.state} />
            <TextField label="Address / location description" value={values.address} onChange={change('address')}
              error={Boolean(fieldErrors.address)} helperText={fieldErrors.address} />
            <Stack direction="row" spacing={2}>
              <TextField label="Latitude" value={values.latitude} onChange={change('latitude')}
                error={Boolean(fieldErrors.latitude)} helperText={fieldErrors.latitude} />
              <TextField label="Longitude" value={values.longitude} onChange={change('longitude')}
                error={Boolean(fieldErrors.longitude)} helperText={fieldErrors.longitude} />
            </Stack>
            <TextField select label="Severity" value={values.severity} onChange={change('severity')}>
              <MenuItem value="low">Low</MenuItem>
              <MenuItem value="medium">Medium</MenuItem>
              <MenuItem value="high">High</MenuItem>
              <MenuItem value="critical">Critical</MenuItem>
            </TextField>
            <Button type="submit" variant="contained" fullWidth disabled={createArea.isPending} sx={{ mt: 2 }}>
              {createArea.isPending ? 'Recording…' : 'Record area'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
