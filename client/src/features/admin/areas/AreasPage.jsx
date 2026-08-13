import { useMemo, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { createAreaSchema } from '@frp/shared';
import { useAreas, useCreateArea } from '../../../api/areas.js';
import { StatusBadge } from '../../../components/StatusBadge.jsx';
import { toFormErrors } from '../../../api/client.js';

// Four distinct colors so high and critical read differently at a glance —
// the badge tones (pale bg + dark text, legible in a list) and the map dot
// colors (bold fills, visible against map tiles) both express the same
// green/yellow/orange/red scale, just tuned for their own surface.
const SEVERITY_TONE = { low: 'ok', medium: 'gold', high: 'brand', critical: 'bad' };
const SEVERITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const SEVERITY_DOT = { low: '#2E9E5B', medium: '#F0C419', high: '#FF6B00', critical: '#D7263D' };

// Geographic center of India — the map's fallback view when there are no
// areas yet to derive a center from.
const INDIA_CENTER = [22.9734, 78.6569];

const MAP_FILTERS = [
  { key: 'all', label: 'All areas' },
  { key: 'has_camp', label: 'Camp created' },
  { key: 'no_camp', label: 'No camp yet' },
];

export function AreasPage() {
  const { data: areas = [], isLoading } = useAreas();
  const createArea = useCreateArea();
  const [values, setValues] = useState({
    name: '', district: '', state: '', address: '', latitude: '', longitude: '', severity: 'medium',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [mapFilter, setMapFilter] = useState('all');

  const mappedAreas = useMemo(
    () => areas.filter((a) => (mapFilter === 'has_camp' ? a.has_camp : mapFilter === 'no_camp' ? !a.has_camp : true)),
    [areas, mapFilter]
  );
  const mapCenter = useMemo(() => {
    if (areas.length === 0) return INDIA_CENTER;
    const lat = areas.reduce((s, a) => s + a.latitude, 0) / areas.length;
    const lng = areas.reduce((s, a) => s + a.longitude, 0) / areas.length;
    return [lat, lng];
  }, [areas]);

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
    <>
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

    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 600 }}>Areas map</Typography>
          <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
            {MAP_FILTERS.map((f) => (
              <Button
                key={f.key}
                size="small"
                variant={mapFilter === f.key ? 'contained' : 'outlined'}
                onClick={() => setMapFilter(f.key)}
              >
                {f.label}
              </Button>
            ))}
          </Stack>
        </Box>

        <Box sx={{ height: 420, borderRadius: '10px', overflow: 'hidden' }}>
          <MapContainer center={mapCenter} zoom={areas.length ? 7 : 5} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {mappedAreas.map((area) => (
              <CircleMarker
                key={area.id}
                center={[area.latitude, area.longitude]}
                radius={9}
                pathOptions={{ color: '#fff', weight: 2, fillColor: SEVERITY_DOT[area.severity], fillOpacity: 0.9 }}
              >
                <Popup>
                  <strong>{area.name}</strong><br />
                  {area.district}, {area.state}<br />
                  Severity: {SEVERITY_LABEL[area.severity]}<br />
                  Camp: {area.has_camp ? 'Yes' : 'No'}
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </Box>

        <Stack direction="row" spacing={2} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
          {Object.entries(SEVERITY_DOT).map(([sev, color]) => (
            <Box key={sev} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
              <Typography variant="body2" color="text.secondary">{SEVERITY_LABEL[sev]}</Typography>
            </Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
    </>
  );
}
