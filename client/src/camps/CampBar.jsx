import { Alert, Box, MenuItem, TextField, Typography } from '@mui/material';
import { useCampScope } from './CampScope.jsx';
import { useAuth } from '../AuthProvider.jsx';

/**
 * The camp selector that sits above every camp-scoped screen. Pick the camp
 * once and check-in, distribute, history, and volunteer duties all follow it.
 */
export function CampBar({ children }) {
  const { user } = useAuth();
  const { campId, setCampId, camps, isLoading } = useCampScope();
  const isOfficial = user?.role === 'camp_official';

  if (!isLoading && isOfficial && camps.length === 0) {
    return (
      <Alert severity="warning">
        No camp is assigned to your account, so there is nobody for you to search.
        Ask an administrator to assign you a camp.
      </Alert>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
        p: 2, mb: 3, borderRadius: '14px', border: '1px solid #EFE6DC', bgcolor: '#FFFBF7',
      }}
    >
      <Box>
        <Typography sx={{ fontWeight: 600, fontSize: 13 }}>Working at</Typography>
        <Typography variant="body2" color="text.secondary">
          {isOfficial
            ? 'Searches and duties below cover only this camp.'
            : 'Leave blank to work across every camp.'}
        </Typography>
      </Box>

      <TextField
        select
        size="small"
        label="Camp"
        value={campId}
        onChange={(e) => setCampId(e.target.value)}
        sx={{ minWidth: 260, ml: 'auto', mb: 0 }}
      >
        {!isOfficial && <MenuItem value="">All camps</MenuItem>}
        {camps.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
      </TextField>

      {children}
    </Box>
  );
}
