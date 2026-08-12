import { Box, Card, CardContent, Typography } from '@mui/material';
import { PRIORITY_LABELS } from '@frp/shared';
import { usePriorityQueue } from '../../api/registration.js';
import { useCampScope } from '../../camps/CampScope.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';

const TONE_BY_TAG = {
  pregnant: 'bad',
  senior_citizen: 'warn',
  child: 'brand',
  disability: 'warn',
};

/**
 * Who to serve next at this camp. Sitting beside the beneficiary-code box, it
 * turns "who should I call?" into a click rather than a judgement the desk has
 * to make family by family under pressure.
 */
export function PriorityQueue({ onSelect }) {
  const { params, campId } = useCampScope();
  const { data: members = [], isLoading } = usePriorityQueue(params);

  if (!campId) {
    return (
      <Typography color="text.secondary" variant="body2">
        Choose a camp above to see who should be served first.
      </Typography>
    );
  }

  return (
    <Box>
      <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Serve these people first</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Checked-in people at this camp, in order: pregnant, senior citizens, then children.
      </Typography>

      {members.map((m) => (
        <Card
          key={m.id}
          onClick={() => onSelect?.(m)}
          sx={{
            mb: 1, cursor: 'pointer',
            '&:hover': { borderColor: 'primary.main' },
          }}
        >
          <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1.5 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{m.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {m.beneficiary_code} · age {m.age}
              </Typography>
            </Box>
            <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {m.priority_tags.map((t) => (
                <StatusBadge key={t} tone={TONE_BY_TAG[t] ?? 'neutral'}>
                  {PRIORITY_LABELS[t] ?? t}
                </StatusBadge>
              ))}
            </Box>
          </CardContent>
        </Card>
      ))}

      {!isLoading && members.length === 0 && (
        <Typography color="text.secondary" variant="body2">
          Nobody with a priority tag has checked in at this camp yet.
        </Typography>
      )}
    </Box>
  );
}
