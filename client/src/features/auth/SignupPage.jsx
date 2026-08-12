import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Typography } from '@mui/material';
import { signupSchema } from '@frp/shared';
import { useSignup } from '../../api/auth.js';
import { toFormErrors } from '../../api/client.js';
import { AuthSplitLayout } from './AuthSplitLayout.jsx';
import { AuthTabs } from './AuthTabs.jsx';
import { AuthTextField } from './AuthTextField.jsx';

// Admin is deliberately not selectable here: admins are provisioned, not
// self-registered (requirements §4). It renders as a disabled card, exactly
// as in the approved design.
const ROLE_CARDS = [
  { value: 'affected_person', title: 'Affected Person', sub: 'Register for a camp' },
  { value: 'donor', title: 'Donor / NGO', sub: 'Funds or materials' },
  { value: 'camp_official', title: 'Camp Official', sub: 'Needs Admin approval' },
];

function RoleCard({ card, selected, onSelect }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onSelect}
      sx={{
        textAlign: 'left', p: '11px 13px', borderRadius: '10px', cursor: 'pointer',
        border: '1px solid', borderColor: selected ? '#FF6B00' : '#E4D9CE',
        bgcolor: selected ? '#FFF0E4' : '#fff', font: 'inherit',
      }}
    >
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#2B2B2B' }}>{card.title}</Typography>
      <Typography sx={{ fontSize: 11.5, color: '#7A7A7A', mt: 0.25 }}>{card.sub}</Typography>
    </Box>
  );
}

export function SignupPage() {
  const navigate = useNavigate();
  const signup = useSignup();
  const [values, setValues] = useState({
    name: '', mobile: '', email: '', password: '', role: 'affected_person',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [done, setDone] = useState(null);

  const change = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setFormError(null);

    const payload = { ...values, mobile: values.mobile || undefined, email: values.email || undefined };
    const parsed = signupSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
      return;
    }
    setFieldErrors({});

    try {
      const data = await signup.mutateAsync(parsed.data);
      setDone(data.user);
    } catch (err) {
      const { message, fields } = toFormErrors(err);
      setFormError(message);
      setFieldErrors(fields);
    }
  }

  if (done) {
    const pending = done.status === 'pending_approval';
    return (
      <AuthSplitLayout>
        <Alert severity={pending ? 'info' : 'success'}>
          {pending
            ? 'Account created. A camp official account must be approved by an administrator before you can sign in. You will be notified once it is approved.'
            : 'Account created. You can sign in now.'}
        </Alert>
        <Button sx={{ mt: 2 }} variant="contained" fullWidth onClick={() => navigate('/login')}>
          Go to sign in
        </Button>
      </AuthSplitLayout>
    );
  }

  return (
    <AuthSplitLayout>
      <AuthTabs active="signup" />

      <Typography sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, fontSize: 27, lineHeight: 1.25 }}>
        Create your account
      </Typography>
      <Typography sx={{ mt: 1, mb: 3.25, fontSize: 14, lineHeight: 1.6, color: '#6B6B6B' }}>
        One signup for every role. No OTP step — password only.
      </Typography>

      {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}

      <Box component="form" onSubmit={onSubmit} noValidate>
        <AuthTextField
          label="Full name"
          placeholder="As per your ID document"
          value={values.name}
          onChange={change('name')}
          error={fieldErrors.name}
          autoFocus
        />

        <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#5C5C5C', mb: 0.75, mt: 2 }}>
          I am signing up as
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.1 }}>
          {ROLE_CARDS.map((card) => (
            <RoleCard
              key={card.value}
              card={card}
              selected={values.role === card.value}
              onSelect={() => setValues((v) => ({ ...v, role: card.value }))}
            />
          ))}
          <Box sx={{ p: '11px 13px', borderRadius: '10px', border: '1px dashed #E4D9CE', bgcolor: '#FAFAFA' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#9A9A9A' }}>Admin</Typography>
            <Typography sx={{ fontSize: 11.5, color: '#ABABAB', mt: 0.25 }}>Provisioned only</Typography>
          </Box>
        </Box>
        {fieldErrors.role && (
          <Typography sx={{ fontSize: 12, color: 'error.main', mt: 0.75 }}>{fieldErrors.role}</Typography>
        )}

        <AuthTextField
          label="Mobile number or email"
          placeholder="10-digit mobile or email address"
          value={values.mobile}
          onChange={change('mobile')}
          error={fieldErrors.mobile}
          helperText="Email is optional if a mobile number is given."
          sx={{ mt: 2 }}
        />
        <AuthTextField
          label="Email (optional)"
          type="email"
          value={values.email}
          onChange={change('email')}
          error={fieldErrors.email}
        />
        <AuthTextField
          label="Password"
          type="password"
          placeholder="Minimum 8 characters"
          value={values.password}
          onChange={change('password')}
          error={fieldErrors.password}
          helperText={fieldErrors.password ?? 'At least 12 characters. A memorable phrase works well.'}
          autoComplete="new-password"
        />

        <Button type="submit" variant="contained" color="primary" fullWidth disabled={signup.isPending} sx={{ mt: 1 }}>
          {signup.isPending ? 'Creating account…' : 'Create account'}
        </Button>

        <Typography sx={{ mt: 2, fontSize: 12.5, lineHeight: 1.6, color: '#8A8A8A', textAlign: 'center' }}>
          Protected by role-based access. All administrative and financial actions are
          recorded in the audit log.
        </Typography>
      </Box>
    </AuthSplitLayout>
  );
}
