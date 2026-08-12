import { Box, Button, Container, Typography } from '@mui/material';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../AuthProvider.jsx';

const ROLE_LABEL = {
  admin: 'Administrator',
  camp_official: 'Camp Official',
  affected_person: 'Affected Person',
  donor: 'Donor',
};

function initialsOf(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
}

export function RoleLayout() {
  const { user, logout } = useAuth();
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 2, px: 4, minHeight: 66,
          borderBottom: '1px solid #EFE6DC', bgcolor: '#fff', position: 'sticky', top: 0, zIndex: 50,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box
            sx={{
              width: 32, height: 32, borderRadius: '9px', bgcolor: '#FF6B00',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            🌊
          </Box>
          <Typography sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, fontSize: 15.5 }}>
            Flood Relief Portal
          </Typography>
        </Box>

        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.1, pl: 1.5, borderLeft: '1px solid #EFE6DC' }}>
            <Box
              sx={{
                width: 34, height: 34, borderRadius: '9px', bgcolor: '#FFF0E4', color: '#C44E00',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700,
              }}
            >
              {initialsOf(user?.name)}
            </Box>
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{user?.name}</Typography>
              <Typography sx={{ fontSize: 11.5, color: '#8A8A8A' }}>{ROLE_LABEL[user?.role] ?? ''}</Typography>
            </Box>
          </Box>
          <Button size="small" variant="outlined" onClick={logout}>Sign out</Button>
        </Box>
      </Box>
      <Container sx={{ py: 3 }}><Outlet /></Container>
    </Box>
  );
}
