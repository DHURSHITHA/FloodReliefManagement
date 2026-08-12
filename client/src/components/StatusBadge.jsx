import { Box } from '@mui/material';

const TONES = {
  ok: { bg: '#E9F7EE', fg: '#1E8E4A' },
  warn: { bg: '#FEF6E7', fg: '#8A5B0C' },
  bad: { bg: '#FDECEA', fg: '#C0392B' },
  neutral: { bg: '#F2F2F2', fg: '#6B6B6B' },
  brand: { bg: '#FFF0E4', fg: '#C44E00' },
};

/** The colored-pill badge used across the design for status, severity, and priority. */
export function StatusBadge({ tone = 'neutral', children }) {
  const { bg, fg } = TONES[tone] ?? TONES.neutral;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block', px: 1.25, py: 0.4, borderRadius: '20px',
        fontSize: 11, fontWeight: 600, bgcolor: bg, color: fg, whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}
