import { Box, Card, CardContent, Typography } from '@mui/material';
import { StatusBadge } from '../../components/StatusBadge.jsx';

const STATUS_TONE = {
  open: 'warn',
  under_review: 'brand',
  in_progress: 'brand',
  resolved: 'ok',
  rejected: 'bad',
};

export const STATUS_LABELS = {
  open: 'Open',
  under_review: 'Under review',
  in_progress: 'In progress',
  resolved: 'Resolved',
  rejected: 'Rejected',
};

export function ComplaintStatus({ status }) {
  return <StatusBadge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABELS[status] ?? status}</StatusBadge>;
}

/** One complaint as the reporter sees it, including whatever came back. */
export function ComplaintCard({ complaint, children }) {
  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{complaint.complaint_code}</Typography>
          <ComplaintStatus status={complaint.status} />
          {complaint.priority === 'high' && <StatusBadge tone="bad">Urgent</StatusBadge>}
          <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
            {new Date(complaint.createdAt).toLocaleDateString()}
          </Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          {complaint.category}
        </Typography>
        <Typography variant="body2">{complaint.description}</Typography>

        {complaint.resolution && (
          <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid #F0E7DE' }}>
            <Typography sx={{ fontWeight: 600, fontSize: 12, mb: 0.25 }}>What was done</Typography>
            <Typography variant="body2">{complaint.resolution}</Typography>
          </Box>
        )}

        {children}
      </CardContent>
    </Card>
  );
}
