import { Box, Button, Container, Typography } from '@mui/material';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../AuthProvider.jsx';
import { NotificationBell } from '../components/NotificationBell.jsx';

const ROLE_LABEL = {
  admin: 'Administrator',
  camp_official: 'Camp Official',
  affected_person: 'Affected Person',
  donor: 'Donor',
};

// Only roles with more than one destination get a nav bar — a donor still has
// a single screen, so links would be noise there.
const NAV_BY_ROLE = {
  affected_person: [
    { to: '/', label: 'Camps', end: true },
    { to: '/queries', label: 'My queries' },
    { to: '/sos', label: 'Report emergency' },
  ],
  admin: [
    { to: '/admin', label: 'Dashboard', end: true },
    { to: '/admin/areas', label: 'Areas' },
    { to: '/admin/camps', label: 'Camps' },
    { to: '/admin/officials', label: 'Officials' },
    { to: '/admin/resources', label: 'Resources' },
    { to: '/admin/inventory', label: 'Inventory' },
    { to: '/admin/distribution-rules', label: 'Rules' },
    { to: '/official/distribute', label: 'Distribute' },
    { to: '/official/queries', label: 'Queries' },
    { to: '/official/sos', label: 'Emergency' },
  ],
  camp_official: [
    { to: '/official', label: 'Home', end: true },
    { to: '/official/checkin', label: 'Check-in' },
    { to: '/official/distribute', label: 'Distribute' },
    { to: '/official/distributions', label: 'History' },
    { to: '/official/volunteers', label: 'Volunteers' },
    { to: '/official/queries', label: 'Queries' },
    { to: '/official/sos', label: 'Emergency' },
  ],
};

function NavBar({ items }) {
  return (
    <Box
      sx={{
        display: 'flex', gap: 0.5, px: 4, flexWrap: 'wrap',
        borderBottom: '1px solid #EFE6DC', bgcolor: '#FFFBF7',
      }}
    >
      {items.map((item) => (
        <Box
          key={item.to}
          component={NavLink}
          to={item.to}
          end={item.end}
          sx={{
            py: 1.25, px: 1.5, fontSize: 13.5, fontWeight: 600, textDecoration: 'none',
            color: '#6B6B6B', borderBottom: '2px solid transparent',
            '&.active': { color: '#C44E00', borderBottomColor: '#FF6B00' },
            '&:hover': { color: '#2B2B2B' },
          }}
        >
          {item.label}
        </Box>
      ))}
    </Box>
  );
}

function initialsOf(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
}

export function RoleLayout() {
  const { user, logout } = useAuth();
  const nav = NAV_BY_ROLE[user?.role];
  const showBell = user?.role === 'admin' || user?.role === 'camp_official';
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
          {showBell && <NotificationBell />}
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
      {nav && <NavBar items={nav} />}
      <Container sx={{ py: 3 }}><Outlet /></Container>
    </Box>
  );
}
