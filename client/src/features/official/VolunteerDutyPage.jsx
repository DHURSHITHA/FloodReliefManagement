import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, TextField, Typography } from '@mui/material';
import { useActiveVolunteers, useAssignVolunteerDuty, useCompleteVolunteerDuty } from '../../api/volunteers.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';

/**
 * Assignment and the duty roster are one screen, not two: the same person
 * doing the assigning is the one watching who is currently on shift, and
 * splitting them would mean navigating back and forth to do one job.
 */
export function VolunteerDutyPage() {
  const { data: volunteers = [] } = useActiveVolunteers();
  const assign = useAssignVolunteerDuty();
  const complete = useCompleteVolunteerDuty();

  const [task, setTask] = useState('');
  const [shift, setShift] = useState('');
  const [hours, setHours] = useState('4');
  const [error, setError] = useState(null);

  const awaiting = volunteers.filter((v) => v.volunteer_status === 'accepted');
  const onDuty = volunteers.filter((v) => v.volunteer_status === 'active');

  async function run(fn) {
    setError(null);
    try { await fn(); } catch (err) {
      setError(err?.response?.data?.error?.message ?? 'Something went wrong.');
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 720 }}>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>
        Volunteer duties
      </Typography>

      {error && <Alert severity="error">{error}</Alert>}

      <Card>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 2 }}>Awaiting assignment ({awaiting.length})</Typography>
          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <TextField label="Task" value={task} onChange={(e) => setTask(e.target.value)} size="small" />
            <TextField label="Shift" value={shift} onChange={(e) => setShift(e.target.value)} size="small" />
          </Box>
          {awaiting.map((v) => (
            <Box key={v.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 1, borderTop: '1px solid #F0E7DE' }}>
              <Box>
                <Typography sx={{ fontWeight: 600 }}>{v.name}</Typography>
                <Typography variant="body2" color="text.secondary">{v.beneficiary_code}</Typography>
              </Box>
              <Button
                size="small" variant="outlined"
                disabled={!task.trim() || !shift.trim() || assign.isPending}
                onClick={() => run(() => assign.mutateAsync({ memberId: v.id, task, shift }))}
              >
                Assign
              </Button>
            </Box>
          ))}
          {awaiting.length === 0 && <Typography color="text.secondary">Nobody is waiting for a duty.</Typography>}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 2 }}>On duty now ({onDuty.length})</Typography>
          <TextField
            label="Hours to log" value={hours} onChange={(e) => setHours(e.target.value)}
            size="small" sx={{ mb: 2, maxWidth: 160 }}
          />
          {onDuty.map((v) => (
            <Box key={v.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 1, borderTop: '1px solid #F0E7DE' }}>
              <Box>
                <Typography sx={{ fontWeight: 600 }}>{v.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {v.volunteer_task} · {v.volunteer_shift}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <StatusBadge tone="brand">Active</StatusBadge>
                <Button
                  size="small" variant="outlined" disabled={complete.isPending}
                  onClick={() => run(() => complete.mutateAsync({ memberId: v.id, hours: Number(hours) || 0 }))}
                >
                  Mark complete
                </Button>
              </Box>
            </Box>
          ))}
          {onDuty.length === 0 && <Typography color="text.secondary">No volunteers are on duty.</Typography>}
        </CardContent>
      </Card>
    </Box>
  );
}
