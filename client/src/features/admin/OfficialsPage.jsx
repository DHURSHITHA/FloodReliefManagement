import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useOfficials, useDecideOfficial, useAssignCamps } from '../../api/auth.js';
import { useCamps } from '../../api/camps.js';
import { toFormErrors } from '../../api/client.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';

const STATUS_TONE = { active: 'ok', pending_approval: 'warn', rejected: 'bad', disabled: 'neutral' };
const STATUS_LABEL = {
  active: 'Active', pending_approval: 'Awaiting approval', rejected: 'Rejected', disabled: 'Disabled',
};

/**
 * Approving an official with no camps strands the account: every camp-scoped
 * screen filters on assigned_camp_ids, so an empty list silently shows them
 * nothing. At least one camp is therefore required to approve, and the server
 * enforces the same rule.
 *
 * An official may run several camps and picks which one they are working in
 * from the camp bar, so this is a multi-select.
 */
function PendingDecision({ official }) {
  const decide = useDecideOfficial();
  const { data: camps = [] } = useCamps();
  const [campIds, setCampIds] = useState([]);
  const [error, setError] = useState(null);

  async function decideWith(decision) {
    setError(null);
    try {
      await decide.mutateAsync({ id: official.id, decision, assigned_camp_ids: campIds });
    } catch (err) {
      const { message, fields } = toFormErrors(err);
      setError(fields.assigned_camp_ids ?? message);
    }
  }

  return (
    <Box sx={{ mt: 2 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <TextField
        select
        label="Camps they will run"
        value={campIds}
        onChange={(e) => setCampIds(
          typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value,
        )}
        slotProps={{
          select: {
            multiple: true,
            renderValue: (ids) => ids.map((id) => camps.find((c) => c.id === id)?.name).join(', '),
          },
        }}
        helperText="Pick at least one — an official with no camp cannot see anyone."
      >
        {camps.map((c) => (
          <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
        ))}
      </TextField>

      <Box sx={{ display: 'flex', gap: 1.25, mt: 2 }}>
        <Button
          variant="contained"
          disabled={decide.isPending || campIds.length === 0}
          onClick={() => decideWith('approve')}
        >
          {decide.isPending ? 'Saving…' : 'Approve'}
        </Button>
        <Button color="inherit" disabled={decide.isPending} onClick={() => decideWith('reject')}>
          Reject
        </Button>
      </Box>
    </Box>
  );
}

/** The "+" affordance: adds camps to an already-active official without touching the ones they already run. */
function AssignMoreCamps({ official, availableCamps }) {
  const assign = useAssignCamps();
  const [open, setOpen] = useState(false);
  const [campIds, setCampIds] = useState([]);
  const [error, setError] = useState(null);

  function cancel() {
    setOpen(false);
    setCampIds([]);
    setError(null);
  }

  async function submit() {
    setError(null);
    try {
      await assign.mutateAsync({ id: official.id, camp_ids: campIds });
      cancel();
    } catch (err) {
      const { message, fields } = toFormErrors(err);
      setError(fields.camp_ids ?? message);
    }
  }

  if (!open) {
    return (
      <IconButton
        size="small"
        aria-label={`Add a camp for ${official.name}`}
        onClick={() => setOpen(true)}
        disabled={availableCamps.length === 0}
      >
        <AddIcon fontSize="small" />
      </IconButton>
    );
  }

  return (
    <Box sx={{ mt: 1.5, width: '100%' }}>
      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
      <TextField
        select
        size="small"
        label="Add camps"
        value={campIds}
        onChange={(e) => setCampIds(
          typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value,
        )}
        slotProps={{
          select: {
            multiple: true,
            renderValue: (ids) => ids.map((id) => availableCamps.find((c) => c.id === id)?.name).join(', '),
          },
        }}
        sx={{ minWidth: 240 }}
      >
        {availableCamps.map((c) => (
          <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
        ))}
      </TextField>
      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
        <Button size="small" variant="contained" disabled={assign.isPending || campIds.length === 0} onClick={submit}>
          {assign.isPending ? 'Adding…' : 'Add'}
        </Button>
        <Button size="small" color="inherit" onClick={cancel}>Cancel</Button>
      </Box>
    </Box>
  );
}

function OfficialCard({ official, camps }) {
  const campById = useMemo(() => new Map(camps.map((c) => [c.id, c.name])), [camps]);
  const allottedNames = official.assigned_camp_ids.map((id) => campById.get(id) ?? 'Unknown camp');
  const availableCamps = camps.filter((c) => !official.assigned_camp_ids.includes(c.id));

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
          <Box>
            <Typography sx={{ fontWeight: 600 }}>{official.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {official.mobile || official.email} · requested {new Date(official.createdAt).toLocaleDateString()}
            </Typography>
          </Box>
          <StatusBadge tone={STATUS_TONE[official.status] ?? 'neutral'}>
            {STATUS_LABEL[official.status] ?? official.status}
          </StatusBadge>
        </Box>

        {official.status === 'pending_approval' && <PendingDecision official={official} />}

        {official.status === 'active' && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
              Camps they run
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
              {allottedNames.length > 0
                ? allottedNames.map((name) => <Chip key={name} label={name} size="small" />)
                : <Typography variant="body2" color="text.secondary">No camp assigned</Typography>}
              <AssignMoreCamps official={official} availableCamps={availableCamps} />
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export function OfficialsPage() {
  const { data: officials = [], isLoading } = useOfficials();
  const { data: camps = [] } = useCamps();

  return (
    <Box>
      <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600 }}>
        Camp officials
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
        Every camp official, newest signup first. Approving one assigns the camps they will run;
        an already-active official can be handed more camps with the + button on their card.
      </Typography>

      {camps.length === 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          There are no camps yet. Create a camp before approving an official.
        </Alert>
      )}

      <Stack spacing={2} sx={{ maxWidth: 560 }}>
        {officials.map((o) => <OfficialCard key={o.id} official={o} camps={camps} />)}
        {!isLoading && officials.length === 0 && (
          <Typography color="text.secondary">No camp officials have signed up yet.</Typography>
        )}
      </Stack>
    </Box>
  );
}
