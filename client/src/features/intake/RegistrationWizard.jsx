import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, FormControlLabel, MenuItem, TextField, Typography,
} from '@mui/material';
import { createRegistrationSchema } from '@frp/shared';
import { useSubmitRegistration } from '../../api/registration.js';
import { toFormErrors } from '../../api/client.js';

const emptyApplicant = () => ({
  name: '', age: '', gender: '', aadhaar: '', mobile: '', address: '',
  is_pregnant: false, has_disability: false, wants_to_volunteer: false,
});
const emptyMember = () => ({
  name: '', age: '', gender: '', aadhaar: '', relation_to_applicant: '',
  is_pregnant: false, has_disability: false, wants_to_volunteer: false,
});

export function RegistrationWizard() {
  const { campId } = useParams();
  const navigate = useNavigate();
  const submit = useSubmitRegistration();
  const draftKey = `frp-registration-draft-${campId}`;
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const [members, setMembers] = useState(() => {
    const saved = sessionStorage.getItem(draftKey);
    return saved ? JSON.parse(saved) : [emptyApplicant()];
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    sessionStorage.setItem(draftKey, JSON.stringify(members));
  }, [members, draftKey]);

  const changeMember = (i, field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setMembers((prev) => prev.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)));
  };
  const addMember = () => setMembers((prev) => [...prev, emptyMember()]);
  const removeMember = (i) => setMembers((prev) => prev.filter((_, idx) => idx !== i));

  async function onSubmit(e) {
    e.preventDefault();
    setFormError(null);
    const parsed = createRegistrationSchema.safeParse({ camp_id: campId, members });
    if (!parsed.success) {
      const errors = {};
      for (const issue of parsed.error.issues) errors[issue.path.join('.')] = issue.message;
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    try {
      const result = await submit.mutateAsync({ payload: parsed.data, idempotencyKey });
      sessionStorage.removeItem(draftKey);
      setSuccess(result.beneficiary);
    } catch (err) {
      const { message, fields } = toFormErrors(err);
      setFormError(message);
      setFieldErrors(fields);
    }
  }

  if (success) {
    return (
      <Card sx={{ maxWidth: 480 }}>
        <CardContent>
          <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 1 }}>
            Registration complete
          </Typography>
          <Typography sx={{ mb: 2 }}>
            Your family's Beneficiary ID is <strong>{success.beneficiary_code}</strong>. Keep this code — camp
            staff will ask for it at check-in.
          </Typography>
          <Button variant="contained" onClick={() => navigate('/')}>Back to camps</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Box component="form" onSubmit={onSubmit} noValidate sx={{ maxWidth: 720 }}>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 2 }}>
        Register for this camp
      </Typography>
      {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}

      {members.map((m, i) => (
        <Card key={i} sx={{ mb: 2 }}>
          <CardContent>
            <Typography sx={{ fontWeight: 600, mb: 2 }}>
              {i === 0 ? 'Applicant (you)' : `Family member ${i + 1}`}
            </Typography>
            <TextField label="Full name" value={m.name} onChange={changeMember(i, 'name')}
              error={Boolean(fieldErrors[`members.${i}.name`])} helperText={fieldErrors[`members.${i}.name`]} />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField label="Age" value={m.age} onChange={changeMember(i, 'age')}
                error={Boolean(fieldErrors[`members.${i}.age`])} helperText={fieldErrors[`members.${i}.age`]} />
              <TextField select label="Gender" value={m.gender} onChange={changeMember(i, 'gender')}
                error={Boolean(fieldErrors[`members.${i}.gender`])} helperText={fieldErrors[`members.${i}.gender`]}>
                <MenuItem value="male">Male</MenuItem>
                <MenuItem value="female">Female</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </TextField>
            </Box>
            <TextField label="Aadhaar number" value={m.aadhaar} onChange={changeMember(i, 'aadhaar')}
              error={Boolean(fieldErrors[`members.${i}.aadhaar`])} helperText={fieldErrors[`members.${i}.aadhaar`]} />
            {i === 0 ? (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                <TextField label="Mobile number" value={m.mobile} onChange={changeMember(i, 'mobile')}
                  error={Boolean(fieldErrors[`members.${i}.mobile`])} helperText={fieldErrors[`members.${i}.mobile`]} />
                <TextField label="Address" value={m.address} onChange={changeMember(i, 'address')}
                  error={Boolean(fieldErrors[`members.${i}.address`])} helperText={fieldErrors[`members.${i}.address`]} />
              </Box>
            ) : (
              <TextField label="Relation to applicant" value={m.relation_to_applicant} onChange={changeMember(i, 'relation_to_applicant')}
                error={Boolean(fieldErrors[`members.${i}.relation_to_applicant`])} helperText={fieldErrors[`members.${i}.relation_to_applicant`]} />
            )}
            <FormControlLabel control={<Checkbox checked={m.is_pregnant} onChange={changeMember(i, 'is_pregnant')} />} label="Pregnant" />
            <FormControlLabel control={<Checkbox checked={m.has_disability} onChange={changeMember(i, 'has_disability')} />} label="Has a disability" />
            <FormControlLabel control={<Checkbox checked={m.wants_to_volunteer} onChange={changeMember(i, 'wants_to_volunteer')} />} label="Wants to volunteer" />
            {i > 0 && (
              <Box sx={{ mt: 1 }}>
                <Button size="small" color="error" onClick={() => removeMember(i)}>Remove this person</Button>
              </Box>
            )}
          </CardContent>
        </Card>
      ))}

      <Button onClick={addMember} sx={{ mb: 2 }}>+ Add family member</Button>
      <Box>
        <Button type="submit" variant="contained" size="large" disabled={submit.isPending}>
          {submit.isPending ? 'Submitting…' : 'Submit registration'}
        </Button>
      </Box>
    </Box>
  );
}
