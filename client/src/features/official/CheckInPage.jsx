import { useState } from 'react';
import { Box, Button, Card, CardContent, TextField, Typography } from '@mui/material';
import { useSearchRegistrations, useCheckInMember } from '../../api/registration.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';

export function CheckInPage() {
  const [search, setSearch] = useState('');
  const { data: registrations = [] } = useSearchRegistrations(search);
  const checkIn = useCheckInMember();

  return (
    <Box>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 2 }}>
        Find a registration
      </Typography>
      <TextField
        label="Search by code, name, or mobile"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mb: 3, minWidth: 320 }}
      />

      {registrations.map(({ beneficiary, members }) => (
        <Card key={beneficiary.id} sx={{ mb: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <Typography sx={{ fontWeight: 600 }}>{beneficiary.beneficiary_code}</Typography>
              <StatusBadge tone={beneficiary.status === 'active' ? 'ok' : 'warn'}>{beneficiary.status}</StatusBadge>
            </Box>
            {members.map((m) => (
              <Box key={m.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1, borderTop: '1px solid #F0E7DE' }}>
                <Typography>{m.name}</Typography>
                {m.checkin_status === 'checked_in' ? (
                  <StatusBadge tone="ok">Checked in</StatusBadge>
                ) : (
                  <Button
                    size="small" variant="outlined"
                    onClick={() => checkIn.mutate({ beneficiaryId: beneficiary.id, memberId: m.id })}
                    disabled={checkIn.isPending}
                  >
                    Check in
                  </Button>
                )}
              </Box>
            ))}
          </CardContent>
        </Card>
      ))}
      {search && registrations.length === 0 && (
        <Typography color="text.secondary">No registration matches "{search}".</Typography>
      )}
    </Box>
  );
}
