import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Chip, LinearProgress, MenuItem, TextField, Typography } from '@mui/material';
import { useCamps } from '../../api/camps.js';
import { useActiveAlerts } from '../../api/areas.js';
import { useLiveCampUpdates } from '../../api/socket.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';

const STATUS_TONE = { open: 'ok', nearly_full: 'warn', full: 'bad', temporarily_closed: 'neutral', closed: 'neutral' };
const STATUS_LABEL = {
  open: 'Open', nearly_full: 'Nearly Full', full: 'Full',
  temporarily_closed: 'Temporarily Closed', closed: 'Closed',
};

export function LandingPage() {
  useLiveCampUpdates();
  const navigate = useNavigate();
  const { data: camps = [] } = useCamps();
  const { data: alerts = [] } = useActiveAlerts();
  const [search, setSearch] = useState('');
  const [district, setDistrict] = useState('');

  const districts = useMemo(() => [...new Set(camps.map((c) => c.district))], [camps]);

  const visible = camps.filter((c) => {
    if (district && c.district !== district) return false;
    if (search && !`${c.name} ${c.area}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <Box>
      {alerts.length > 0 && (
        <Box
          sx={{
            display: 'flex', alignItems: 'flex-start', gap: 1.75, p: '16px 18px',
            bgcolor: '#FFF0E4', border: '1px solid #FFD9BC', borderLeft: '4px solid #C44E00',
            borderRadius: '12px', mb: 3.75,
          }}
        >
          <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: '#C44E00', mt: 0.75, flex: '0 0 9px' }} />
          <Box sx={{ flex: 1, minWidth: 220 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 14, color: '#C44E00' }}>
              Active flood alert · {alerts.length} area{alerts.length === 1 ? '' : 's'} under active warning
            </Typography>
            <Typography sx={{ fontSize: 13, color: '#5C5C5C', mt: 0.4 }}>
              {alerts[0].area_name}: {alerts[0].message}
              {alerts.length > 1 ? ` (+${alerts.length - 1} more)` : ''}
            </Typography>
          </Box>
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2.5 }}>
        <Box>
          <Typography variant="h4" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>
            Open relief camps near you
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Live occupancy and volunteer slots, updated as registrations are accepted.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <TextField size="small" placeholder="Search camp or area" value={search} onChange={(e) => setSearch(e.target.value)} />
          <TextField select size="small" label="District" value={district} onChange={(e) => setDistrict(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">All districts</MenuItem>
            {districts.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
          </TextField>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 2.25 }}>
        {visible.map((camp) => {
          const occPct = Math.min(100, Math.round((camp.beneficiaries_accepted / camp.beneficiary_capacity) * 100));
          const volPct = Math.min(100, Math.round((camp.volunteers_accepted / camp.volunteer_capacity) * 100));
          const volLeft = camp.volunteer_capacity - camp.volunteers_accepted;
          const isFull = ['full', 'closed', 'temporarily_closed'].includes(camp.status);
          return (
            <Box key={camp.id} sx={{ bgcolor: '#fff', border: '1px solid #F0E2D5', borderRadius: '14px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ p: '18px 18px 14px' }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 }}>
                  <Box>
                    <Typography sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, fontSize: 17 }}>{camp.name}</Typography>
                    <Typography sx={{ fontSize: 12.5, color: '#7A7A7A', mt: 0.5 }}>{camp.area} · {camp.district}</Typography>
                  </Box>
                  <StatusBadge tone={STATUS_TONE[camp.status]}>{STATUS_LABEL[camp.status]}</StatusBadge>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1.5 }}>
                  {Object.entries(camp.facilities || {})
                    .filter(([, v]) => v === true)
                    .slice(0, 4)
                    .map(([k]) => (
                      <Chip key={k} label={k.replace(/_/g, ' ')} size="small" sx={{ bgcolor: '#FAF6F2', border: '1px solid #F0E7DE' }} />
                    ))}
                </Box>
              </Box>
              <Box sx={{ p: '14px 18px', bgcolor: '#FFFBF7', borderTop: '1px solid #F5EAE0', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#5C5C5C', mb: 0.75 }}>
                    <span>Beneficiary occupancy</span>
                    <strong>{camp.beneficiaries_accepted} / {camp.beneficiary_capacity}</strong>
                  </Box>
                  <LinearProgress variant="determinate" value={occPct} sx={{ height: 7, borderRadius: 6, bgcolor: '#F2E4D7' }} />
                </Box>
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#5C5C5C', mb: 0.75 }}>
                    <span>Volunteer slots</span>
                    <strong>{volLeft} left of {camp.volunteer_capacity}</strong>
                  </Box>
                  <LinearProgress
                    variant="determinate" value={volPct}
                    sx={{ height: 7, borderRadius: 6, bgcolor: '#F2E4D7', '& .MuiLinearProgress-bar': { bgcolor: '#C44E00' } }}
                  />
                </Box>
              </Box>
              <Box sx={{ p: '14px 18px', borderTop: '1px solid #F5EAE0', mt: 'auto' }}>
                <Button fullWidth variant="contained" disabled={isFull} onClick={() => navigate(`/register/${camp.id}`)}>
                  {isFull ? 'Camp full' : 'Register for camp'}
                </Button>
              </Box>
            </Box>
          );
        })}
      </Box>
      {visible.length === 0 && (
        <Typography color="text.secondary" sx={{ mt: 4 }}>No camps match your search.</Typography>
      )}
    </Box>
  );
}
