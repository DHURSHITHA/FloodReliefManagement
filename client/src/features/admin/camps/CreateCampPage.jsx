import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material';
import { createCampSchema } from '@frp/shared';
import { useCreateCamp } from '../../../api/camps.js';
import { useAreas } from '../../../api/areas.js';
import { toFormErrors } from '../../../api/client.js';

const FACILITY_FIELDS = [
  ['food', 'Food'], ['drinking_water', 'Drinking water'], ['medical_support', 'Medical support'],
  ['electricity', 'Electricity'], ['accommodation', 'Accommodation'], ['charging_points', 'Charging points'],
  ['internet', 'Internet'], ['child_care', 'Child care'], ['womens_facilities', "Women's facilities"],
  ['disability_friendly', 'Disability-friendly'],
];

const twoCol = { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 };

const initialValues = {
  name: '', camp_type: 'community_hall', description: '',
  linked_area_id: '',
  address: '', area: '', district: '', state: '', pincode: '', latitude: '', longitude: '',
  flood_severity: 'medium',
  beneficiary_capacity: '', volunteer_capacity: '', duration_days: '',
  facilities: {
    food: false, drinking_water: false, medical_support: false, toilets_count: '0',
    electricity: false, accommodation: false, charging_points: false, internet: false,
    child_care: false, womens_facilities: false, disability_friendly: false,
  },
  nearest_hospital_name: '', nearest_hospital_contact: '',
  nearest_police_name: '', nearest_police_contact: '',
};

