import { Box, ButtonBase } from '@mui/material';
import { useNavigate } from 'react-router-dom';

/** The Login / Sign up pill toggle from the design. Navigates between /login and /signup. */
export function AuthTabs({ active }) {
  const navigate = useNavigate();
  const tabs = [
    { key: 'login', label: 'Login', to: '/login' },
    { key: 'signup', label: 'Sign up', to: '/signup' },
  ];
  return (
    <Box sx={{ display: 'flex', gap: 0.5, p: 0.5, bgcolor: '#FFF0E4', borderRadius: '11px', mb: 3.25 }}>
      {tabs.map((t) => (
        <ButtonBase
          key={t.key}
          onClick={() => navigate(t.to)}
          sx={{
            flex: 1, height: 38, borderRadius: '8px', fontWeight: 600, fontSize: 13.5,
            bgcolor: active === t.key ? '#fff' : 'transparent',
            color: active === t.key ? '#C44E00' : '#8A6B52',
          }}
        >
          {t.label}
        </ButtonBase>
      ))}
    </Box>
  );
}
