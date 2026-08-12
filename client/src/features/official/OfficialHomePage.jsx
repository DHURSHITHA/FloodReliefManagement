import { Box, Card, CardContent, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

const DESTINATIONS = [
  { to: '/official/checkin', title: 'Check-in', blurb: 'Find a family by code, name, or mobile and verify arrivals one person at a time.' },
  { to: '/official/distribute', title: 'Distribute supplies', blurb: 'Record a distribution against a Beneficiary ID. Same-day repeats are blocked automatically.' },
  { to: '/official/distributions', title: 'Distribution history', blurb: 'Everything handed out, with overrides clearly marked.' },
  { to: '/official/volunteers', title: 'Volunteer duties', blurb: 'Assign tasks and shifts, and log hours when a duty is finished.' },
];

export function OfficialHomePage() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>
          Camp official
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Everything you can do from here.
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 2 }}>
        {DESTINATIONS.map((d) => (
          <Card
            key={d.to} component={RouterLink} to={d.to}
            sx={{ textDecoration: 'none', display: 'block', '&:hover': { borderColor: 'primary.main' } }}
          >
            <CardContent>
              <Typography sx={{ fontWeight: 600, mb: 0.5 }}>{d.title}</Typography>
              <Typography variant="body2" color="text.secondary">{d.blurb}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>
    </Box>
  );
}
