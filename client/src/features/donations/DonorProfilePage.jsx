import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, MenuItem, TextField, Typography } from '@mui/material';
import { DONOR_TYPES } from '@frp/shared';
import { useMyDonorProfile, useSaveDonorProfile } from '../../api/donations.js';
import { toFormErrors } from '../../api/client.js';

const EMPTY = { donor_type: 'individual', name: '', contact_person: '', mobile: '', email: '', address: '', registration_details: '' };

const TYPE_LABELS = { individual: 'Individual', ngo: 'NGO / Organization' };

/**
 * §6.12: the profile a donor account fills in once, on top of the common
 * auth flow. Donating is blocked until this exists (donations.service.js's
 * resolveDonor requires it), so this is the first screen a new donor sees.
 */
export function DonorProfilePage() {
  const { data: donor, isLoading } = useMyDonorProfile();
  const save = useSaveDonorProfile();
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (donor) setValues({ ...EMPTY, ...donor });
  }, [donor]);

  const isNgo = values.donor_type === 'ngo';
  const change = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await save.mutateAsync(values);
      setSaved(true);
    } catch (err) {
      setError(toFormErrors(err).message);
    }
  }

  if (isLoading) return <Typography color="text.secondary">Loading…</Typography>;

  return (
    <Card sx={{ maxWidth: 560 }}>
      <CardContent>
        <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 0.5 }}>
          Your donor profile
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Needed once before you can record a donation.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {saved && <Alert severity="success" sx={{ mb: 2 }}>Profile saved.</Alert>}

        <Box component="form" onSubmit={onSubmit} noValidate>
          <TextField select label="Donor type" value={values.donor_type} onChange={change('donor_type')}>
            {DONOR_TYPES.map((t) => <MenuItem key={t} value={t}>{TYPE_LABELS[t] ?? t}</MenuItem>)}
          </TextField>

          <TextField label="Name" value={values.name} onChange={change('name')} />

          {isNgo && (
            <TextField label="Contact person" value={values.contact_person} onChange={change('contact_person')} />
          )}

          <TextField label="Mobile" value={values.mobile} onChange={change('mobile')} placeholder="10-digit mobile number" />
          <TextField label="Email" value={values.email} onChange={change('email')} />
          <TextField label="Address" value={values.address} onChange={change('address')} multiline minRows={2} />

          {isNgo && (
            <TextField
              label="Registration details" value={values.registration_details} onChange={change('registration_details')}
              placeholder="Registration number, issuing authority"
            />
          )}

          <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save profile'}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
