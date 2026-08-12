import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Checkbox, FormControlLabel, Link, Typography } from '@mui/material';
import { loginSchema } from '@frp/shared';
import { useLogin } from '../../api/auth.js';
import { toFormErrors } from '../../api/client.js';
import { AuthSplitLayout } from './AuthSplitLayout.jsx';
import { AuthTabs } from './AuthTabs.jsx';
import { AuthTextField } from './AuthTextField.jsx';

export const HOME_BY_ROLE = {
  admin: '/admin',
  camp_official: '/official',
  affected_person: '/',
  donor: '/donor',
};

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const [values, setValues] = useState({ identifier: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);

  const change = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setFormError(null);

    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
      return;
    }
    setFieldErrors({});

    try {
      const data = await login.mutateAsync(parsed.data);
      navigate(HOME_BY_ROLE[data.user.role] ?? '/', { replace: true });
    } catch (err) {
      // Values stay in state, so nothing the user typed is lost (§13).
      const { message, fields } = toFormErrors(err);
      setFormError(message);
      setFieldErrors(fields);
    }
  }

  return (
    <AuthSplitLayout>
      <AuthTabs active="login" />

      <Typography sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, fontSize: 27, lineHeight: 1.25 }}>
        Sign in to continue
      </Typography>
      <Typography sx={{ mt: 1, mb: 3.25, fontSize: 14, lineHeight: 1.6, color: '#6B6B6B' }}>
        Use the mobile number or email you registered with.
      </Typography>

      {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}

      <Box component="form" onSubmit={onSubmit} noValidate>
        <AuthTextField
          label="Mobile number or email"
          placeholder="10-digit mobile or email address"
          value={values.identifier}
          onChange={change('identifier')}
          error={fieldErrors.identifier}
          autoComplete="username"
          autoFocus
        />
        <AuthTextField
          label="Password"
          type="password"
          placeholder="Minimum 8 characters"
          value={values.password}
          onChange={change('password')}
          error={fieldErrors.password}
          autoComplete="current-password"
        />

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.75 }}>
          <FormControlLabel
            control={<Checkbox size="small" sx={{ color: '#FF6B00', '&.Mui-checked': { color: '#FF6B00' } }} />}
            label="Keep me signed in"
            sx={{ '& .MuiFormControlLabel-label': { fontSize: 13, color: '#5C5C5C' } }}
          />
          <Link href="#" underline="hover" sx={{ fontSize: 13, fontWeight: 500, color: '#C44E00' }}>
            Forgot password?
          </Link>
        </Box>

        <Button type="submit" variant="contained" color="primary" fullWidth disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>

        <Typography sx={{ mt: 2, fontSize: 12.5, lineHeight: 1.6, color: '#8A8A8A', textAlign: 'center' }}>
          Protected by role-based access. All administrative and financial actions are
          recorded in the audit log.
        </Typography>
      </Box>
    </AuthSplitLayout>
  );
}