export function CreateCampPage() {
  const navigate = useNavigate();
  const createCamp = useCreateCamp();
  const { data: areas = [] } = useAreas();
  const [values, setValues] = useState(initialValues);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);

  const change = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }));
  const toggleFacility = (f) => (e) =>
    setValues((v) => ({ ...v, facilities: { ...v.facilities, [f]: e.target.checked } }));

  /**
   * Picking an existing area pre-fills the location fields from it — still
   * editable afterward, since a camp's exact pin may differ slightly from
   * the area's identified point. Choosing the blank option clears the
   * link; the camp will get a brand-new area auto-created from whatever
   * location fields are entered manually (camps.service.js's resolveLinkedArea).
   */
  const changeLinkedArea = (e) => {
    const areaId = e.target.value;
    const area = areas.find((a) => a.id === areaId);
    setValues((v) => ({
      ...v,
      linked_area_id: areaId,
      ...(area
        ? { area: area.name, district: area.district, state: area.state, latitude: String(area.latitude), longitude: String(area.longitude), flood_severity: area.severity }
        : {}),
    }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    setFormError(null);
    const parsed = createCampSchema.safeParse({ ...values, linked_area_id: values.linked_area_id || undefined });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setFieldErrors({});
    try {
      await createCamp.mutateAsync(parsed.data);
      navigate('/admin/camps');
    } catch (err) {
      const { message, fields } = toFormErrors(err);
      setFormError(message);
      setFieldErrors(fields);
    }
  }

  return (
    <Box component="form" onSubmit={onSubmit} noValidate sx={{ maxWidth: 860 }}>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 3 }}>
        Create a relief camp
      </Typography>
      {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 2 }}>Identity</Typography>
          <TextField label="Camp name" value={values.name} onChange={change('name')}
            error={Boolean(fieldErrors.name)} helperText={fieldErrors.name} />
          <TextField select label="Camp type" value={values.camp_type} onChange={change('camp_type')}>
            <MenuItem value="school">School</MenuItem>
            <MenuItem value="auditorium">Auditorium</MenuItem>
            <MenuItem value="community_hall">Community Hall</MenuItem>
            <MenuItem value="other">Other</MenuItem>
          </TextField>
          <TextField label="Description" value={values.description} onChange={change('description')} multiline minRows={2} />
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 2 }}>Location &amp; flood context</Typography>
          <TextField select label="Link to an existing affected area (optional)" value={values.linked_area_id} onChange={changeLinkedArea}>
            <MenuItem value="">— Create a new area from this camp's details —</MenuItem>
            {areas.map((a) => (
              <MenuItem key={a.id} value={a.id}>{a.name} ({a.district}, {a.state})</MenuItem>
            ))}
          </TextField>
          <TextField label="Address" value={values.address} onChange={change('address')}
            error={Boolean(fieldErrors.address)} helperText={fieldErrors.address} />
          <Box sx={twoCol}>
            <TextField label="Area" value={values.area} onChange={change('area')}
              error={Boolean(fieldErrors.area)} helperText={fieldErrors.area} />
            <TextField label="District" value={values.district} onChange={change('district')}
              error={Boolean(fieldErrors.district)} helperText={fieldErrors.district} />
            <TextField label="State" value={values.state} onChange={change('state')}
              error={Boolean(fieldErrors.state)} helperText={fieldErrors.state} />
            <TextField label="Pincode" value={values.pincode} onChange={change('pincode')}
              error={Boolean(fieldErrors.pincode)} helperText={fieldErrors.pincode} />
            <TextField label="Latitude" value={values.latitude} onChange={change('latitude')}
              error={Boolean(fieldErrors.latitude)} helperText={fieldErrors.latitude} />
            <TextField label="Longitude" value={values.longitude} onChange={change('longitude')}
              error={Boolean(fieldErrors.longitude)} helperText={fieldErrors.longitude} />
          </Box>
          <TextField select label="Flood severity" value={values.flood_severity} onChange={change('flood_severity')}>
            <MenuItem value="low">Low</MenuItem>
            <MenuItem value="medium">Medium</MenuItem>
            <MenuItem value="high">High</MenuItem>
            <MenuItem value="critical">Critical</MenuItem>
          </TextField>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 2 }}>Capacity &amp; duration</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2 }}>
            <TextField label="Beneficiary capacity" value={values.beneficiary_capacity} onChange={change('beneficiary_capacity')}
              error={Boolean(fieldErrors.beneficiary_capacity)} helperText={fieldErrors.beneficiary_capacity} />
            <TextField label="Volunteer capacity" value={values.volunteer_capacity} onChange={change('volunteer_capacity')}
              error={Boolean(fieldErrors.volunteer_capacity)} helperText={fieldErrors.volunteer_capacity} />
            <TextField label="Duration (days)" value={values.duration_days} onChange={change('duration_days')}
              error={Boolean(fieldErrors.duration_days)} helperText={fieldErrors.duration_days} />
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 1 }}>Facilities</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr' }, gap: 0.5 }}>
            {FACILITY_FIELDS.map(([key, label]) => (
              <FormControlLabel
                key={key}
                control={<Checkbox checked={values.facilities[key]} onChange={toggleFacility(key)} />}
                label={label}
              />
            ))}
          </Box>
          <TextField
            label="Toilets (count)" value={values.facilities.toilets_count} sx={{ maxWidth: 200 }}
            onChange={(e) => setValues((v) => ({ ...v, facilities: { ...v.facilities, toilets_count: e.target.value } }))}
          />
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 2 }}>Emergency contacts</Typography>
          <Box sx={twoCol}>
            <TextField label="Nearest hospital name" value={values.nearest_hospital_name} onChange={change('nearest_hospital_name')}
              error={Boolean(fieldErrors.nearest_hospital_name)} helperText={fieldErrors.nearest_hospital_name} />
            <TextField label="Nearest hospital contact" value={values.nearest_hospital_contact} onChange={change('nearest_hospital_contact')}
              error={Boolean(fieldErrors.nearest_hospital_contact)} helperText={fieldErrors.nearest_hospital_contact} />
            <TextField label="Nearest police station" value={values.nearest_police_name} onChange={change('nearest_police_name')}
              error={Boolean(fieldErrors.nearest_police_name)} helperText={fieldErrors.nearest_police_name} />
            <TextField label="Nearest police contact" value={values.nearest_police_contact} onChange={change('nearest_police_contact')}
              error={Boolean(fieldErrors.nearest_police_contact)} helperText={fieldErrors.nearest_police_contact} />
          </Box>
          <Alert severity="warning" sx={{ mt: 2 }}>
            Medical SOS routes to the hospital contact and security SOS to the police contact — both are required before the camp can open.
          </Alert>
        </CardContent>
      </Card>

      <Button type="submit" variant="contained" size="large" disabled={createCamp.isPending}>
        {createCamp.isPending ? 'Creating…' : 'Create & open camp'}
      </Button>
    </Box>
  );
}
